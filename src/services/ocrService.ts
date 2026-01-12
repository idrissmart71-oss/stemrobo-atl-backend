import { createRequire } from "module";
import Tesseract from "tesseract.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export const extractTextFromPDF = async (
  buffer: Buffer
): Promise<string> => {

  const data = await pdfParse(buffer);

  console.log("📄 PDF PARSE TEXT LENGTH:", data?.text?.length || 0);
  console.log("📄 PDF PARSE SAMPLE:", data?.text?.slice(0, 500));

  if (data?.text && data.text.trim().length > 100) {
    return data.text;
  }

  console.log("⚠️ Falling back to OCR");

  const ocrResult = await Tesseract.recognize(buffer, "eng");

  console.log("🧠 OCR TEXT LENGTH:", ocrResult.data.text.length);
  console.log("🧠 OCR SAMPLE:", ocrResult.data.text.slice(0, 500));

  return ocrResult.data.text || "";
};
