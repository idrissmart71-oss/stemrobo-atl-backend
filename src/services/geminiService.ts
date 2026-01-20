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
You are a financial transaction classifier for NITI Aayog ATL (Atal Tinkering Lab) audits.

FUNDING STRUCTURE:
${fundingInfo}

CLASSIFICATION RULES:
1. CAPITAL → Equipment, computers, furniture, lab setup, tools, machines, infrastructure
2. RECURRING → Salary, honorarium, wages, staff payment, kits, workshops, travel, maintenance, utilities
3. INTEREST → Bank interest credit (for Savings account)
4. SALARY → Specifically honorarium, wages, staff payment
5. GRANT → Grant receipt, fund transfer from NITI Aayog, cash deposits for ATL
6. INELIGIBLE → Bank charges, ATM fees, minimum balance charges, GST on bank charges, personal expenses

IMPORTANT RULES:
- Extract EVERY transaction from the statement
- DO NOT skip any transactions
- DO NOT summarize
- DO NOT calculate totals
- Include date if visible (format: DD-MM-YYYY)
- For bank statements, extract dates, narrations, and amounts carefully

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no backticks, no explanation):
{
  "extractedTransactions": [
    {
      "date": "DD-MM-YYYY",
      "narration": "Transaction description",
      "amount": 1000,
      "direction": "DEBIT" or "CREDIT",
      "intent": "CAPITAL" | "RECURRING" | "INTEREST" | "SALARY" | "GRANT" | "INELIGIBLE",
      "gstNo": null,
      "voucherNo": null
    }
  ]
}
`;

  const prompt = `
Extract ALL transactions from this bank statement text.

Account Type: ${accountType}
Mode: ${mode}

Bank Statement:
${rawText}

Return ONLY the JSON object. No markdown formatting. No backticks. Just the JSON.
`;

  let response;

  // Retry logic with exponential backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp",
        systemInstruction,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16000, // Increased from 8000
          responseMimeType: "application/json" // Force JSON response
        }
      });
      
      response = await model.generateContent(prompt);
      break;
    } catch (err: any) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }

  const rawResponse = response!.response.text();
  console.log("📝 Raw Gemini response:", rawResponse.substring(0, 500));

  // Clean the response - remove markdown and extra text
  let cleaned = rawResponse
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // If response starts with explanation, find the JSON
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.extractedTransactions) {
      console.error("❌ Missing extractedTransactions in response");
      console.error("Parsed object keys:", Object.keys(parsed));
      throw new Error("Missing extractedTransactions in response");
    }

    console.log(`✅ Successfully parsed ${parsed.extractedTransactions.length} transactions`);
    return parsed;
  } catch (parseError: any) {
    console.error("🔥 JSON Parse Error:", parseError.message);
    console.error("Raw response (first 1000 chars):", cleaned.substring(0, 1000));
    console.error("Raw response (last 500 chars):", cleaned.substring(cleaned.length - 500));
    
    // Try to salvage partial data
    try {
      // If JSON is truncated, try to close it
      const salvaged = cleaned + ']}';
      const parsed = JSON.parse(salvaged);
      if (parsed.extractedTransactions && parsed.extractedTransactions.length > 0) {
        console.log("⚠️ Salvaged partial data:", parsed.extractedTransactions.length, "transactions");
        return parsed;
      }
    } catch {
      // Salvage attempt failed
    }
    
    throw new Error("Failed to parse AI response. The document might be too large. Try splitting it into smaller sections.");
  }
};