import { GoogleGenerativeAI } from "@google/generative-ai";

export interface FileData {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export const analyzeTransactionsAI = async (
  rawText: string,
  fileData?: FileData,
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
- Min balance charges & GST included in Non-Recurring
` 
    : `
SAVINGS ACCOUNT (Gross):
- Tranche 1: ₹12,00,000 GROSS (₹10,00,000 Non-Recurring + ₹2,00,000 Recurring)
- Tranche 2: ₹4,00,000 (All Recurring)
- Tranche 3: ₹4,00,000 (All Recurring)
- Total: ₹20,00,000 GROSS
- Interest credit included in Non-Recurring but credited back to Bharat Kosh
`;

  const systemInstruction = `
You are an OCR + Financial Classification engine for NITI Aayog ATL (Atal Tinkering Lab) audits.

FUNDING STRUCTURE:
${fundingInfo}

CLASSIFICATION RULES:
1. CAPITAL → Equipment, computers, furniture, lab setup, tools, machines, infrastructure
2. RECURRING → Salary, honorarium, wages, staff payment, kits, workshops, travel, maintenance, utilities
3. INTEREST → Bank interest credit (for Savings account)
4. SALARY → Specifically honorarium, wages, staff payment
5. GRANT → Grant receipt, fund transfer from NITI Aayog
6. INELIGIBLE → Unclear, personal expenses, ATM withdrawals, cash withdrawal, non-ATL expenses

STRICT RULES:
- Extract EVERY transaction visible in the statement
- DO NOT summarize or group transactions
- DO NOT invent transactions
- DO NOT calculate totals
- Include date if visible
- Extract GST number if present
- Extract voucher/cheque number if present
- Classify intent based on narration keywords

OUTPUT FORMAT:
Return ONLY valid JSON with this structure:
{
  "extractedTransactions": [
    {
      "date": "DD-MM-YYYY or null",
      "narration": "Full transaction description",
      "amount": number (absolute value),
      "direction": "DEBIT" or "CREDIT",
      "intent": "CAPITAL" | "RECURRING" | "INTEREST" | "SALARY" | "GRANT" | "INELIGIBLE",
      "gstNo": "GST number or null",
      "voucherNo": "Voucher/Cheque number or null"
    }
  ]
}

IMPORTANT:
- Be strict with classification
- Mark as INELIGIBLE if unclear
- Extract ALL transactions, even small ones
- Include both debits and credits
`;

  const prompt = `
Extract ALL transactions from this bank statement.

Account Type: ${accountType}
Mode: ${mode}

Bank Statement Text:
${rawText || "Refer to uploaded document"}

Return ONLY the JSON structure specified in system instructions.
`;

  let response;

  // Retry logic with exponential backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        systemInstruction,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8000
        }
      });
      
      if (fileData) {
        response = await model.generateContent([
          fileData,
          { text: prompt }
        ]);
      } else {
        response = await model.generateContent(prompt);
      }
      
      break;
    } catch (err: any) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }

  const rawResponse = response!.response.text();
  console.log("📝 Raw Gemini response:", rawResponse.substring(0, 500));

  const cleaned = rawResponse
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.extractedTransactions) {
      throw new Error("Missing extractedTransactions in response");
    }

    return parsed;
  } catch (parseError) {
    console.error("🔥 JSON Parse Error:", parseError);
    console.error("Raw response:", cleaned.substring(0, 1000));
    throw new Error("Failed to parse AI response. Please try again.");
  }
};