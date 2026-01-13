import { GoogleGenAI } from "@google/genai";

/* ================= INTERFACES ================= */

export interface FileData {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export interface GeminiResult {
  transactions: any[];
  observations: any[];
  complianceChecklist: any[];
}

/* ================= GEMINI INIT ================= */

const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY!
});

/* ================= MAIN FUNCTION ================= */

export const analyzeTransactionsAI = async (
  ocrText: string,
  fileData?: FileData,
  mode: "Auditor" | "School" = "Auditor",
  accountType: "Savings" | "Current" = "Savings"
): Promise<GeminiResult> => {

  /* ================= SYSTEM INSTRUCTION ================= */

  const systemInstruction = `
You are a SENIOR GOVERNMENT FINANCIAL AUDITOR for
NITI Aayog – Atal Tinkering Labs (ATL).

THIS IS A BANK STATEMENT ANALYSIS TASK.

ABSOLUTE RULES (NO EXCEPTIONS):
1. Use ONLY information explicitly present in the document or OCR text.
2. DO NOT guess, infer, estimate, or fabricate any value.
3. If a value is missing or unclear → set it as null.
4. If transactions exist → transactions array MUST NOT be empty.
5. If NO transactions exist → return an EMPTY array.
6. DO NOT summarize or explain.
7. Return ONLY VALID JSON.

================ ATL FUNDING RULES ================

TRANCHE 1:
Savings Account:
- ₹12,00,000 total
- ₹10,00,000 Non-Recurring
- ₹2,00,000 Recurring

Current Account:
- ₹11,76,000 after TDS
- ₹9,76,000 Non-Recurring
- ₹2,00,000 Recurring

TRANCHE 2 & 3:
- Recurring only

================ CLASSIFICATION RULES ================

CREDITS:
- Always "Grant Receipt"

DEBITS:
- Non-Recurring → equipment, machinery, furniture, laptops
- Recurring → kits, workshops, AMC, maintenance, travel
- Ineligible → personal, retail, stationery

================ OUTPUT FORMAT (MANDATORY) ================

Return JSON in EXACTLY this format:

{
  "transactions": [
    {
      "date": "string | null",
      "narration": "string | null",
      "amount": number | null,
      "type": "Debit | Credit",
      "category": "Non-Recurring | Recurring | Ineligible | Grant Receipt",
      "tranche": "Tranche 1 | Tranche 2 | Tranche 3 | Unknown",
      "financialYear": "YYYY-YY | null",
      "riskScore": "LOW | MEDIUM | HIGH",
      "verificationStatus": "Verified | Missing | Doubtful",
      "isFlagged": boolean,
      "flagReason": "string | null"
    }
  ],
  "observations": [],
  "complianceChecklist": []
}

Mode: ${mode}
Account Type: ${accountType}
`;

  /* ================= USER PROMPT ================= */

  const userPrompt = `
STEP 1:
Read the OCR text below and identify ONLY clear transaction rows
(date + narration + debit/credit amount).

STEP 2:
Convert each row into a structured transaction.

STEP 3:
Apply ATL compliance rules.

IMPORTANT:
- DO NOT create imaginary transactions.
- Preserve exact amounts and dates as written.

================ OCR TEXT =================
${ocrText}
`;

  /* ================= CONTENT STRUCTURE ================= */

  const contents = fileData
    ? [
        { role: "user", parts: [fileData] },
        { role: "user", parts: [{ text: userPrompt }] }
      ]
    : [
        { role: "user", parts: [{ text: userPrompt }] }
      ];

  /* ================= GEMINI CALL ================= */

  try {
    const response = await ai.models.generateContent({
      model: "models/gemini-2.5-flash",
      contents,
      config: {
        systemInstruction
      }
    });

    const raw = response.text?.trim();

    if (!raw) {
      throw new Error("Empty Gemini response");
    }

    return JSON.parse(raw);

  } catch (error) {
    console.error("🔥 Gemini analysis failed:", error);
    return {
      transactions: [],
      observations: [],
      complianceChecklist: []
    };
  }
};
