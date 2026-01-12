import pdf from "pdf-parse";
import Tesseract from "tesseract.js";

export const extractTextFromPDF = async (buffer: Buffer) => {
  const data = await pdf(buffer);

  if (data.text && data.text.trim().length > 50) {
    return data.text;
  }

  const ocrResult = await Tesseract.recognize(buffer, "eng");
  return ocrResult.data.text;
};
