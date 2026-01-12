import * as pdfParse from "pdf-parse";
import Tesseract from "tesseract.js";

/**
 * Extract text from PDF or scanned document
 */
export const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
  // 1️⃣ Try normal PDF text extraction
  const pdfData = await pdfParse.default(buffer);

  if (pdfData.text && pdfData.text.trim().length > 50) {
    return pdfData.text;
  }

  // 2️⃣ Fallback to OCR for scanned PDFs / images
  const ocrResult = await Tesseract.recognize(buffer, "eng");

  return ocrResult.data.text || "";
};
