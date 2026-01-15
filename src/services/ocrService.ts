import { ImageAnnotatorClient } from "@google-cloud/vision";

/* ================= GOOGLE VISION CLIENT ================= */

let credentials: any = null;
let credentialsSource = 'none';

// Try multiple methods to load credentials
try {
  // Method 1: Try base64 first (most reliable)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    const base64Creds = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    const decoded = Buffer.from(base64Creds, 'base64').toString('utf8');
    credentials = JSON.parse(decoded);
    credentialsSource = 'base64';
    console.log('✅ Credentials loaded from BASE64');
  }
  // Method 2: Try JSON string
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    credentialsSource = 'json';
    console.log('✅ Credentials loaded from JSON');
  }
  // Method 3: Try secret file (Render Secret Files)
  else {
    try {
      const fs = await import('fs');
      const credPath = '/etc/secrets/google-credentials.json';
      const fileContent = fs.readFileSync(credPath, 'utf8');
      credentials = JSON.parse(fileContent);
      credentialsSource = 'file';
      console.log('✅ Credentials loaded from SECRET FILE');
    } catch (fileErr) {
      console.log('⚠️ No secret file found');
    }
  }

  // Validate credentials have required fields
  if (credentials) {
    const required = ['type', 'project_id', 'private_key', 'client_email'];
    const missing = required.filter(field => !credentials[field]);
    
    if (missing.length > 0) {
      console.error('❌ Credentials missing fields:', missing);
      console.error('Available fields:', Object.keys(credentials));
      credentials = null;
    } else {
      console.log('✅ Credentials validated');
      console.log('   Project:', credentials.project_id);
      console.log('   Email:', credentials.client_email);
      console.log('   Source:', credentialsSource);
    }
  } else {
    console.error('❌ No credentials found in any source');
  }
} catch (err) {
  console.error('🔥 Failed to load credentials:', err);
  credentials = null;
}

const visionClient = credentials 
  ? new ImageAnnotatorClient({ credentials })
  : null;

if (!visionClient) {
  console.error('🔥 WARNING: Vision client not initialized - OCR will not work!');
}

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
    console.log("⚠️ Digital PDF extraction failed, falling back to OCR");
  }

  // 2️⃣ Vision OCR fallback (SCANNED PDF / IMAGE)
  if (!visionClient) {
    throw new Error(
      'OCR service not available. Google Vision credentials are not configured correctly. ' +
      'Please check your GOOGLE_APPLICATION_CREDENTIALS_BASE64 or GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable.'
    );
  }

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
    throw new Error(
      "Could not extract text from document. This could be due to: " +
      "1) Poor image/PDF quality, " +
      "2) Missing Google Vision credentials, or " +
      "3) Invalid credentials format. " +
      "Error: " + ocrError.message
    );
  }
};