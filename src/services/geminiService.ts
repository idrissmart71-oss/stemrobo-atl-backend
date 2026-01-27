import { GoogleGenerativeAI } from "@google/generative-ai";

interface Transaction {
  date: string;
  narration: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  intent: string;
  gstNo: string | null;
  voucherNo: string | null;
}

interface ExtractionResult {
  extractedTransactions: Transaction[];
}

/**
 * More robust extraction with response schema validation
 */
export const analyzeTransactionsAI = async (
  rawText: string,
  fileData?: undefined,
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
): Promise<ExtractionResult> => {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY!);

  const fundingInfo = accountType === "Current" 
    ? "CURRENT: T1=₹11.76L (₹9.76L Cap+₹2L Rec), T2=₹3.92L Rec, T3=₹3.92L Rec"
    : "SAVINGS: T1=₹12L (₹10L Cap+₹2L Rec), T2=₹4L Rec, T3=₹4L Rec";

  // Define JSON schema for structured output
  const transactionSchema = {
    type: "object",
    properties: {
      extractedTransactions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date in DD-MM-YYYY format" },
            narration: { type: "string", description: "Transaction description" },
            amount: { type: "number", description: "Transaction amount" },
            direction: { 
              type: "string", 
              enum: ["DEBIT", "CREDIT"],
              description: "Transaction direction" 
            },
            intent: { 
              type: "string",
              description: "Classification: CAPITAL, RECURRING, or INELIGIBLE"
            },
            gstNo: { 
              type: ["string", "null"],
              description: "GST number if available" 
            },
            voucherNo: { 
              type: ["string", "null"],
              description: "Voucher number if available" 
            }
          },
          required: ["date", "narration", "amount", "direction", "intent"]
        }
      }
    },
    required: ["extractedTransactions"]
  };

  const systemInstruction = `You are a precise transaction extraction system for ATL PFMS audit.

FUNDING CONTEXT: ${fundingInfo}

CLASSIFICATION RULES:
- T1 CAPITAL (max ₹10L): computers, laptops, printers, 3D printers, robots, furniture, tables, equipment, machines, lab setup, AC, projectors
- T1 RECURRING (max ₹2L): salary, honorarium, trainer fees, workshops, internet, electricity, consumables, stationery
- T2/T3: ALL expenses are RECURRING (except bank charges/interest which are INELIGIBLE)

EXTRACTION RULES:
1. Extract EVERY single transaction you see in the input
2. If unsure about classification, use RECURRING
3. Bank charges and interest income → INELIGIBLE
4. Ensure dates are in DD-MM-YYYY format
5. Amount should be numeric (no currency symbols)
6. Direction: DEBIT for expenses/withdrawals, CREDIT for deposits

OUTPUT: You must return valid JSON matching the schema provided. No extra text.`;

  const MAX_CHUNK_SIZE = 1500; // Smaller chunks for reliability
  const chunks = chunkText(rawText, MAX_CHUNK_SIZE);
  
  console.log(`📄 Processing ${rawText.length} chars in ${chunks.length} chunks`);

  const allTransactions: Transaction[] = [];
  let totalSpent = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`\n📊 Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
    
    const maxNonRec = accountType === "Current" ? 976000 : 1000000;
    const inT1 = totalSpent < (maxNonRec + 200000);
    const trancheContext = inT1 
      ? 'Currently in Tranche 1 - both CAPITAL and RECURRING expenses allowed' 
      : 'Currently in Tranche 2/3 - only RECURRING expenses allowed';

    const prompt = `Extract all bank transactions from this text segment.

${trancheContext}

Transaction data:
${chunk}

