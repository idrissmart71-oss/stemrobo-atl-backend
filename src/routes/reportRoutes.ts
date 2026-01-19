import express from "express";
import { analyzeTransactionsAI } from "../services/geminiService.js";

const router = express.Router();

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

/* ================= TEXT-BASED ROUTE (Main Route) ================= */

router.post("/", async (req, res) => {
  try {
    console.log("📝 Text-based analysis route hit");

    const { textData, mode = "School", accountType = "Savings" } = req.body;

    if (!textData || !textData.trim()) {
      return res.status(400).json({ error: "No text data provided" });
    }

    console.log("📊 Analyzing text, length:", textData.length);

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
  } catch (err: any) {
    console.error("🔥 Text analysis failed:", err);
    res.status(500).json({ error: err.message || "Text analysis failed" });
  }
});

export default router;