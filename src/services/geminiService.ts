import { GoogleGenerativeAI } from "@google/generative-ai";

export const analyzeTransactionsAI = async (
  rawText: string,
  fileData?: undefined,
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
) => {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY!);

  const fundingInfo = accountType === "Current" 
    ? "CURRENT ACCOUNT: T1=₹11.76L (₹9.76L Non-Rec + ₹2L Rec), T2=₹3.92L (All Rec), T3=₹3.92L (All Rec)"
    : "SAVINGS ACCOUNT: T1=₹12L (₹10L Non-Rec + ₹2L Rec), T2=₹4L (All Rec), T3=₹4L (All Rec)";

  const systemInstruction = `
You are a bank statement transaction extractor for NITI Aayog ATL PFMS Grant Management.

PFMS GRANT STRUCTURE: ${fundingInfo}

TRANCHE 1 (₹12 Lakh) - Equipment + Initial Operations:
NON-RECURRING (₹10 Lakh):
- Equipment: 3D Printers, Computers, Laptops, Robotics Kits, Electronics Lab Equipment
- Infrastructure: Lab Setup, Furniture, Workbenches, Storage Units, Display Boards
- Software/Hardware: CAD Software, Programming Tools, Hardware Components
- Lab Assets: Tools, Machines, Testing Equipment, Safety Equipment

RECURRING (₹2 Lakh):
- Trainer Honorarium: ATL Mentor, Workshop Trainer, Guest Instructor
- Internet & Utilities: Broadband, WiFi, Electricity
- Consumables: Stationery, Paper, Markers, Prototyping Materials

TRANCHE 2 (₹4 Lakh) - ALL RECURRING:
- Staff Salary: Regular Staff, Lab Attendant
- Training Expenses: Workshops, Seminars, Student Kits
- Maintenance: Equipment Repair, Lab Upkeep
- Operational Costs: Competition Fees, Event Organization

TRANCHE 3 (₹4 Lakh) - ALL RECURRING:
- Advanced Training: Specialized Workshops, Certification Programs
- Project Execution Support: Project Materials, Documentation
- Monitoring & Reporting: Assessment Tools, Reporting Materials

CLASSIFICATION RULES:
1. TRANCHE 1 ONLY: Equipment/Infrastructure → CAPITAL (up to ₹10L)
2. TRANCHE 1: Operations/Honorarium → RECURRING (up to ₹2L)
3. TRANCHE 2 & 3: EVERYTHING → RECURRING (no capital allowed)
4. Exceptions: Interest=INTEREST, Bank charges/GST/SMS=INELIGIBLE

KEYWORDS:
CAPITAL (T1 only): computer, laptop, printer, 3D printer, robot, furniture, table, chair, equipment, machine, tool, hardware, electronics kit, lab setup, infrastructure, AC, projector
RECURRING: salary, honorarium, trainer, workshop, training, consumable, stationery, internet, electricity, maintenance, repair, kit (small value), material
INTEREST: interest credit, int paid, int earned
GRANT: NEFT, RTGS, fund transfer (large amount >100000)
INELIGIBLE: bank charge, ATM, minimum balance, SMS charge, GST (on bank services)

CRITICAL:
- Extract ALL transactions line by line
- Continue through ALL years (2020-2025)
- Maximum 10 transactions per response
- COMPLETE valid JSON required

OUTPUT:
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
`;

  // Process in VERY small chunks to ensure completion
  const MAX_CHUNK_SIZE = 1500; // About 6-8 transactions per chunk
  const lines = rawText.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const line of lines) {
    if ((currentChunk + line).length > MAX_CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  console.log(`📄 Processing ${rawText.length} chars in ${chunks.length} chunks`);

  const allTransactions: any[] = [];
  let totalSpent = 0; // Track total spending to determine tranche

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`📊 Chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
    
    // Determine current tranche based on spending so far
    const maxNonRecT1 = accountType === "Current" ? 976000 : 1000000;
    const maxRecT1 = 200000;
    const isInTranche1 = totalSpent < (maxNonRecT1 + maxRecT1);
    
    const prompt = `
Extract transactions from bank statement chunk ${i + 1}/${chunks.length}.

Current context: ${totalSpent > 0 ? `₹${Math.round(totalSpent/1000)}K already spent` : 'Beginning of statement'}
Tranche status: ${isInTranche1 ? 'TRANCHE 1 (Capital + Recurring allowed)' : 'TRANCHE 2/3 (ONLY Recurring allowed)'}

Rules for this chunk:
${isInTranche1 ? 
  '- Equipment/Furniture → CAPITAL\n- Salary/Operations → RECURRING' : 
  '- ALL expenses → RECURRING (no capital allowed)\n- Only exceptions: Interest=INTEREST, Bank charges=INELIGIBLE'
}

Statement text:
${chunk}

Extract 5-10 transactions. COMPLETE JSON required.
`;

    let response;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.0-flash-exp",
          systemInstruction,
          generationConfig: {
            temperature: 0.05,
            maxOutputTokens: 2500,
            responseMimeType: "application/json"
          }
        });
        
        response = await model.generateContent(prompt);
        break;
      } catch (err: any) {
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const rawResponse = response!.response.text();
    let cleaned = rawResponse.replace(/```json|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.extractedTransactions && parsed.extractedTransactions.length > 0) {
        console.log(`✅ Chunk ${i + 1}: ${parsed.extractedTransactions.length} transactions`);
        
        // Update total spent (only debits)
        parsed.extractedTransactions.forEach((t: any) => {
          if (t.direction === 'DEBIT' && t.intent !== 'INELIGIBLE') {
            totalSpent += t.amount || 0;
          }
        });
        
        allTransactions.push(...parsed.extractedTransactions);
      }
    } catch (err: any) {
      console.error(`⚠️ Chunk ${i + 1} parse error, attempting fix...`);
      // Try to fix incomplete JSON
      try {
        const openBrackets = (cleaned.match(/\[/g) || []).length;
        const closeBrackets = (cleaned.match(/\]/g) || []).length;
        const openBraces = (cleaned.match(/\{/g) || []).length;
        const closeBraces = (cleaned.match(/\}/g) || []).length;
        
        let fixed = cleaned;
        
        // Remove incomplete last object
        const lastComma = fixed.lastIndexOf(',');
        const lastBrace = fixed.lastIndexOf('}');
        if (lastComma > lastBrace) {
          fixed = fixed.substring(0, lastComma);
        }
        
        // Add missing brackets
        for (let j = 0; j < openBrackets - closeBrackets; j++) fixed += ']';
        for (let j = 0; j < openBraces - closeBraces; j++) fixed += '}';
        
        const salvaged = JSON.parse(fixed);
        if (salvaged.extractedTransactions && salvaged.extractedTransactions.length > 0) {
          console.log(`✅ Salvaged ${salvaged.extractedTransactions.length} from chunk ${i + 1}`);
          allTransactions.push(...salvaged.extractedTransactions);
        }
      } catch {
        console.error(`❌ Chunk ${i + 1} failed completely`);
      }
    }
    
    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`✅ TOTAL EXTRACTED: ${allTransactions.length} transactions`);

  if (allTransactions.length === 0) {
    throw new Error("No transactions extracted. Please check the statement format.");
  }

  return { extractedTransactions: allTransactions };
};