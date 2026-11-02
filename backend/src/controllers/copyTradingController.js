/**
 * copyTradingController.js
 * 
 * REST API controller for TradeGuard Copy-Trading Module.
 * Provides endpoints for configuration, follower management, emergency stop,
 * order synchronization history, high-precision latency metrics, and simulation.
 */

import CopyConfig from "../models/CopyConfig.js";
import CopyOrderMapping from "../models/CopyOrderMapping.js";
import CopyAuditLog from "../models/CopyAuditLog.js";
import { copyExecutionRouter } from "../services/copyTrading/engine/CopyExecutionRouter.js";
import { copyTradingMetrics } from "../services/copyTrading/engine/CopyTradingMetrics.js";
import { copyTradingAuditService } from "../services/copyTrading/engine/CopyTradingAuditService.js";
import { reconciliationService } from "../services/copyTrading/engine/ReconciliationService.js";
import { masterOrderEventStream } from "../services/copyTrading/engine/MasterOrderEventStream.js";
import { BrokerAdapterFactory } from "../services/copyTrading/adapters/BrokerAdapterFactory.js";
import CanonicalOrderEvent from "../services/copyTrading/models/CanonicalOrderEvent.js";

// Ensure adapter resolver is registered
copyExecutionRouter.setAdapterResolver(BrokerAdapterFactory.getAdapter);

function getUserId(req) {
    return req.user?.userId || req.user?.id || req.user?._id;
}

/**
 * GET /api/copy-trading/config
 * Retrieves or initializes user's CopyConfig
 */
