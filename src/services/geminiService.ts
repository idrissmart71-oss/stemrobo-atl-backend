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

CRITICAL CLASSIFICATION RULES:

**CAPITAL (Non-Recurring)** - One-time purchases for lab setup:
EQUIPMENT KEYWORDS: computer, laptop, desktop, printer, 3D printer, robot, drone, Arduino, Raspberry Pi, electronics kit, sensor, motor, CNC, lathe, drill, microscope, projector, camera, VR headset
FURNITURE KEYWORDS: table, chair, desk, cabinet, shelf, rack, workbench, storage
INFRASTRUCTURE KEYWORDS: AC, air conditioner, fan, exhaust, electrical work, wiring, flooring, ceiling, paint
SOFTWARE KEYWORDS: license (perpetual), software purchase, CAD software, design software
Examples: "Computer purchase 50000", "3D Printer 75000", "Furniture for lab 30000", "Robotics kit 25000"

**RECURRING (Operational Expenses)** - Regular operational costs:
SALARY KEYWORDS: salary, wage, honorarium, stipend, payment to mentor, payment to instructor, staff payment, teacher, facilitator
CONSUMABLES KEYWORDS: stationery, paper, pen, marker, tape, glue, wire, components, resistor, LED, breadboard
WORKSHOPS KEYWORDS: workshop, training, seminar, event, competition, tinkering kit, activity kit, science kit
MAINTENANCE KEYWORDS: repair, maintenance, servicing, AMC, cleaning, replacement parts
UTILITIES KEYWORDS: electricity, internet, wifi, broadband, phone, mobile recharge
TRAVEL KEYWORDS: travel, transportation, fuel, conveyance, TA, DA
Examples: "Salary payment 15000", "Workshop materials 8000", "Internet bill 2000", "Stationery 3000"

**INTEREST** - Bank interest only:
Keywords: interest, int paid, int credit, interest earned
Only if direction is CREDIT

**GRANT** - Fund receipts:
Keywords: NEFT, RTGS, fund transfer, grant, AIM, NITI Aayog, cash deposit (if for ATL)
Only if direction is CREDIT and amount is large (>100000 typically)

**INELIGIBLE** - Not allowed:
Keywords: bank charges, ATM, minimum balance, SMS charges, cheque book, GST (on bank charges), penalty, fine
Examples: "Bank charges 300", "ATM withdrawal", "Min balance charges"

CRITICAL RULES:
1. Just because it's a DEBIT doesn't mean it's RECURRING
2. Check narration for CAPITAL keywords (computer, printer, furniture, equipment, robot, kit with high value)
3. Salary/Honorarium → RECURRING
4. Equipment/Furniture → CAPITAL
5. Process ALL transactions from ALL years (2020, 2021, 2022, 2023, 2024, 2025)
6. DO NOT stop at 2023 - continue through entire document
7. Maximum 25 transactions per batch to ensure complete JSON

OUTPUT FORMAT:
{
  "extractedTransactions": [
    {
      "date": "DD-MM-YYYY",
      "narration": "Description",
      "amount": 1000,
      "direction": "DEBIT",
      "intent": "CAPITAL",
      "gstNo": null,
      "voucherNo": null
    }
  ]
}

INTENT values: CAPITAL, RECURRING, INTEREST, GRANT, INELIGIBLE
`;

  // Split large text into very small chunks to ensure completion
  const MAX_CHUNK_SIZE = 3000; // Much smaller - about 10-15 transactions per chunk
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
Extract and classify transactions from bank statement.

Part ${i + 1} of ${chunks.length}

Rules:
- Computer/Equipment/Furniture/3D Printer → CAPITAL
- Salary/Wages/Honorarium → RECURRING
- Workshop/Training/Consumables → RECURRING
- Interest credit → INTEREST
- STEMROBO payment → RECURRING (operational expense)
- Individual vendor payments → Check narration (equipment=CAPITAL, services=RECURRING)
- Bank charges/SMS fees → INELIGIBLE

Statement:
${chunk}

Extract 8-12 transactions maximum. Return COMPLETE JSON with ALL closing brackets.
`;

    let response;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.5-flash",
          systemInstruction,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4000, // Very small to force completion
            responseMimeType: "application/json",
            topP: 0.85,
            topK: 30
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