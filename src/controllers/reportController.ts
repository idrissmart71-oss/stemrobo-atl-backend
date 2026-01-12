import { Request, Response } from "express";
import { analyzeTransactionsAI } from "../services/geminiService.js";

export const generateReport = async (req: Request, res: Response) => {
  try {
    const { textData, mode, accountType } = req.body;

    if (!textData) {
      return res.status(400).json({ error: "textData is required" });
    }

    const result = await analyzeTransactionsAI(
      textData,
      mode,
      accountType
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "AI processing failed" });
  }
};
