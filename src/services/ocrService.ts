import Tesseract from "tesseract.js";

/**
 * OCR ONLY for images (jpg/png)
 * PDFs are NOT parsed here
 */
export const extractTextFromImage = async (
  buffer: Buffer
): Promise<string> => {
  const result = await Tesseract.recognize(buffer, "eng");
  return result.data.text || "";
};
