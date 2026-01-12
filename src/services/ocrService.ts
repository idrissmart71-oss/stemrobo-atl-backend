import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import Tesseract from "tesseract.js";

// Required for Node.js
GlobalWorkerOptions.workerSrc =
  "node_modules/pdfjs-dist/build/pdf.worker.js";

/**
 * Extract text from PDF using pdfjs (stable for Node 22)
 */
export const extractTextFromPDF = async (
  buffer: Buffer
): Promise<string> => {
  const loadingTask = getDocument({ data: buffer });
  const pdf = await loadingTask.promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const strings = content.items
      .map((item: any) => item.str)
      .join(" ");

    fullText += strings + "\n";
  }

  console.log("📄 PDFJS TEXT LENGTH:", fullText.length);
  console.log("📄 PDFJS SAMPLE:", fullText.slice(0, 500));

  if (fullText.trim().length > 100) {
    return fullText;
  }

  // Fallback OCR for scanned PDFs
  console.log("⚠️ Falling back to OCR");

  const ocrResult = await Tesseract.recognize(buffer, "eng");

  console.log("🧠 OCR TEXT LENGTH:", ocrResult.data.text.length);
  console.log("🧠 OCR SAMPLE:", ocrResult.data.text.slice(0, 500));

  return ocrResult.data.text || "";
};