export async function getConfig(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        let config = await CopyConfig.findOne({ userId });
        if (!config) {
            config = await CopyConfig.create({
                userId,
                isEnabled: false,
                masterBroker: "MOCK",
                masterAccountId: "MOCK_MASTER",
                followers: [
                    {
                        followerAccountId: "MOCK_FOLLOWER_01",
                        followerBroker: "MOCK",
                        followerName: "Simulation Follower 1 (Mock)",
                        isEnabled: true,
                        isPaused: false,
                        multiplier: 1.0,
                        maxOrderQuantity: 1800,
                        maxOrderNotional: 500000
                    }
                ]
            });
        }

        const streamStatus = masterOrderEventStream.getStreamStatus(userId);

        return res.json({
            success: true,
            data: {
                config,
                streamStatus
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * PUT /api/copy-trading/config
 * Updates global copy-trading settings, master account, and risk limits
 */
export async function updateConfig(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { isEnabled, isPaused, masterAccountId, masterBroker, riskLimits } = req.body;

        let config = await CopyConfig.findOne({ userId });
        if (!config) {
            config = new CopyConfig({ userId });
        }

        if (typeof isEnabled === "boolean") config.isEnabled = isEnabled;
        if (typeof isPaused === "boolean") config.isPaused = isPaused;
        if (masterAccountId !== undefined) config.masterAccountId = masterAccountId;
        if (masterBroker !== undefined) config.masterBroker = masterBroker;
        if (riskLimits && typeof riskLimits === "object") {
            config.riskLimits = { ...config.riskLimits, ...riskLimits };
        }

        await config.save();

        // If enabled and master account is configured, ensure event stream is initialized
        if (config.isEnabled && config.masterAccountId) {
            try {
                const adapter = await BrokerAdapterFactory.getAdapter(config.masterAccountId, config.masterBroker);
                await masterOrderEventStream.startStream({ userId, masterAdapter: adapter });
            } catch (e) {
                console.warn("[CopyTradingController] Master stream start warning:", e.message);
            }
        } else {
            masterOrderEventStream.stopStream(userId);
        }

        await copyTradingAuditService.log({
            userId,
            eventType: "CONFIG_CHANGE",
            severity: "INFO",
            message: "Updated Copy Trading configuration",
            details: { isEnabled: config.isEnabled, isPaused: config.isPaused, masterBroker: config.masterBroker }
        });

        return res.json({ success: true, data: config });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * POST /api/copy-trading/followers
 * Adds a new follower account configuration
 */
export async function addFollower(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const followerData = req.body;
        if (!followerData.followerAccountId || !followerData.followerBroker) {
            return res.status(400).json({ success: false, message: "followerAccountId and followerBroker are required" });
        }

        let config = await CopyConfig.findOne({ userId });
        if (!config) {
            config = new CopyConfig({ userId, followers: [] });
        }

        config.followers.push(followerData);
        await config.save();

        await copyTradingAuditService.log({
            userId,
            eventType: "CONFIG_CHANGE",
            severity: "INFO",
            message: `Added follower ${followerData.followerName || followerData.followerAccountId}`,
            followerAccountId: String(followerData.followerAccountId)
        });

        return res.json({ success: true, data: config });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * PUT /api/copy-trading/followers/:followerId
 * Updates an existing follower account configuration
 */
export async function updateFollower(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { followerId } = req.params;
        const updates = req.body;

        const config = await CopyConfig.findOne({ userId });
        if (!config) return res.status(404).json({ success: false, message: "Configuration not found" });

        const follower = config.followers.id(followerId);
        if (!follower) return res.status(404).json({ success: false, message: "Follower not found" });

        Object.assign(follower, updates);
        await config.save();

        await copyTradingAuditService.log({
            userId,
            eventType: "CONFIG_CHANGE",
            severity: "INFO",
            message: `Updated follower ${follower.followerName || followerId}`,
            followerAccountId: String(follower.followerAccountId)
        });

        return res.json({ success: true, data: config });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * DELETE /api/copy-trading/followers/:followerId
 * Removes a follower configuration
 */
export async function deleteFollower(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { followerId } = req.params;
        const config = await CopyConfig.findOne({ userId });
        if (!config) return res.status(404).json({ success: false, message: "Configuration not found" });

        config.followers.pull({ _id: followerId });
        await config.save();

        await copyTradingAuditService.log({
            userId,
            eventType: "CONFIG_CHANGE",
            severity: "INFO",
            message: `Removed follower ${followerId}`
        });

        return res.json({ success: true, data: config });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * POST /api/copy-trading/emergency-stop
 * Triggers Global Emergency Stop (Kill Switch)
 */
export async function triggerEmergencyStop(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { reason = "Manual emergency stop triggered from dashboard" } = req.body;

        const config = await CopyConfig.findOne({ userId });
        if (config) {
            config.emergencyStop = true;
            config.emergencyStopReason = reason;
            config.emergencyStopTriggeredAt = new Date();
            config.isPaused = true;
            await config.save();
        }

        // Stop master event streaming immediately
        masterOrderEventStream.stopStream(userId);

        await copyTradingAuditService.log({
            userId,
            eventType: "EMERGENCY_STOP",
            severity: "CRITICAL",
            message: `EMERGENCY STOP TRIGGERED: ${reason}`
        });

        return res.json({
            success: true,
            message: "Emergency stop activated. All copy trading operations halted immediately.",
            data: config
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * POST /api/copy-trading/emergency-stop/reset
 * Resets Emergency Stop after manual review
 */
export async function resetEmergencyStop(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const config = await CopyConfig.findOne({ userId });
        if (config) {
            config.emergencyStop = false;
            config.emergencyStopReason = null;
            config.emergencyStopTriggeredAt = null;
            await config.save();
        }

        await copyTradingAuditService.log({
            userId,
            eventType: "CONFIG_CHANGE",
            severity: "INFO",
            message: "Emergency Stop reset by operator"
        });

        return res.json({ success: true, message: "Emergency stop reset successfully", data: config });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /api/copy-trading/orders
 * Returns paginated copy order synchronization records
 */
export async function getOrders(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { page = 1, limit = 50, status, symbol } = req.query;
        const query = { userId };
        if (status) query.followerStatus = status;
        if (symbol) query.symbol = String(symbol).toUpperCase();

        const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
        const [orders, total] = await Promise.all([
            CopyOrderMapping.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
            CopyOrderMapping.countDocuments(query)
        ]);

        return res.json({
            success: true,
            data: {
                orders,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /api/copy-trading/metrics
 * Returns real empirical latency measurements and execution statistics
 */
export async function getMetrics(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const metrics = copyTradingMetrics.getAllMetrics();

        // Query today's operational counts
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const [totalCopied, totalPending, totalRejected, totalFilled] = await Promise.all([
            CopyOrderMapping.countDocuments({ userId, createdAt: { $gte: startOfDay } }),
            CopyOrderMapping.countDocuments({ userId, followerStatus: { $in: ["PENDING", "SUBMITTED", "UNKNOWN"] } }),
            CopyOrderMapping.countDocuments({ userId, followerStatus: "REJECTED", createdAt: { $gte: startOfDay } }),
            CopyOrderMapping.countDocuments({ userId, followerStatus: "FILLED", createdAt: { $gte: startOfDay } })
        ]);

        return res.json({
            success: true,
            data: {
                latency: metrics,
                counts: {
                    totalCopiedToday: totalCopied,
                    pendingAcks: totalPending,
                    rejectedToday: totalRejected,
                    filledToday: totalFilled
                }
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /api/copy-trading/audit-logs
 * Returns paginated audit logs
 */
export async function getAuditLogs(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { page = 1, limit = 50, eventType, severity } = req.query;
        const query = { userId };
        if (eventType) query.eventType = eventType;
        if (severity) query.severity = severity;

        const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
        const [logs, total] = await Promise.all([
            CopyAuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
            CopyAuditLog.countDocuments(query)
        ]);

        return res.json({
            success: true,
            data: {
                logs,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * POST /api/copy-trading/reconcile
 * Triggers reconciliation of UNKNOWN or open orders and catches up uncopied master trades
 */
export async function triggerReconciliation(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        // Catch up any master trades executed on the broker that were not yet copied
        let catchUpResult = { copiedCount: 0 };
        try {
            catchUpResult = await masterOrderEventStream.catchUpTodayTrades(userId);
        } catch (catchErr) {
            console.warn("[CopyTradingController] catchUpTodayTrades warning:", catchErr.message);
        }

        const resolvedCount = await reconciliationService.reconcileAllUnknownOrders(
            userId,
            BrokerAdapterFactory.getAdapter
        );

        return res.json({
            success: true,
            message: `Reconciliation completed: ${resolvedCount} ambiguous orders resolved, ${catchUpResult.copiedCount || 0} master trades synchronized`,
            data: {
                resolvedCount,
                catchUpResult
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * POST /api/copy-trading/sync-master-trades
 * Immediately synchronizes and replicates any uncopied trades executed today on master account
 */
export async function syncMasterTrades(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        // Ensure stream is active if configured
        const config = await CopyConfig.findOne({ userId });
        if (config && config.isEnabled && config.masterAccountId && config.masterBroker) {
            try {
                const adapter = await BrokerAdapterFactory.getAdapter(config.masterAccountId, config.masterBroker);
                await masterOrderEventStream.startStream({ userId, masterAdapter: adapter });
            } catch (e) {
                console.warn("[CopyTradingController] Master stream start on sync-master-trades:", e.message);
            }
        }

        const catchUpResult = await masterOrderEventStream.catchUpTodayTrades(userId);

        return res.json({
            success: true,
            message: `Master trade synchronization completed: ${catchUpResult.copiedCount || 0} trades copied`,
            data: catchUpResult
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * POST /api/copy-trading/simulate-master-order
 * Injects a simulated master order event for testing without real money
 */
export async function simulateMasterOrder(req, res) {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const {
            symbol = "RELIANCE",
            exchange = "NSE",
            segment = "EQUITY",
            transactionType = "BUY",
            orderType = "MARKET",
            quantity = 10,
            price = 2450.0,
            operation = "PLACE",
            masterOrderId = `SIM-ORD-${Date.now()}`
        } = req.body;

        const canonical = new CanonicalOrderEvent({
            broker: "MOCK",
            accountId: "MOCK_MASTER",
            orderId: masterOrderId,
            symbol,
            exchange,
            segment,
            transactionType,
            orderType,
            quantity: Number(quantity),
            price: Number(price),
            status: operation === "CANCEL" ? "CANCELLED" : "ACKNOWLEDGED",
            version: operation === "MODIFY" ? 2 : 1
        });

        const result = await copyExecutionRouter.handleMasterEvent({
            userId,
            masterEvent: canonical
        });

        return res.json({
            success: true,
            message: "Simulated master order event processed",
            data: result
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}
