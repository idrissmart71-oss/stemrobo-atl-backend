import express from "express";
import { upload } from "../middleware/upload.js";
import { extractTextFromPDF } from "../services/ocrService.js";
import { analyzeTransactionsAI } from "../services/geminiService.js";
import { generateReport } from "../controllers/reportController.js";

const router = express.Router();

/**
 * TEXT-ONLY ANALYSIS
 * POST /generate-report
 */
router.post("/", generateReport);

/**
 * DOCUMENT UPLOAD (PDF / IMAGE OCR)
 * POST /generate-report/upload
 */
router.post(
  "/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      console.log("📥 Upload route hit");

      if (!req.file) {
        console.error("❌ No file received");
        return res.status(400).json({
          error: "No file uploaded"
        });
      }

      console.log("📄 File received:", {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      });

      // OCR / PDF text extraction
      const extractedText = await extractTextFromPDF(req.file.buffer);

      if (!extractedText || extractedText.trim().length < 30) {
        console.error("❌ OCR produced insufficient text");
        return res.status(400).json({
          error: "OCR failed or document unreadable"
        });
      }

      console.log("✅ OCR successful, length:", extractedText.length);

      const mode =
        req.body.mode === "Auditor" ? "Auditor" : "School";

      const accountType =
        req.body.accountType === "Current" ? "Current" : "Savings";

      const result = await analyzeTransactionsAI(
        extractedText,
        mode,
        accountType
      );

      return res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error("🔥 Document analysis error:", error);
      return res.status(500).json({
        error: "Document analysis failed"
      });
    }
  }
);

export default router;
