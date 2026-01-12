import { createRequire } from "module";
import Tesseract from "tesseract.js";

const require = createRequire(import.meta.url);

// Load CommonJS module safely in ESM
const pdfParse = require("pdf-parse");

/**
 * Extract text from PDF or scanned document
 */
export const extractTextFromPDF = async (
  buffer: Buffer
): Promise<string> => {
  // 1️⃣ Try native PDF text extraction
  const data = await pdfParse(buffer);

  if (data?.text && data.text.trim().length > 50) {
    return data.text;
  }

  // 2️⃣ Fallback OCR for scanned PDFs / images
  const ocrResult = await Tesseract.recognize(buffer, "eng");
  return ocrResult.data.text || "";
};
