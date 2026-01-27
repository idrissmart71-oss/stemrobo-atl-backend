import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * SIMPLIFIED VERSION - No schema enforcement, maximum compatibility
 * This version works with all Gemini models and avoids schema validation errors
 */
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

  const systemInstruction = `You are a transaction extraction AI for ATL PFMS audit. ${fundingInfo}

CLASSIFICATION RULES:
T1 CAPITAL (₹10L max): computer, laptop, printer, 3D printer, robot, furniture, table, equipment, machine, lab setup, AC, projector
T1 RECURRING (₹2L): salary, honorarium, trainer, workshop, internet, electricity, consumable, stationery
T2/T3: ALL expenses → RECURRING (except Interest/Bank charges → INELIGIBLE)

CRITICAL INSTRUCTIONS:
1. Extract EVERY transaction from the input
2. MUST return valid, parseable JSON - no syntax errors
3. Use "RECURRING" if classification is uncertain
4. Interest Credit, SMS charges, bank fees → INELIGIBLE
5. Include all fields: date, narration, amount, direction, intent, gstNo, voucherNo

REQUIRED OUTPUT (must be valid JSON):
{
  "extractedTransactions": [
    {
      "date": "DD-MM-YYYY",
      "narration": "Transaction description",
      "amount": 0,
      "direction": "DEBIT",
      "intent": "CAPITAL",
      "gstNo": null,
      "voucherNo": null
    }
  ]
}

CRITICAL: 
- Return ONLY the JSON object, no markdown, no explanation
- Every string in double quotes
- All property names in double quotes
- Use null (not "null") for null values
- Ensure all brackets are properly closed
- No trailing commas
- No comments`;

  // Smaller chunks for reliability
  const MAX_CHUNK = 1200;
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
    console.log(`\n📊 Chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
    
    const maxNonRec = accountType === "Current" ? 976000 : 1000000;
    const inT1 = totalSpent < (maxNonRec + 200000);
    
    const prompt = `Extract ALL transactions from this bank statement section.

Context: ${inT1 ? 'Tranche 1 - Capital and Recurring allowed' : 'Tranche 2/3 - Only Recurring allowed'}

Bank Statement Data:
${chunk}

CRITICAL: Return ONLY valid JSON. No markdown backticks. No explanatory text. Just the JSON object.

Example format:
{"extractedTransactions":[{"date":"28-08-2020","narration":"UPI Payment","amount":1.00,"direction":"DEBIT","intent":"INELIGIBLE","gstNo":null,"voucherNo":null}]}
`;

    let chunkSuccess = false;
    
    // Try different models in sequence
    const models = [
      "gemini-1.5-pro",
      "gemini-2.5-flash", 
      "gemini-2.0-flash-exp"
    ];
    
    for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
      const modelName = models[modelIdx];
      
      try {
        console.log(`  Trying ${modelName}...`);
        
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          systemInstruction,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: "application/json"
          }
        });
        
        const response = await model.generateContent(prompt);
        let rawText = response.response.text();
        
        // Aggressive cleaning
        rawText = rawText
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .replace(/^\s*\n/gm, '')
          .trim();
        
        // Extract JSON if embedded in text
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          rawText = jsonMatch[0];
        }
        
        // Try to parse
        const parsed = JSON.parse(rawText);
        
        if (parsed.extractedTransactions && 
            Array.isArray(parsed.extractedTransactions) && 
            parsed.extractedTransactions.length > 0) {
          
          console.log(`✅ Chunk ${i + 1}: Extracted ${parsed.extractedTransactions.length} transactions with ${modelName}`);
          
          parsed.extractedTransactions.forEach((t: any) => {
            if (t.direction === 'DEBIT' && t.intent !== 'INELIGIBLE') {
              totalSpent += t.amount || 0;
            }
          });
          
          allTxns.push(...parsed.extractedTransactions);
          chunkSuccess = true;
          break; // Success, move to next chunk
        } else {
          console.log(`  ${modelName}: Empty result`);
        }
        
      } catch (err: any) {
        const errorMsg = err.message || String(err);
        console.error(`  ${modelName} failed: ${errorMsg.substring(0, 100)}`);
      }
      
      // Small delay between model attempts
      if (modelIdx < models.length - 1 && !chunkSuccess) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    // If all models failed, try splitting the chunk
    if (!chunkSuccess && chunk.length > 400) {
      console.log(`🔄 Chunk ${i + 1}: All models failed, splitting chunk...`);
      const mid = Math.floor(chunk.length / 2);
      const lineBreak = chunk.lastIndexOf('\n', mid);
      const splitPoint = lineBreak > mid - 200 ? lineBreak : mid;
      
      const part1 = chunk.substring(0, splitPoint);
      const part2 = chunk.substring(splitPoint);
      
      chunks.splice(i + 1, 0, part2, part1);
      i--; // Reprocess from part1
      continue;
    }
    
    if (!chunkSuccess) {
      console.error(`❌ Chunk ${i + 1}: Failed completely after all attempts`);
    }
    
    // Rate limiting delay
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  console.log(`\n✅ EXTRACTION COMPLETE: ${allTxns.length} total transactions`);

  if (allTxns.length === 0) {
    throw new Error(
      "Failed to extract any transactions. Please verify:\n" +
      "1. Input contains valid bank statement data\n" +
      "2. Transactions have dates, amounts, and descriptions\n" +
      "3. File format is readable"
    );
  }

  // Quality check
  const avgCharsPerTxn = rawText.length / allTxns.length;
  if (avgCharsPerTxn > 150) {
    console.warn(
      `⚠️ Warning: ${allTxns.length} transactions from ${rawText.length} chars ` +
      `(${Math.round(avgCharsPerTxn)} chars/txn). Extraction may be incomplete.`
    );
  }

  return { extractedTransactions: allTxns };
};