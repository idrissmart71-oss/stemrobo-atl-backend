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
  INELIGIBLE = "Ineligible"
}

enum TrancheType {
  TRANCHE_1 = "Tranche 1"
}

enum VerificationStatus {
  Verified = "Verified",
  Doubtful = "Doubtful"
}

enum RiskLevel {
  LOW = "LOW",
  HIGH = "HIGH"
}

/* ================= ROUTE ================= */

router.post(
  "/generate-report/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      console.log("📥 Upload route hit");

      const mode = (req.body.mode || "School") as "School" | "Auditor";
      const accountType = (req.body.accountType ||
        "Savings") as "Savings" | "Current";

      let text = "";

      if (req.file?.mimetype === "application/pdf") {
        console.log("📄 PDF detected — extracting text");
        text = await extractTextFromPDF(req.file.buffer);
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

        return {
          id: `txn-${Date.now()}-${idx}`,
          date: "As per Statement",
          narration: t.narration || "—",
          amount: Math.abs(Number(t.amount) || 0),
          type: t.direction === "DEBIT" ? "Debit" : "Credit",
          category,
          tranche: TrancheType.TRANCHE_1,
          financialYear: "2024-25",
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
        transactions,
        observations: [],
        complianceChecklist: []
      });
    } catch (err) {
      console.error("🔥 Document analysis failed:", err);
      res.status(500).json({ error: "Analysis failed" });
    }
  }
);

export default router;
