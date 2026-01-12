import express from "express";
import { upload } from "../middleware/upload.js";
import { extractTextFromImage } from "../services/ocrService.js";
import { analyzeTransactionsAI } from "../services/geminiService.js";
import { generateReport } from "../controllers/reportController.js";

const router = express.Router();

/**
 * TEXT-ONLY ANALYSIS
 */
router.post("/", generateReport);

/**
 * DOCUMENT UPLOAD (PDF / IMAGE)
 */
router.post(
  "/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      console.log("📥 Upload route hit");

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { mimetype, buffer } = req.file;
      const mode =
        req.body.mode === "Auditor" ? "Auditor" : "School";
      const accountType =
        req.body.accountType === "Current" ? "Current" : "Savings";

      /* ========== PDF CASE ========== */
      if (mimetype === "application/pdf") {
        console.log("📄 PDF detected — sending directly to Gemini");

        const prompt =
          "Analyze this uploaded bank statement PDF for ATL compliance. " +
          "Extract transactions, categorize expenses, and flag audit risks.";

        const result = await analyzeTransactionsAI(
          prompt,
          undefined,
          mode,
          accountType
        );

        return res.json({ success: true, data: result });
      }

      /* ========== IMAGE CASE ========== */
      console.log("🖼 Image detected — running OCR");

      const extractedText = await extractTextFromImage(buffer);

      if (!extractedText || extractedText.trim().length < 30) {
        return res.status(400).json({
          error: "Image OCR failed. Upload a clearer image."
        });
      }

      const result = await analyzeTransactionsAI(
        extractedText,
        undefined,
        mode,
        accountType
      );

      return res.json({ success: true, data: result });

    } catch (error) {
      console.error("🔥 Document analysis error:", error);
      return res.status(500).json({
        error: "Document analysis failed"
      });
    }
  }
);

export default router;
