import express from "express";
import { authenticate } from "../middleware/auth.js";
import {
    createBrokerAccount,
    getBrokerAccounts,
    getBrokerAccount,
    updateBrokerAccount,
    deleteBrokerAccount,
    syncBrokerTrades,
    verifyBrokerAccount,
} from "../controllers/brokerAccountController.js";

const router = express.Router();

// ✅ Enforce JWT authentication on all broker account endpoints
router.post("/", authenticate, createBrokerAccount);
router.get("/", authenticate, getBrokerAccounts);
router.get("/:id", authenticate, getBrokerAccount);
router.put("/:id", authenticate, updateBrokerAccount);
router.delete("/:id", authenticate, deleteBrokerAccount);
router.post("/:id/sync", authenticate, syncBrokerTrades);
router.post("/:id/verify", authenticate, verifyBrokerAccount);

export default router;