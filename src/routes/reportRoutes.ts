import express from "express";
import { generateReport } from "../controllers/reportController";

const router = express.Router();

router.post("/", generateReport);

export default router;
