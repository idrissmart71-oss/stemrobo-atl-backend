export const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
  const pdfParseModule: any = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;

  const data = await pdfParse(buffer);
  return data?.text || "";
};
