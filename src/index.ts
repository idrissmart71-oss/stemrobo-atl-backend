import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import reportRoutes from "./routes/reportRoutes.js";

dotenv.config();

const app = express();

// CORS configuration
app.use(cors({ 
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

// Body parser
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ 
    status: "OK",
    timestamp: new Date().toISOString(),
    env: {
      hasApiKey: !!process.env.API_KEY,
      hasGoogleCreds: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    }
  });
});

// Routes
app.use("/generate-report", reportRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("🔥 Error:", err);
  res.status(500).json({ 
    error: err.message || "Internal server error" 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`📍 API URL: http://localhost:${PORT}`);
  console.log(`🔑 API Key configured: ${!!process.env.API_KEY}`);
  console.log(`🔐 Google Credentials configured: ${!!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON}`);
});