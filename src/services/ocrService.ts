import { ImageAnnotatorClient } from "@google-cloud/vision";

/* ================= GOOGLE VISION CLIENT ================= */

const visionClient = new ImageAnnotatorClient({
  credentials: JSON.parse(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "{}"
  )
});

/* ================= OCR FUNCTION ================= */

export const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
  // 1️⃣ Try digital PDF extraction first
  try {
    const pdfParseModule: any = await import("pdf-parse");
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const pdfData = await pdfParse(buffer);

    if (pdfData?.text && pdfData.text.trim().length > 100) {
      console.log("✅ Digital PDF text extracted");
      return pdfData.text;
    }
  } catch {
    // ignore and fallback to OCR
  }

  // 2️⃣ Vision OCR fallback (SCANNED PDF)
  console.log("🔍 Using Google Vision OCR");

  const [result] = await visionClient.textDetection({
    image: { content: buffer.toString("base64") }
  });

  const detections = result.textAnnotations;
  return detections?.[0]?.description || "";
};
