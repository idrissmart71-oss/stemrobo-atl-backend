import { GoogleGenerativeAI } from "@google/generative-ai";

export const analyzeTransactionsAI = async (
  rawText: string,
  fileData?: undefined,
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
) => {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY!);

  const fundingInfo = accountType === "Current" 
    ? `
CURRENT ACCOUNT (With 2% TDS):
- Tranche 1: ₹11,76,000 NET (₹9,76,000 Non-Recurring after TDS + ₹2,00,000 Recurring)
- Tranche 2: ₹3,92,000 (All Recurring)
- Tranche 3: ₹3,92,000 (All Recurring)
- Total: ₹19,60,000 NET
` 
    : `
SAVINGS ACCOUNT (Gross):
- Tranche 1: ₹12,00,000 GROSS (₹10,00,000 Non-Recurring + ₹2,00,000 Recurring)
- Tranche 2: ₹4,00,000 (All Recurring)
- Tranche 3: ₹4,00,000 (All Recurring)
- Total: ₹20,00,000 GROSS
`;

  const systemInstruction = `
You are a financial transaction classifier for NITI Aayog ATL (Atal Tinkering Lab) audits and GFR 12-A Utilization Certificate preparation.

FUNDING STRUCTURE:
${fundingInfo}

CRITICAL CLASSIFICATION RULES FOR GFR 12-A:

**GRANT GENERAL (RECURRING)** - Revenue/Operational Expenses:
- Salary, wages, honorarium for staff
- Workshops, training programs
- Consumables, stationery, office supplies
- Travel expenses for ATL activities
- Maintenance and repairs
- Utilities (electricity, internet)
- Event expenses
- Tinkering kits and materials

**CAPITAL ASSETS (NON-RECURRING)** - One-time Capital Purchases:
- Equipment: 3D printers, computers, laptops, robotics kits
- Furniture: tables, chairs, storage units
- Infrastructure: lab setup, workbenches
- Tools and machinery
- Software licenses (perpetual)
- Electronics and hardware

**INTEREST EARNED**:
- Bank interest on ATL account (Savings account only)
- Must be refunded to Bharat Kosh

**INELIGIBLE** - Not allowed under ATL scheme:
- Bank charges, ATM fees, minimum balance charges
- GST on bank charges
- Personal expenses
- Cash withdrawals
- Non-ATL related expenses
- Penalties or fines

IMPORTANT FOR GFR 12-A:
- Process ALL transactions without skipping
- Maximum 20 transactions per response to ensure complete JSON
- Accurate classification is critical for audit compliance
- Include all transaction details

OUTPUT FORMAT - STRICT JSON:
{
  "extractedTransactions": [
    {
      "date": "DD-MM-YYYY",
      "narration": "Brief description",
      "amount": 1000,
      "direction": "DEBIT",
      "intent": "CAPITAL",
      "gstNo": null,
      "voucherNo": null
    }
  ]
}

INTENT values: CAPITAL, RECURRING, SALARY, INTEREST, GRANT, INELIGIBLE
`;

  // Split large text into smaller chunks (reduce chunk size)
  const MAX_CHUNK_SIZE = 6000; // Reduced from 12000 to get smaller batches
  const chunks: string[] = [];
  
  if (rawText.length > MAX_CHUNK_SIZE) {
    console.log(`📄 Large document detected (${rawText.length} chars), splitting into chunks...`);
    
    // Split by lines to avoid breaking transactions
    const lines = rawText.split('\n');
    let currentChunk = '';
    
    for (const line of lines) {
      if ((currentChunk + line).length > MAX_CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    console.log(`📄 Split into ${chunks.length} chunks`);
  } else {
    chunks.push(rawText);
  }

  // Process each chunk
  const allTransactions: any[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`📊 Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
    
    const prompt = `
Analyze this bank statement section and classify each transaction according to GFR 12-A requirements.

${chunks.length > 1 ? `This is Part ${i + 1} of ${chunks.length}.` : ''}

CLASSIFICATION GUIDE:
- Equipment/Furniture/Lab setup → CAPITAL
- Salary/Workshops/Consumables → RECURRING  
- Interest credit → INTEREST
- Grant/Fund receipt → GRANT
- Bank charges → INELIGIBLE

Account Type: ${accountType}

Bank Statement:
${chunk}

Extract maximum 20-25 transactions to ensure complete, valid JSON with all closing brackets.
Return ONLY the JSON object.
`;

    let response;

    // Retry logic
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.5-flash",
          systemInstruction,
          generationConfig: {
            temperature: 0.2, // Slightly increased for better classification
            maxOutputTokens: 8000,
            responseMimeType: "application/json",
            topP: 0.95,
            topK: 64
          }
        });
        
        response = await model.generateContent(prompt);
        break;
      } catch (err: any) {
        console.error(`Chunk ${i + 1}, Attempt ${attempt} failed:`, err.message);
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }

    const rawResponse = response!.response.text();
    console.log(`📝 Chunk ${i + 1} response (first 200 chars):`, rawResponse.substring(0, 200));

    // Clean the response
    let cleaned = rawResponse
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      const parsed = JSON.parse(cleaned);
      
      if (!parsed.extractedTransactions) {
        console.error(`❌ Chunk ${i + 1}: Missing extractedTransactions`);
        continue;
      }

      console.log(`✅ Chunk ${i + 1}: Parsed ${parsed.extractedTransactions.length} transactions`);
      allTransactions.push(...parsed.extractedTransactions);
      
    } catch (parseError: any) {
      console.error(`🔥 Chunk ${i + 1} JSON Parse Error:`, parseError.message);
      
      // Advanced salvage - try to fix common JSON issues
      try {
        // Try to fix incomplete JSON
        let fixed = cleaned;
        
        // Count opening and closing brackets
        const openBrackets = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/\]/g) || []).length;
        const openBraces = (fixed.match(/\{/g) || []).length;
        const closeBraces = (fixed.match(/\}/g) || []).length;
        
        console.log(`Brackets: [ ${openBrackets}/${closeBrackets} ]  { ${openBraces}/${closeBraces} }`);
        
        // Remove any incomplete last object
        const lastComma = fixed.lastIndexOf(',');
        const lastCloseBrace = fixed.lastIndexOf('}');
        
        if (lastComma > lastCloseBrace) {
          // Incomplete object, remove it
          fixed = fixed.substring(0, lastComma);
        }
        
        // Add missing closing brackets
        for (let j = 0; j < openBrackets - closeBrackets; j++) {
          fixed += ']';
        }
        for (let j = 0; j < openBraces - closeBraces; j++) {
          fixed += '}';
        }
        
        console.log(`🔧 Attempting to fix JSON...`);
        const parsed = JSON.parse(fixed);
        
        if (parsed.extractedTransactions && parsed.extractedTransactions.length > 0) {
          console.log(`⚠️ Chunk ${i + 1}: Salvaged ${parsed.extractedTransactions.length} transactions (fixed JSON)`);
          allTransactions.push(...parsed.extractedTransactions);
        }
      } catch (salvageError) {
        console.error(`❌ Chunk ${i + 1}: Could not salvage, skipping`);
        // Continue to next chunk
      }
    }
  }

  console.log(`✅ Total transactions extracted: ${allTransactions.length}`);

  if (allTransactions.length === 0) {
    throw new Error("No transactions could be extracted. Please check the document format.");
  }

  return { extractedTransactions: allTransactions };
};