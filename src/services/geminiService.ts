
import { GoogleGenAI, Type } from "@google/genai";
import { ExpenseCategory, TrancheType, RiskLevel, VerificationStatus } from "../types";

import { GoogleGenAI, Type } from "@google/genai";
import {
  ExpenseCategory,
  TrancheType,
  RiskLevel,
  VerificationStatus
} from "../types";

/* ================= INTERFACE ================= */

export interface FileData {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

/* ================= GEMINI INIT ================= */

const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY!
});

/* ================= MAIN FUNCTION ================= */

export const analyzeTransactionsAI = async (
  textData: string,
  fileData?: FileData,
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
) => {
  /* ---------- SYSTEM INSTRUCTION (ALWAYS APPLIED) ---------- */
  const systemInstruction = `
You are a Senior Financial Auditor for NITI Aayog ATL Compliance.

Your task is to analyze bank statements and ensure strict adherence
to ATL funding rules.

STRICT TRANCHE RULES:

TRANCHE 1:
• Savings Account: ₹12,00,000
  - ₹10,00,000 → Non-Recurring (Capital)
  - ₹2,00,000 → Recurring (Operational)

• Current Account: ₹11,76,000 (after 2% TDS)
  - ₹9,76,000 → Non-Recurring
  - ₹2,00,000 → Recurring
  - ₹24,000 TDS deducted from Capital

TRANCHE 2 & 3:
• Savings: ₹4,00,000 (Recurring)
• Current: ₹3,92,000 (Recurring after TDS)

CATEGORIZATION RULES:
1. Credits → "Grant Receipt" only
2. Non-Recurring → Equipment, furniture, electronics, laptops
3. Recurring → Kits, workshops, maintenance, AMC, travel
4. Ineligible → Personal, retail, general stationery

AUDIT LOGIC:
• If Non-Recurring exceeds allowed cap → HIGH RISK
• Flag missing vouchers, GST, or narration issues

MODE:
• Auditor → Strict, highlight violations
• School → Suggest safe reclassification

Mode: ${mode}
Account Type: ${accountType}
`;

  /* ---------- USER PROMPT ---------- */
  const userPrompt = `
STEP 1: Read the attached bank statement PDF and extract ALL transactions
line-by-line exactly as they appear (date, narration, debit, credit, balance).

STEP 2: Convert the extracted data into structured transactions.

STEP 3: Classify each transaction using ATL rules.

STRICT REQUIREMENT:
- If no transactions are found, return an EMPTY array, not a summary.
- Do NOT skip transaction extraction.

Return ONLY valid JSON in this format:
{
  "transactions": [],
  "observations": [],
  "complianceChecklist": []
}

IMPORTANT:
- Transactions array MUST be populated if any debits/credits exist.
- Do NOT include explanations outside JSON.
`;


  /* ---------- CONTENTS (PDF OR TEXT) ---------- */
  const contents = fileData
  ? [
      {
        role: "user",
        parts: [fileData]
      },
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ]
  : [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ];


  /* ---------- GEMINI CALL ---------- */
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
                type: {
                  type: Type.STRING,
                  enum: ["Debit", "Credit"]
                },
                category: {
                  type: Type.STRING,
                  enum: Object.values(ExpenseCategory)
                },
                tranche: {
                  type: Type.STRING,
                  enum: Object.values(TrancheType)
                },
                financialYear: { type: Type.STRING },
                riskScore: {
                  type: Type.STRING,
                  enum: ["LOW", "MEDIUM", "HIGH"]
                },
                verificationStatus: {
                  type: Type.STRING,
                  enum: ["Verified", "Missing", "Doubtful"]
                },
                isFlagged: { type: Type.BOOLEAN },
                flagReason: { type: Type.STRING },
                gstNo: { type: Type.STRING },
                voucherNo: { type: Type.STRING }
              },
              required: [
                "date",
                "narration",
                "amount",
                "type",
                "category",
                "tranche",
                "financialYear",
                "riskScore",
                "verificationStatus",
                "isFlagged"
              ]
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
                status: {
                  type: Type.STRING,
                  enum: ["Compliant", "Warning", "Non-Compliant"]
                },
                comment: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  /* ---------- SAFE PARSE ---------- */
  try {
    return JSON.parse(response.text?.trim() || "{}");
  } catch (err) {
    console.error("Failed to parse Gemini response", err);
    return {
      transactions: [],
      observations: [],
      complianceChecklist: []
    };
  }
};

