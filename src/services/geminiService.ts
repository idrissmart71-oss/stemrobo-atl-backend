import { GoogleGenerativeAI } from "@google/generative-ai";

export const analyzeTransactionsAI = async (
  rawText: string,
  fileData?: undefined,
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
) => {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY!);

  const fundingInfo = accountType === "Current" 
    ? "CURRENT: T1=₹11.76L (₹9.76L Cap+₹2L Rec), T2=₹3.92L Rec, T3=₹3.92L Rec"
    : "SAVINGS: T1=₹12L (₹10L Cap+₹2L Rec), T2=₹4L Rec, T3=₹4L Rec";

  const systemInstruction = `
Extract bank transactions for ATL PFMS audit. ${fundingInfo}

T1 CLASSIFICATION:
CAPITAL (₹10L max): computer, laptop, printer, 3D printer, robot, furniture, table, equipment, machine, lab setup, AC, projector
RECURRING (₹2L): salary, honorarium, trainer, workshop, internet, electricity, consumable, stationery

T2/T3: ALL expenses → RECURRING (except Interest/Bank charges)

STRICT RULES:
- Extract EVERY transaction
- Maximum 8 transactions per response
- ALWAYS complete JSON with closing brackets
- If unsure, classify as RECURRING

OUTPUT (MUST be complete):
{"extractedTransactions":[{"date":"DD-MM-YYYY","narration":"Text","amount":1000,"direction":"DEBIT","intent":"CAPITAL","gstNo":null,"voucherNo":null}]}
`;

  // Ultra-small chunks to guarantee completion
  const MAX_CHUNK = 1200; // ~6-8 transactions
  const lines = rawText.split('\n');
  const chunks: string[] = [];
  let current = '';
  
  for (const line of lines) {
    if ((current + line).length > MAX_CHUNK && current.length > 0) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.length > 0) chunks.push(current);

  console.log(`📄 Processing ${rawText.length} chars in ${chunks.length} chunks`);

  const allTxns: any[] = [];
  let totalSpent = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`📊 Chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
    
    const maxNonRec = accountType === "Current" ? 976000 : 1000000;
    const inT1 = totalSpent < (maxNonRec + 200000);
    
    const prompt = `
Extract transactions chunk ${i + 1}/${chunks.length}. ${inT1 ? 'T1 mode' : 'T2/T3 mode (all RECURRING)'}.

${chunk}

Return 5-8 transactions. COMPLETE JSON required.
`;

    let response;
    let success = false;
    
    // Try with different models/configs if first fails
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const maxTokens = attempt <= 2 ? 2000 : 1500; // Reduce on retry
        const temp = attempt === 1 ? 0.05 : 0.1;
        
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.5-flash",
          systemInstruction,
          generationConfig: {
            temperature: temp,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json"
          }
        });
        
        response = await model.generateContent(prompt);
        
        // Immediate parse attempt
        const raw = response.response.text();
        let cleaned = raw.replace(/```json|```/g, "").trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) cleaned = match[0];
        
        const parsed = JSON.parse(cleaned);
        
        if (parsed.extractedTransactions && Array.isArray(parsed.extractedTransactions)) {
          console.log(`✅ Chunk ${i + 1}: ${parsed.extractedTransactions.length} txns (attempt ${attempt})`);
          
          parsed.extractedTransactions.forEach((t: any) => {
            if (t.direction === 'DEBIT' && t.intent !== 'INELIGIBLE') {
              totalSpent += t.amount || 0;
            }
          });
          
          allTxns.push(...parsed.extractedTransactions);
          success = true;
          break;
        }
      } catch (err: any) {
        console.error(`Chunk ${i + 1} attempt ${attempt} failed:`, err.message);
        
        if (attempt < 5) {
          await new Promise(r => setTimeout(r, attempt * 1000));
          continue;
        }
      }
    }
    
    // If all attempts failed, try aggressive salvage
    if (!success && response) {
      console.log(`⚠️ Chunk ${i + 1}: Attempting aggressive salvage...`);
      try {
        const raw = response.response.text();
        let cleaned = raw.replace(/```json|```/g, "").trim();
        
        // Fix common issues
        const openBrackets = (cleaned.match(/\[/g) || []).length;
        const closeBrackets = (cleaned.match(/\]/g) || []).length;
        const openBraces = (cleaned.match(/\{/g) || []).length;
        const closeBraces = (cleaned.match(/\}/g) || []).length;
        
        // Remove trailing incomplete object
        const lastComma = cleaned.lastIndexOf(',');
        const lastBrace = cleaned.lastIndexOf('}');
        if (lastComma > lastBrace) {
          cleaned = cleaned.substring(0, lastComma);
        }
        
        // Add missing brackets
        for (let j = closeBrackets; j < openBrackets; j++) cleaned += ']';
        for (let j = closeBraces; j < openBraces; j++) cleaned += '}';
        
        const salvaged = JSON.parse(cleaned);
        if (salvaged.extractedTransactions && salvaged.extractedTransactions.length > 0) {
          console.log(`✅ Salvaged ${salvaged.extractedTransactions.length} from chunk ${i + 1}`);
          allTxns.push(...salvaged.extractedTransactions);
          success = true;
        }
      } catch (salvageErr) {
        console.error(`❌ Chunk ${i + 1}: Salvage failed`);
      }
    }
    
    // If still failed, try re-processing with even smaller chunk
    if (!success && chunk.length > 600) {
      console.log(`🔄 Chunk ${i + 1}: Splitting into smaller pieces...`);
      const half = Math.floor(chunk.length / 2);
      const part1 = chunk.substring(0, half);
      const part2 = chunk.substring(half);
      
      chunks.splice(i + 1, 0, part1, part2);
      chunks.splice(i, 1);
      i--; // Reprocess
      continue;
    }
    
    // Small delay between chunks
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  console.log(`✅ TOTAL EXTRACTED: ${allTxns.length} transactions`);

  if (allTxns.length === 0) {
    throw new Error("Failed to extract any transactions. Please check the format.");
  }

  if (allTxns.length < 20 && rawText.length > 2000) {
    console.warn(`⚠️ Only extracted ${allTxns.length} transactions from ${rawText.length} chars - may be incomplete`);
  }

  return { extractedTransactions: allTxns };
};