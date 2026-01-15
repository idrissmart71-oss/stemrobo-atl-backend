import express from "express";
import multer from "multer";
import { analyzeTransactionsAI } from "../services/geminiService.js";
import { extractTextFromPDF } from "../services/ocrService.js";

const router = express.Router();
const upload = multer();

/* ================= LOCAL ENUMS ================= */

enum ExpenseCategory {
  NON_RECURRING = "Non-Recurring",
  RECURRING = "Recurring",
  INTEREST = "Interest",
  GRANT_RECEIPT = "Grant Receipt",
  INELIGIBLE = "Ineligible"
}

enum TrancheType {
  TRANCHE_1 = "Tranche 1",
  TRANCHE_2 = "Tranche 2",
  TRANCHE_3 = "Tranche 3",
  NONE = "None"
}

enum VerificationStatus {
  Verified = "Verified",
  Doubtful = "Doubtful",
  Missing = "Missing"
}

enum RiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH"
}

/* ================= TEXT-BASED ROUTE ================= */

router.post("/", async (req, res) => {
  try {
    console.log("📝 Text-based analysis route hit");

    const { textData, mode = "School", accountType = "Savings" } = req.body;

    if (!textData || !textData.trim()) {
      return res.status(400).json({ error: "No text data provided" });
    }

    const aiResult = await analyzeTransactionsAI(
      textData,
      undefined,
      mode as "School" | "Auditor",
      accountType as "Savings" | "Current"
    );

    const extracted = aiResult.extractedTransactions || [];

    const transactions = extracted.map((t: any, idx: number) => {
      let category: ExpenseCategory = ExpenseCategory.INELIGIBLE;

      if (t.intent === "CAPITAL") category = ExpenseCategory.NON_RECURRING;
      else if (t.intent === "RECURRING" || t.intent === "SALARY")
        category = ExpenseCategory.RECURRING;
      else if (t.intent === "INTEREST") category = ExpenseCategory.INTEREST;
      else if (t.intent === "GRANT") category = ExpenseCategory.GRANT_RECEIPT;

      return {
        id: `txn-${Date.now()}-${idx}`,
        date: t.date || "As per Statement",
        narration: t.narration || "—",
        amount: Math.abs(Number(t.amount) || 0),
        type: t.direction === "DEBIT" ? "Debit" : "Credit",
        category,
        tranche: TrancheType.TRANCHE_1,
        financialYear: "2024-25",
        gstNo: t.gstNo || null,
        voucherNo: t.voucherNo || null,
        verificationStatus:
          category === ExpenseCategory.INELIGIBLE
            ? VerificationStatus.Doubtful
            : VerificationStatus.Verified,
        riskScore:
          category === ExpenseCategory.INELIGIBLE
            ? RiskLevel.HIGH
            : RiskLevel.LOW
      };
    });

    console.log("✅ Returning transactions:", transactions.length);

    res.json({
      data: {
        transactions,
        observations: [],
        complianceChecklist: []
      }
    });
  } catch (err) {
    console.error("🔥 Text analysis failed:", err);
    res.status(500).json({ error: "Text analysis failed" });
  }
});

/* ================= FILE UPLOAD ROUTE ================= */

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    console.log("📥 Upload route hit");

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const mode = (req.body.mode || "School") as "School" | "Auditor";
    const accountType = (req.body.accountType || "Savings") as "Savings" | "Current";

    console.log("🔍 File type:", req.file.mimetype);

    let text = "";

    // Extract text from PDF or image
    if (req.file.mimetype === "application/pdf") {
      console.log("📄 PDF detected — extracting text");
      text = await extractTextFromPDF(req.file.buffer);
    } else if (req.file.mimetype.startsWith("image/")) {
      console.log("🖼️ Image detected — extracting text via OCR");
      text = await extractTextFromPDF(req.file.buffer); // Vision API handles both
    } else {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    console.log("📝 Extracted text length:", text.length);

    if (!text || text.trim().length < 50) {
      return res.status(400).json({ 
        error: "Could not extract readable text from document. Please ensure the document is clear and readable." 
      });
    }

    const aiResult = await analyzeTransactionsAI(
      text,
      undefined,
      mode,
      accountType
    );

    const extracted = aiResult.extractedTransactions || [];

    const transactions = extracted.map((t: any, idx: number) => {
      let category: ExpenseCategory = ExpenseCategory.INELIGIBLE;

      if (t.intent === "CAPITAL") category = ExpenseCategory.NON_RECURRING;
      else if (t.intent === "RECURRING" || t.intent === "SALARY")
        category = ExpenseCategory.RECURRING;
      else if (t.intent === "INTEREST") category = ExpenseCategory.INTEREST;
      else if (t.intent === "GRANT") category = ExpenseCategory.GRANT_RECEIPT;

      return {
        id: `txn-${Date.now()}-${idx}`,
        date: t.date || "As per Statement",
        narration: t.narration || "—",
        amount: Math.abs(Number(t.amount) || 0),
        type: t.direction === "DEBIT" ? "Debit" : "Credit",
        category,
        tranche: TrancheType.TRANCHE_1,
        financialYear: "2024-25",
        gstNo: t.gstNo || null,
        voucherNo: t.voucherNo || null,
        verificationStatus:
          category === ExpenseCategory.INELIGIBLE
            ? VerificationStatus.Doubtful
            : VerificationStatus.Verified,
        riskScore:
          category === ExpenseCategory.INELIGIBLE
            ? RiskLevel.HIGH
            : RiskLevel.LOW
      };
    });

    console.log("✅ Returning transactions:", transactions.length);

    res.json({
      data: {
        transactions,
        observations: [],
        complianceChecklist: []
      }
    });
  } catch (err: any) {
    console.error("🔥 Document analysis failed:", err);
    res.status(500).json({ 
      error: err.message || "Analysis failed" 
    });
  }
});

export default router;