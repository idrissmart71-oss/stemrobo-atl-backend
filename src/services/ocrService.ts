import { ImageAnnotatorClient } from "@google-cloud/vision";

/* ================= GOOGLE VISION CLIENT ================= */

let credentials;
try {
  // Try parsing as JSON first
  credentials = JSON.parse(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "{}"
  );
} catch (parseError) {
  // If that fails, try base64 decoding
  try {
    const base64Creds = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 || "";
    const decoded = Buffer.from(base64Creds, 'base64').toString('utf8');
    credentials = JSON.parse(decoded);
  } catch (base64Error) {
    console.error("🔥 Failed to parse Google credentials:", base64Error);
    credentials = {};
  }
}

const visionClient = new ImageAnnotatorClient({
  credentials
});

/* ================= OCR FUNCTION ================= */

export const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
  console.log("🔍 Starting text extraction, buffer size:", buffer.length);

  // 1️⃣ Try digital PDF extraction first
  try {
    const pdfParseModule: any = await import("pdf-parse");
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const pdfData = await pdfParse(buffer);

    if (pdfData?.text && pdfData.text.trim().length > 100) {
      console.log("✅ Digital PDF text extracted:", pdfData.text.length, "chars");
      return pdfData.text;
    } else {
      console.log("⚠️ Digital PDF extraction returned insufficient text");
    }
  } catch (err) {
    console.log("⚠️ Digital PDF extraction failed, falling back to OCR:", err);
  }

  // 2️⃣ Vision OCR fallback (SCANNED PDF / IMAGE)
  console.log("🔍 Using Google Vision OCR");

  try {
    const [result] = await visionClient.textDetection({
      image: { content: buffer.toString("base64") }
    });

    const detections = result.textAnnotations;
    const extractedText = detections?.[0]?.description || "";

    if (!extractedText || extractedText.trim().length < 50) {
      throw new Error("Insufficient text extracted from document");
    }

    console.log("✅ OCR extracted:", extractedText.length, "chars");
    return extractedText;
  } catch (ocrError: any) {
    console.error("🔥 OCR failed:", ocrError);
    throw new Error("Could not extract text from document. Please ensure the document is clear and readable.");
  }
};