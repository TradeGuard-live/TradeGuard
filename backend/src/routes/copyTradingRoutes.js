import express from "express";
import { authenticate } from "../middleware/auth.js";
import {
    getConfig,
    updateConfig,
    addFollower,
    updateFollower,
    deleteFollower,
    triggerEmergencyStop,
    resetEmergencyStop,
    getOrders,
    getMetrics,
    getAuditLogs,
    triggerReconciliation,
    syncMasterTrades,
    simulateMasterOrder
} from "../controllers/copyTradingController.js";

const router = express.Router();

// All Copy-Trading endpoints require authentication
router.use(authenticate);

router.get("/config", getConfig);
router.put("/config", updateConfig);

router.post("/followers", addFollower);
router.put("/followers/:followerId", updateFollower);
router.delete("/followers/:followerId", deleteFollower);

router.post("/emergency-stop", triggerEmergencyStop);
router.post("/emergency-stop/reset", resetEmergencyStop);

router.get("/orders", getOrders);
router.get("/metrics", getMetrics);
router.get("/audit-logs", getAuditLogs);
router.post("/reconcile", triggerReconciliation);
router.post("/sync-master-trades", syncMasterTrades);

// Local simulation endpoint
router.post("/simulate-master-order", simulateMasterOrder);

export default router;
