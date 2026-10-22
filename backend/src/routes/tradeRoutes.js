import express from "express";
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
  createTrade
} from "../controllers/tradeController.js";
const router = express.Router();
router.get("/", listTrades);
router.post("/", createTrade);
router.get("/summary", getTradeSummary);
router.get("/live-summary", getLiveTradingSummary);
router.get("/charges-analytics", getChargesAnalytics);
router.get("/analytics", getAnalytics);
router.get("/reports", getReportData);
router.get("/risk/exposures", getRiskExposures);
router.get("/brokers/comparison", getBrokerComparison);
router.post("/calculations/charges", calculateTradeCharges);
router.get("/instrument-distribution", getInstrumentDistribution);
export default router;
