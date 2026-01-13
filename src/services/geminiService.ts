import { GoogleGenAI, Type } from "@google/genai";
import {
  ExpenseCategory,
  TrancheType,
  RiskLevel,
  VerificationStatus
} from "../types/atl.js";

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
  /* ---------- SYSTEM INSTRUCTION ---------- */
  const systemInstruction = `
You are a Senior Financial Auditor for NITI Aayog ATL Compliance.

STRICT FUNDING RULES:
- Tranche 1 Savings: ₹12,00,000 (₹10L Non-Recurring + ₹2L Recurring)
- Tranche 1 Current: ₹11,76,000 (after TDS)
- Tranche 2 & 3: Recurring only

CATEGORIZATION:
• Credits → Grant Receipt
• Non-Recurring → Equipment, furniture, electronics
• Recurring → Kits, workshops, AMC, travel
• Ineligible → Personal / retail expenses

MODE:
• Auditor → strict audit flags
• School → suggest corrections

Mode: ${mode}
Account Type: ${accountType}
`;

  /* ---------- USER PROMPT ---------- */
  const userPrompt = `
STEP 1: Read the attached bank statement and extract ALL transactions
(date, narration, debit, credit).

STEP 2: Convert them into structured records.

STEP 3: Apply ATL compliance rules.

Return ONLY valid JSON:
{
  "transactions": [],
  "observations": [],
  "complianceChecklist": []
}
`;

  /* ---------- CONTENTS (PDF FIRST, PROMPT SECOND) ---------- */
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
          parts: [{ text: `${userPrompt}\n\nDATA:\n${textData}` }]
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
                  enum: ["Non-Recurring", "Recurring", "Ineligible", "Grant Receipt"]
                },
                tranche: {
                  type: Type.STRING,
                  enum: Object.values(TrancheType)
                },
                financialYear: { type: Type.STRING },
                riskScore: {
                  type: Type.STRING,
                  enum: Object.values(RiskLevel)
                },
                verificationStatus: {
                  type: Type.STRING,
                  enum: Object.values(VerificationStatus)
                },
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
    console.error("Gemini JSON parse failed:", err);
    return {
      transactions: [],
      observations: [],
      complianceChecklist: []
    };
  }
};
