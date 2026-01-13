import { GoogleGenAI } from "@google/genai";
type TrancheKey = "T1" | "T2" | "T3";


/* ================= INTERFACES ================= */

export interface FileData {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

interface RawTxn {
  date: string | null;
  narration: string | null;
  amount: number | null;
  direction: "Debit" | "Credit" | null;
}

/* ================= GEMINI INIT ================= */

const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY!
});

/* ================= ATL GRANT MATRIX ================= */

const GRANTS = {
  Savings: {
    T1: { total: 1200000, nonRecurring: 1000000, recurring: 200000 },
    T2: { total: 1600000, nonRecurring: 1000000, recurring: 600000 },
    T3: { total: 2000000, nonRecurring: 1000000, recurring: 1000000 }
  },
  Current: {
    T1: { total: 1176000, nonRecurring: 976000, recurring: 200000 },
    T2: { total: 1568000, nonRecurring: 976000, recurring: 592000 },
    T3: { total: 1960000, nonRecurring: 976000, recurring: 984000 }
  }
};

/* ================= HELPERS ================= */

const has = (n: string, r: RegExp) => r.test(n.toLowerCase());

const classifyDebit = (n: string) => {
  if (has(n, /salary|honorarium|wages|stipend/)) return "Recurring";
  if (has(n, /laptop|equipment|robot|printer|machine|hardware/)) return "Non-Recurring";
  if (has(n, /maintenance|kit|workshop|amc|internet|electric|bank charge|min bal/))
    return "Recurring";
  if (has(n, /upi|cash|withdraw/)) return "Ineligible";
  return "Ineligible";
};

/* ================= MAIN FUNCTION ================= */

export const analyzeTransactionsAI = async (
  ocrText: string,
  fileData?: FileData,
  mode: "Auditor" | "School" = "School",
  accountType: "Savings" | "Current" = "Savings"
) => {

  /* ---------- GEMINI: RAW EXTRACTION ONLY ---------- */
  const systemInstruction = `
Extract RAW bank transactions only.
Do NOT analyze, classify, or summarize.
Return ONLY explicit values.
`;

  const userPrompt = `
Extract transactions from OCR text.

Return JSON:
{
  "transactions": [
    {
      "date": "DD/MM/YYYY | null",
      "narration": "string | null",
      "amount": number | null,
      "direction": "Debit | Credit"
    }
  ]
}

OCR TEXT:
${ocrText}
`;

  const contents = fileData
    ? [
        { role: "user", parts: [fileData] },
        { role: "user", parts: [{ text: userPrompt }] }
      ]
    : [{ role: "user", parts: [{ text: userPrompt }] }];

  try {
    const response = await ai.models.generateContent({
      model: "models/gemini-2.5-flash",
      contents,
      config: { systemInstruction }
    });

    const raw = JSON.parse(response.text || "{}");

    let nonRecurringSpent = 0;
    let recurringSpent = 0;

    const transactions = (raw.transactions || []).map((t: RawTxn) => {
      const narration = t.narration || "";
      let category = "Ineligible";

      if (t.direction === "Credit") {
        if (has(narration, /interest/))
          category = "Interest (Refund to Bharat Kosh)";
        else category = "Grant Receipt";
      } else {
        category = classifyDebit(narration);
      }

      if (category === "Non-Recurring") nonRecurringSpent += t.amount || 0;
      if (category === "Recurring") recurringSpent += t.amount || 0;

      return {
        id: crypto.randomUUID(),
        date: t.date || "N/A",
        narration,
        amount: t.amount || 0,
        type: t.direction,
        category,
        tranche: "Auto",
        financialYear: "2024-25",
        riskScore: category === "Ineligible" ? "HIGH" : "LOW",
        verificationStatus: "Verified",
        gstNo: has(narration, /gst/) ? "Present" : null,
        voucherNo: null
      };
    });

    /* ---------- TRANCHE DETECTION ---------- */

    let tranche: TrancheKey = "T1";
    if (recurringSpent > GRANTS[accountType].T1.recurring) tranche = "T2";
    if (recurringSpent > GRANTS[accountType].T2.recurring) tranche = "T3";
    
    const grant = GRANTS[accountType][tranche];


    /* ---------- OBSERVATIONS ---------- */

    const observations = [];

    if (nonRecurringSpent > grant.nonRecurring) {
      observations.push({
        type: "NON_RECURRING_OVERSPEND",
        severity: "HIGH",
        observation: "Non-Recurring exceeds permitted limit",
        recommendation: "Reclassify or refund excess"
      });
    }

    if (recurringSpent > grant.recurring) {
      observations.push({
        type: "RECURRING_OVERSPEND",
        severity: "HIGH",
        observation: "Recurring exceeds permitted limit",
        recommendation: "Adjust expenses"
      });
    }

    /* ---------- FINAL RESPONSE ---------- */

    return {
      transactions,
      observations,
      complianceChecklist: [
        {
          label: "Grant Received",
          status: "Compliant",
          comment: `₹${grant.total} (${accountType}, ${tranche})`
        },
        {
          label: "Non-Recurring Utilization",
          status: nonRecurringSpent <= grant.nonRecurring ? "Compliant" : "Non-Compliant",
          comment: `₹${nonRecurringSpent} / ₹${grant.nonRecurring}`
        },
        {
          label: "Recurring Utilization",
          status: recurringSpent <= grant.recurring ? "Compliant" : "Non-Compliant",
          comment: `₹${recurringSpent} / ₹${grant.recurring}`
        }
      ]
    };

  } catch (error) {
    console.error("🔥 Gemini failed:", error);
    return {
      transactions: [],
      observations: [],
      complianceChecklist: []
    };
  }
};
