import { GoogleGenAI } from "@google/genai";

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
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

  const systemInstruction = `
You are an OCR + Financial Classification engine for NITI Aayog ATL audits.

STRICT RULES:
- DO NOT summarize
- DO NOT invent transactions
- DO NOT calculate totals
- ONLY extract and classify EACH transaction

CLASSIFICATION:
CAPITAL → equipment, computers, furniture, lab setup
RECURRING → salary, kits, workshops, travel, maintenance
INTEREST → bank interest credit
SALARY → honorarium, wages, staff payment
INELIGIBLE → unclear, personal, ATM, cash withdrawal

OUTPUT JSON ONLY.
`;

  const prompt = `
Extract ALL transactions from the bank statement.

For EACH transaction return:
- narration
- amount (number)
- direction: DEBIT or CREDIT
- intent: CAPITAL | RECURRING | INTEREST | SALARY | INELIGIBLE

Text:
${rawText || "Refer to uploaded document"}
`;

  const contents = fileData
    ? { parts: [fileData, { text: prompt }] }
    : prompt;

  let response;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: "models/gemini-2.5-flash",
        contents,
        config: { systemInstruction }
      });
      break;
    } catch (err: any) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }

  const cleaned = response!.text!
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
};
