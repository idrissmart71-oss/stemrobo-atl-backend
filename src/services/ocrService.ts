import { createRequire } from "module";
import Tesseract from "tesseract.js";

const require = createRequire(import.meta.url);

// Load pdf-parse safely (CommonJS → ESM compatible)
const pdfParseLib = require("pdf-parse");
const pdfParse =
  typeof pdfParseLib === "function"
    ? pdfParseLib
    : pdfParseLib.default;

/**
 * Extract text from PDF or scanned document
 */
export const extractTextFromPDF = async (
  buffer: Buffer
): Promise<string> => {
  // 1️⃣ Try normal PDF text extraction
  const data = await pdfParse(buffer);

  console.log("📄 PDF PARSE TEXT LENGTH:", data?.text?.length || 0);
  console.log("📄 PDF PARSE SAMPLE:", data?.text?.slice(0, 500));

  if (data?.text && data.text.trim().length > 100) {
    return data.text;
  }

  // 2️⃣ Fallback OCR for scanned PDFs / images
  console.log("⚠️ Falling back to OCR");

  const ocrResult = await Tesseract.recognize(buffer, "eng");

  console.log("🧠 OCR TEXT LENGTH:", ocrResult.data.text.length);
  console.log("🧠 OCR SAMPLE:", ocrResult.data.text.slice(0, 500));

  return ocrResult.data.text || "";
};