Extract every transaction you find. Return as structured JSON.`;

    const result = await extractChunkWithRetry(
      genAI,
      systemInstruction,
      prompt,
      transactionSchema,
      i + 1,
      chunks.length
    );

    if (result.success && result.transactions.length > 0) {
      console.log(`✅ Extracted ${result.transactions.length} transactions from chunk ${i + 1}`);
      
      // Update totalSpent for tranche tracking
      result.transactions.forEach(t => {
        if (t.direction === 'DEBIT' && t.intent !== 'INELIGIBLE') {
          totalSpent += t.amount || 0;
        }
      });
      
      allTransactions.push(...result.transactions);
    } else if (!result.success && chunk.length > 600) {
      // Split failed chunk and add back to queue
      console.log(`🔄 Chunk ${i + 1} failed - splitting into smaller parts`);
      const [part1, part2] = splitChunk(chunk);
      chunks.splice(i + 1, 0, part2, part1);
      i--; // Reprocess
      continue;
    } else {
      console.warn(`⚠️ Chunk ${i + 1} failed after all retries`);
    }

    // Rate limiting
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 700));
    }
  }

  console.log(`\n✅ COMPLETE: Extracted ${allTransactions.length} total transactions`);

  if (allTransactions.length === 0) {
    throw new Error(
      "No transactions could be extracted. Please verify:\n" +
      "1. The input contains valid transaction data\n" +
      "2. The format is readable (dates, amounts, descriptions)\n" +
      "3. The file is not corrupted or empty"
    );
  }

  // Quality warning
  const avgCharsPerTransaction = rawText.length / allTransactions.length;
  if (avgCharsPerTransaction > 180) {
    console.warn(
      `⚠️ QUALITY WARNING: ${allTransactions.length} transactions from ${rawText.length} chars ` +
      `(avg ${Math.round(avgCharsPerTransaction)} chars/txn). Extraction may be incomplete.`
    );
  }

  return { extractedTransactions: allTransactions };
};

/**
 * Retry logic with schema-enforced JSON
 */
async function extractChunkWithRetry(
  genAI: GoogleGenerativeAI,
  systemInstruction: string,
  prompt: string,
  schema: any,
  chunkNum: number,
  totalChunks: number
): Promise<{ success: boolean; transactions: Transaction[] }> {
  
  const attempts = [
    { model: "gemini-2.5-flash", temp: 0.1, tokens: 8000, useSchema: true },
    { model: "gemini-2.0-flash", temp: 0.05, tokens: 6000, useSchema: true },
    { model: "gemini-1.5-flash", temp: 0.1, tokens: 8000, useSchema: true },
    { model: "gemini-1.5-flash", temp: 0.1, tokens: 6000, useSchema: false },
  ];

  for (let i = 0; i < attempts.length; i++) {
    const config = attempts[i];
    
    try {
      console.log(`  Attempt ${i + 1}/${attempts.length}: ${config.model} (schema: ${config.useSchema})`);
      
      const generationConfig: any = {
        temperature: config.temp,
        maxOutputTokens: config.tokens,
        responseMimeType: "application/json",
      };
      
      if (config.useSchema) {
        generationConfig.responseSchema = schema;
      }
      
      const model = genAI.getGenerativeModel({
        model: config.model,
        systemInstruction,
        generationConfig
      });

      const response = await model.generateContent(prompt);
      let rawText = response.response.text();
      
      // Clean markdown artifacts
      rawText = rawText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
      // Parse JSON
      const parsed = JSON.parse(rawText);
      
      // Validate structure
      if (
        parsed.extractedTransactions && 
        Array.isArray(parsed.extractedTransactions) &&
        parsed.extractedTransactions.length > 0
      ) {
        return { 
          success: true, 
          transactions: parsed.extractedTransactions 
        };
      }
      
      console.log(`  Attempt ${i + 1}: Got empty response`);
      
    } catch (err: any) {
      console.error(`  Attempt ${i + 1} failed: ${err.message}`);
      
      if (i < attempts.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  return { success: false, transactions: [] };
}

/**
 * Smart text chunking on line boundaries
 */
function chunkText(text: string, maxSize: number): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';

  for (const line of lines) {
    if ((currentChunk + line + '\n').length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Split chunk into two roughly equal parts on line boundary
 */
function splitChunk(chunk: string): [string, string] {
  const lines = chunk.split('\n');
  const midPoint = Math.floor(lines.length / 2);
  
  const part1 = lines.slice(0, midPoint).join('\n');
  const part2 = lines.slice(midPoint).join('\n');
  
  return [part1, part2];
}