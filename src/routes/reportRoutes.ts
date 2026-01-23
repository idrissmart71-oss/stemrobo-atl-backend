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

    // Track spending to determine tranches
    let nonRecurringSpent = 0;
    let recurringSpent = 0;
    const maxNonRecT1 = accountType === "Current" ? 976000 : 1000000;
    const maxRecT1 = 200000;
    const maxRecT2 = 400000;
    
    const transactions = extracted.map((t: any, idx: number) => {
      let category: ExpenseCategory = ExpenseCategory.INELIGIBLE;
      let tranche: TrancheType = TrancheType.TRANCHE_1;

      // Map intent to GFR 12-A categories
      if (t.intent === "CAPITAL") {
        category = ExpenseCategory.NON_RECURRING;
      }
      else if (t.intent === "RECURRING" || t.intent === "SALARY") {
        category = ExpenseCategory.RECURRING;
      }
      else if (t.intent === "INTEREST") {
        category = ExpenseCategory.INTEREST;
      }
      else if (t.intent === "GRANT") {
        category = ExpenseCategory.GRANT_RECEIPT;
      }
      
      // Determine tranche based on spending
      if (t.type === 'Debit' || t.direction === 'DEBIT') {
        if (category === ExpenseCategory.NON_RECURRING) {
          nonRecurringSpent += t.amount;
          tranche = TrancheType.TRANCHE_1; // All capital in T1
        }
        else if (category === ExpenseCategory.RECURRING) {
          if (recurringSpent < maxRecT1) {
            tranche = TrancheType.TRANCHE_1;
            recurringSpent += t.amount;
          }
          else if (recurringSpent < maxRecT1 + maxRecT2) {
            tranche = TrancheType.TRANCHE_2;
            recurringSpent += t.amount;
          }
          else {
            tranche = TrancheType.TRANCHE_3;
            recurringSpent += t.amount;
          }
        }
      }

      return {
        id: `txn-${Date.now()}-${idx}`,
        date: t.date || "As per Statement",
        narration: t.narration || "—",
        amount: Math.abs(Number(t.amount) || 0),
        type: (t.direction || t.type) === "DEBIT" ? "Debit" : "Credit",
        category,
        tranche,
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

    console.log(`✅ Mapped ${transactions.length} transactions`);
    console.log(`📊 Non-Recurring: ₹${Math.round(nonRecurringSpent/1000)}K, Recurring: ₹${Math.round(recurringSpent/1000)}K`);

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