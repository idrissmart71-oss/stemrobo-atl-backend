import { GoogleGenAI, Type } from "@google/genai";

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

/* ================= MAIN ANALYSIS FUNCTION ================= */

export const analyzeTransactionsAI = async (
  ocrText: string,
  fileData?: FileData,
  mode: "Auditor" | "School" = "Auditor",
  accountType: "Savings" | "Current" = "Savings"
): Promise<GeminiResult> => {

  /* ================= SYSTEM INSTRUCTION ================= */

  const systemInstruction = `
You are a SENIOR GOVERNMENT FINANCIAL AUDITOR working for
NITI Aayog – Atal Tinkering Labs (ATL).

THIS IS A BANK STATEMENT ANALYSIS TASK.
Accuracy is MORE IMPORTANT than completeness.

CRITICAL RULES (NO EXCEPTIONS):
1. You MUST use ONLY the data explicitly present in the document or OCR text.
2. You are STRICTLY FORBIDDEN from inventing, estimating, or guessing:
   - dates
   - amounts
   - narrations
   - transaction counts
3. If any value is unclear or missing → return null.
4. If NO transactions are clearly identifiable → return an EMPTY array.
5. DO NOT summarize the document.
6. DO NOT return explanations outside JSON.

YOUR JOB IS NOT OCR.
YOUR JOB IS STRUCTURED EXTRACTION + COMPLIANCE CHECKING.

================ ATL FUNDING RULES ================

TRANCHE 1:
Savings Account:
- Total: ₹12,00,000
- Non-Recurring (Capital): ₹10,00,000
- Recurring (Operational): ₹2,00,000

Current Account:
- Net after TDS: ₹11,76,000
- Non-Recurring: ₹9,76,000
- Recurring: ₹2,00,000

TRANCHE 2 & 3:
- Savings: ₹4,00,000 (Recurring only)
- Current: ₹3,92,000 (Recurring only, post-TDS)

================ TRANSACTION RULES ================

CREDITS:
- Always classify as "Grant Receipt"

DEBITS:
- Non-Recurring: equipment, machinery, furniture, laptops, electronics
- Recurring: kits, workshops, maintenance, AMC, travel
- Ineligible: personal, retail shopping, stationery

================ OUTPUT EXPECTATIONS ================

You MUST return JSON in this EXACT format:

{
  "transactions": [
    {
      "date": "DD/MM/YYYY | null",
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

================ MODE =================
Mode: ${mode}
Account Type: ${accountType}
`;

  /* ================= USER PROMPT ================= */

  const userPrompt = `
STEP 1:
From the text below, identify ONLY lines that clearly represent
bank transactions (date + narration + debit/credit amount).

STEP 2:
Convert each transaction into a structured object.

STEP 3:
Apply ATL compliance rules.

IMPORTANT:
- If OCR text is messy, do NOT guess.
- If a transaction is incomplete, still include it but use null fields.
- Transactions array MUST NOT be empty if debits/credits are visible.

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
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  narration: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  type: { type: Type.STRING },
                  category: { type: Type.STRING },
                  tranche: { type: Type.STRING },
                  financialYear: { type: Type.STRING },
                  riskScore: { type: Type.STRING },
                  verificationStatus: { type: Type.STRING },
                  isFlagged: { type: Type.BOOLEAN },
                  flagReason: { type: Type.STRING }
                }
              }
            },
            observations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  observation: { type: Type.STRING },
                  recommendation: { type: Type.STRING }
                }
              }
            },
            
            complianceChecklist: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  status: { type: Type.STRING },
                  comment: { type: Type.STRING }
                }
              }
            }
            
          }
        }
      }
    });

    return JSON.parse(response.text || "{}");

  } catch (error) {
    console.error("🔥 Gemini analysis failed:", error);
    return {
      transactions: [],
      observations: [],
      complianceChecklist: []
    };
  }
};
