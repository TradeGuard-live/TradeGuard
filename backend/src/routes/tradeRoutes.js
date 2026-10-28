import express from "express";
import { authenticate } from "../middleware/auth.js";
import {
  listTrades,
  getTradeSummary,
  getAnalytics,
  getReportData,
  getRiskExposures,
  getBrokerComparison,
  calculateTradeCharges,
  getInstrumentDistribution,
  getLiveTradingSummary,
  getChargesAnalytics,
  createTrade,
  deleteTrade
} from "../controllers/tradeController.js";

const router = express.Router();

// ✅ Enforce JWT authentication on all trade and portfolio endpoints
router.get("/", authenticate, listTrades);
router.post("/", authenticate, createTrade);
router.delete("/:id", authenticate, deleteTrade);
router.get("/summary", authenticate, getTradeSummary);
router.get("/live-summary", authenticate, getLiveTradingSummary);
router.get("/charges-analytics", authenticate, getChargesAnalytics);
router.get("/analytics", authenticate, getAnalytics);
router.get("/reports", authenticate, getReportData);
router.get("/risk/exposures", authenticate, getRiskExposures);
router.get("/brokers/comparison", authenticate, getBrokerComparison);
router.post("/calculations/charges", calculateTradeCharges);
router.get("/instrument-distribution", authenticate, getInstrumentDistribution);

export default router;
