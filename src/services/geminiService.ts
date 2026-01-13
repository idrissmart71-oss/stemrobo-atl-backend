import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY
});

/**
 * Analyze transactions using Gemini
 * Supports TEXT + PDF (inlineData)
 */
export const analyzeTransactionsAI = async (
  textData: string,
  fileData?: {
    inlineData: {
      data: string;
      mimeType: string;
    };
  },
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
) => {
  const systemInstruction = `
You are a Senior Financial Auditor for NITI Aayog ATL Compliance.
Analyze bank statements and flag compliance issues.
Mode: ${mode}
Account Type: ${accountType}
`;

  const prompt = `
Analyze this bank statement and return structured JSON:
- transactions
- observations
- complianceChecklist
`;

  const contents = fileData
    ? {
        parts: [
          fileData,
          { text: prompt }
        ]
      }
    : prompt + "\n\nData:\n" + textData;

  const response = await ai.models.generateContent({
    model: "gemini-1.5-pro",
    contents,
    config: {
      systemInstruction,
      responseMimeType: "application/json"
    }
  });

  return JSON.parse(response.text || "{}");
};
