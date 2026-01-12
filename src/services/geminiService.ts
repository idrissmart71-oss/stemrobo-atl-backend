
import { GoogleGenAI, Type } from "@google/genai";
import { ExpenseCategory, TrancheType, RiskLevel, VerificationStatus } from "../types";

export interface FileData {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export const analyzeTransactionsAI = async (
  textData: string, 
  fileData?: FileData, 
  mode: 'Auditor' | 'School' = 'School',
  accountType: 'Savings' | 'Current' = 'Savings'
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `You are a Senior Financial Auditor for NITI Aayog ATL Compliance. 
  Your primary task is to reconcile expenditures against strictly capped budget buckets.
  
  STRICT TRANCHE 1 FUNDING SPLIT:
  - SAVINGS ACCOUNT (Gross): Total T1 = ₹12,00,000. 
    * MUST categorize: ₹10,00,000 as Non-Recurring (Capital) and ₹2,00,000 as Recurring (Operational).
  - CURRENT ACCOUNT (Net): Total T1 = ₹11,76,000 (after 2% TDS of ₹24k). 
    * MUST categorize: ₹9,76,000 as Non-Recurring (Capital) and ₹2,00,000 as Recurring (Operational). 
    * Note: The ₹24k TDS is deducted from the Capital/Non-Recurring portion.
  
  TRANCHE 2 & 3:
  - Savings: ₹4,00,000 (All Recurring).
  - Current: ₹3,92,000 (All Recurring - TDS of ₹8k deducted).
  
  CATEGORIZATION RULES:
  1. CREDITS: Label as 'Grant Receipt'. NEVER label a credit as 'Non-Recurring' or 'Recurring'.
  2. DEBITS: 
     - Non-Recurring: Lab equipment, furniture, laptops, electronics.
     - Recurring: Maintenance, kits, workshops, travel, AMC.
     - Ineligible: Personal, general stationary, retail.
  3. AUDIT OBJECTION: If Non-Recurring expenditure exceeds the account-specific cap (₹10L/₹9.76L), flag as HIGH RISK.
  
  Mode '${mode}': 
  - Auditor: Strict observation of overspending.
  - School: Suggest reclassification to avoid audit objections.`;

  const prompt = `Analyze this ${accountType} bank statement. 
    1. Extract all transactions.
    2. Correctly identify the T1 Receipt and split its allocation logically based on the ${accountType} account rules.
    3. Categorize Debits. Verify if Capital (Non-Recurring) spending has exceeded the strict ₹10L/₹9.76L limit.
    4. Categorize Recurring spending and check if it fits the ₹2L per tranche limit.
    5. Generate Risk Scores and Audit Observations.
    
    Data: ${textData || "See attached document"}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: fileData ? { parts: [fileData, { text: prompt }] } : prompt,
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
                type: { type: Type.STRING, enum: ['Debit', 'Credit'] },
                category: { type: Type.STRING, enum: Object.values(ExpenseCategory) },
                tranche: { type: Type.STRING, enum: Object.values(TrancheType) },
                financialYear: { type: Type.STRING },
                riskScore: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
                verificationStatus: { type: Type.STRING, enum: ['Verified', 'Missing', 'Doubtful'] },
                isFlagged: { type: Type.BOOLEAN },
                flagReason: { type: Type.STRING },
                gstNo: { type: Type.STRING },
                voucherNo: { type: Type.STRING }
              },
              required: ['date', 'narration', 'amount', 'type', 'category', 'tranche', 'financialYear', 'riskScore', 'verificationStatus', 'isFlagged']
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
                status: { type: Type.STRING, enum: ['Compliant', 'Warning', 'Non-Compliant'] },
                comment: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  try {
    return JSON.parse(response.text?.trim() || "{}");
  } catch (e) {
    console.error("Failed to parse AI response", e);
    return { transactions: [], observations: [], complianceChecklist: [] };
  }
};
