import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const analyzeTransactionsAI = async (
  textData: string,
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
) => {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash"
  });

  const systemInstruction = `
You are a Senior Financial Auditor for NITI Aayog ATL Compliance.

STRICT TRANCHE 1 FUNDING SPLIT:
- SAVINGS ACCOUNT:
  ₹12,00,000 total
  ₹10,00,000 Non-Recurring
  ₹2,00,000 Recurring

- CURRENT ACCOUNT:
  ₹11,76,000 net
  ₹9,76,000 Non-Recurring
  ₹2,00,000 Recurring
  ₹24,000 TDS deducted from Capital

TRANCHE 2 & 3:
- Savings: ₹4,00,000 (Recurring)
- Current: ₹3,92,000 (Recurring after TDS)

RULES:
- Credits → "Grant Receipt"
- Debits:
  Non-Recurring → Equipment, furniture, electronics
  Recurring → Kits, AMC, workshops
- Overspend of Capital → HIGH RISK

Mode: ${mode}
Account Type: ${accountType}

Return STRICT JSON ONLY.
`;

  const prompt = `
Analyze the following bank statement and return JSON in this format:

{
  "transactions": [
    {
      "date": "",
      "narration": "",
      "amount": 0,
      "type": "Debit | Credit",
      "category": "",
      "tranche": "",
      "financialYear": "",
      "riskScore": "LOW | MEDIUM | HIGH",
      "verificationStatus": "Verified | Missing | Doubtful",
      "isFlagged": true,
      "flagReason": ""
    }
  ],
  "observations": [
    {
      "severity": "",
      "observation": "",
      "recommendation": ""
    }
  ],
  "complianceChecklist": [
    {
      "label": "",
      "status": "Compliant | Warning | Non-Compliant",
      "comment": ""
    }
  ]
}

BANK STATEMENT DATA:
${textData}
`;

  const result = await model.generateContent(
    systemInstruction + "\n\n" + prompt
  );

  const responseText = result.response.text();

  try {
    return JSON.parse(responseText);
  } catch (err) {
    console.error("Gemini JSON parse error:", err);
    return {
      transactions: [],
      observations: [],
      complianceChecklist: []
    };
  }
};
