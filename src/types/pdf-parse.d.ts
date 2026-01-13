declare module "pdf-parse" {
    const pdfParse: (buffer: Buffer) => Promise<{
      text: string;
      numpages: number;
      info: any;
      metadata: any;
    }>;
    export default pdfParse;
  }
  