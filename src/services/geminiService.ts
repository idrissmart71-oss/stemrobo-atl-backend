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
Extract ALL bank transactions for ATL PFMS audit. ${fundingInfo}

T1 CLASSIFICATION:
CAPITAL (₹10L max): computer, laptop, printer, 3D printer, robot, furniture, table, equipment, machine, lab setup, AC, projector
RECURRING (₹2L): salary, honorarium, trainer, workshop, internet, electricity, consumable, stationery

T2/T3: ALL expenses → RECURRING (except Interest/Bank charges)

RULES:
- Extract EVERY SINGLE transaction from the provided text
- NO LIMITS on number of transactions - extract ALL of them
- ALWAYS return complete valid JSON
- If unsure about classification, use RECURRING

OUTPUT FORMAT (must be valid JSON):
{"extractedTransactions":[{"date":"DD-MM-YYYY","narration":"Description","amount":1000,"direction":"DEBIT","intent":"CAPITAL","gstNo":null,"voucherNo":null}]}
`;

  // Larger chunks since we removed transaction limits
  const MAX_CHUNK = 2500; // Can handle ~15-20 transactions now
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

  console.log(`📄 Processing ${rawText.length} chars in ${chunks.length} chunks (NO transaction limits)`);

  const allTxns: any[] = [];
  let totalSpent = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`📊 Chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
    
    const maxNonRec = accountType === "Current" ? 976000 : 1000000;
    const inT1 = totalSpent < (maxNonRec + 200000);
    
    const prompt = `
Extract ALL transactions from this section (chunk ${i + 1}/${chunks.length}).

Context: ${inT1 ? 'Tranche 1 - Capital and Recurring allowed' : 'Tranche 2/3 - Only Recurring allowed'}

${chunk}

Extract EVERY transaction you see. No limits. Return complete JSON.
`;

    let response;
    let success = false;
    
    // Try with progressively more conservative settings
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const maxTokens = 4000 - (attempt * 500); // Start big, reduce if needed
        const temp = 0.05 + (attempt * 0.02);
        
        console.log(`  Attempt ${attempt}: ${maxTokens} tokens, temp ${temp}`);
        
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
        
        const raw = response.response.text();
        let cleaned = raw.replace(/```json|```/g, "").trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) cleaned = match[0];
        
        const parsed = JSON.parse(cleaned);
        
        if (parsed.extractedTransactions && Array.isArray(parsed.extractedTransactions) && parsed.extractedTransactions.length > 0) {
          console.log(`✅ Chunk ${i + 1}: Extracted ${parsed.extractedTransactions.length} transactions`);
          
          parsed.extractedTransactions.forEach((t: any) => {
            if (t.direction === 'DEBIT' && t.intent !== 'INELIGIBLE') {
              totalSpent += t.amount || 0;
            }
          });
          
          allTxns.push(...parsed.extractedTransactions);
          success = true;
          break;
        } else {
          console.log(`  Attempt ${attempt}: Got empty or invalid response`);
        }
      } catch (err: any) {
        console.error(`  Attempt ${attempt} failed:`, err.message);
        
        if (attempt < 5) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      }
    }
    
    // Aggressive salvage if all attempts failed
    if (!success && response) {
      console.log(`⚠️ Chunk ${i + 1}: Attempting salvage...`);
      try {
        const raw = response.response.text();
        let cleaned = raw.replace(/```json|```/g, "").trim();
        
        // Remove trailing comma and incomplete object
        const lastComma = cleaned.lastIndexOf(',');
        const lastCloseBrace = cleaned.lastIndexOf('}');
        if (lastComma > lastCloseBrace) {
          cleaned = cleaned.substring(0, lastComma);
        }
        
        // Count and fix brackets
        const openBrackets = (cleaned.match(/\[/g) || []).length;
        const closeBrackets = (cleaned.match(/\]/g) || []).length;
        const openBraces = (cleaned.match(/\{/g) || []).length;
        const closeBraces = (cleaned.match(/\}/g) || []).length;
        
        for (let j = closeBrackets; j < openBrackets; j++) cleaned += ']';
        for (let j = closeBraces; j < openBraces; j++) cleaned += '}';
        
        const salvaged = JSON.parse(cleaned);
        if (salvaged.extractedTransactions && salvaged.extractedTransactions.length > 0) {
          console.log(`✅ Salvaged ${salvaged.extractedTransactions.length} transactions from chunk ${i + 1}`);
          allTxns.push(...salvaged.extractedTransactions);
          success = true;
        }
      } catch (salvageErr) {
        console.error(`  Salvage failed:`, salvageErr);
      }
    }
    
    // If STILL failed and chunk is large, split it
    if (!success && chunk.length > 1000) {
      console.log(`🔄 Chunk ${i + 1}: Failed completely, splitting in half...`);
      const mid = Math.floor(chunk.length / 2);
      const part1 = chunk.substring(0, mid);
      const part2 = chunk.substring(mid);
      
      chunks.splice(i + 1, 0, part2);
      chunks.splice(i, 1, part1);
      i--; // Reprocess from part1
      continue;
    }
    
    // Delay between chunks
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`✅ EXTRACTION COMPLETE: ${allTxns.length} total transactions`);

  if (allTxns.length === 0) {
    throw new Error("Failed to extract any transactions. Please try again or check the format.");
  }

  // Warn if seems incomplete
  const avgCharsPerTxn = rawText.length / allTxns.length;
  if (avgCharsPerTxn > 150) {
    console.warn(`⚠️ Warning: Only ${allTxns.length} transactions from ${rawText.length} chars (${Math.round(avgCharsPerTxn)} chars/txn). May be incomplete.`);
  }

  return { extractedTransactions: allTxns };
};