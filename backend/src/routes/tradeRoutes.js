import express from "express";
import { authenticate } from "../middleware/auth.js";
import {
  listTrades,
  syncAllTrades,
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
  deleteTrade,
  exitPosition,
  exitAllPositions
} from "../controllers/tradeController.js";

const router = express.Router();

// ✅ Enforce JWT authentication on all trade and portfolio endpoints
router.get("/", authenticate, listTrades);
router.post("/sync-all", authenticate, syncAllTrades);
router.post("/exit-position", authenticate, exitPosition);
router.post("/exit-all-positions", authenticate, exitAllPositions);
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
