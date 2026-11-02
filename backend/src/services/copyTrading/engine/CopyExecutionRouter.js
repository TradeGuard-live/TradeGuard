/**
 * CopyExecutionRouter.js
 * 
 * High-performance orchestrator for copy trading execution.
 * Dispatches master order operations in parallel to all eligible follower accounts
 * with sub-millisecond local processing, strict idempotency, fail-closed risk checks,
 * and comprehensive latency tracking.
 */

import CopyConfig from "../../../models/CopyConfig.js";
import CopyOrderMapping from "../../../models/CopyOrderMapping.js";
import { idempotencyService } from "./IdempotencyService.js";
import { riskValidationService } from "./RiskValidationService.js";
import { copyPolicyEngine } from "./CopyPolicyEngine.js";
import { instrumentMappingService } from "./InstrumentMappingService.js";
import { copyTradingMetrics, CopyTradingMetrics } from "./CopyTradingMetrics.js";
import { copyTradingAuditService } from "./CopyTradingAuditService.js";
import { OrderStateMachine } from "./OrderStateMachine.js";
import CanonicalOrderEvent from "../models/CanonicalOrderEvent.js";

export class CopyExecutionRouter {
    constructor() {
        this.adapterResolver = null; // (accountId, broker) => Promise<IBrokerAdapter>
        this.eventListeners = new Set();
    }

    /**
     * Registers a broker adapter resolver function
     * @param {Function} resolver - (accountId, broker) => Promise<IBrokerAdapter>
     */
    setAdapterResolver(resolver) {
        this.adapterResolver = resolver;
    }

    /**
     * Subscribe to real-time copy execution lifecycle updates
     * @param {Function} listener
     */
    onUpdate(listener) {
        this.eventListeners.add(listener);
    }

    offUpdate(listener) {
        this.eventListeners.delete(listener);
    }

    _emitUpdate(type, data) {
        for (const listener of this.eventListeners) {
            try {
                listener(type, data);
            } catch (e) {
                // Ignore listener errors
            }
        }
    }

    /**
     * Ingests a master order event and routes it to all configured followers
     * 
     * @param {Object} params
     * @param {string} params.userId
     * @param {CanonicalOrderEvent|Object} params.masterEvent
     * @returns {Promise<{ processed: boolean, results: Array }>}
     */
    async handleMasterEvent({ userId, masterEvent }) {
        const startNs = copyTradingMetrics.startTimer();
        const receivedAt = Date.now();

        // 1. Normalize to CanonicalOrderEvent
        const canonical = masterEvent instanceof CanonicalOrderEvent
            ? masterEvent
            : new CanonicalOrderEvent(masterEvent);

        // 2. Load User Copy Configuration
        const copyConfig = await CopyConfig.findOne({ userId });
        if (!copyConfig || !copyConfig.isEnabled) {
            return { processed: false, reason: "Copy trading is not enabled for this user" };
        }

        // Global Emergency Stop & Pause Check
        if (copyConfig.emergencyStop || copyConfig.isPaused) {
            await copyTradingAuditService.log({
                userId,
                eventType: copyConfig.emergencyStop ? "EMERGENCY_STOP" : "PAUSE",
                severity: "WARN",
                message: `Dropped master event: ${copyConfig.emergencyStop ? "Emergency Stop active" : "Globally paused"}`,
                masterOrderId: canonical.orderId
            });
            return { 
                processed: false, 
                reason: copyConfig.emergencyStop ? "Emergency Stop active" : "Engine is paused" 
            };
        }

        // 3. Route according to event status / operation
        if (canonical.status === "CANCELLED") {
            return this.handleMasterCancellation({ userId, copyConfig, canonical, startNs, receivedAt });
        }

        if (canonical.version > 1 && canonical.isOpen()) {
            return this.handleMasterModification({ userId, copyConfig, canonical, startNs, receivedAt });
        }

        // New Order Submission Flow
        return this.handleMasterNewOrder({ userId, copyConfig, canonical, startNs, receivedAt });
    }

    /**
     * Handles NEW ORDER replication across all followers
     */
    async handleMasterNewOrder({ userId, copyConfig, canonical, startNs, receivedAt }) {
        const followers = (copyConfig.followers || []).filter((f) => f.isEnabled && !f.isPaused);
        if (followers.length === 0) {
            return { processed: false, reason: "No active follower accounts configured" };
        }

        const lotSize = instrumentMappingService.getLotSize(canonical.symbol, canonical.segment);

        // Process all followers in parallel without letting one slow broker block others
        const operations = followers.map(async (follower) => {
            const followerStartNs = copyTradingMetrics.startTimer();

            // Calculate follower quantity
            const targetQty = copyPolicyEngine.calculateQuantity({
                masterQuantity: canonical.quantity,
                follower,
                lotSize
            });

            // Pre-trade risk validation
            const riskCheck = riskValidationService.validateOperation({
                copyConfig,
                follower,
                canonicalEvent: canonical,
                operation: "PLACE",
                targetQuantity: targetQty,
                price: canonical.price
            });

            if (!riskCheck.allowed) {
                await copyTradingAuditService.log({
                    userId,
                    eventType: "RISK_REJECT",
                    severity: "WARN",
                    message: `Risk check rejected for ${follower.followerName}: ${riskCheck.reason}`,
                    masterOrderId: canonical.orderId,
                    followerAccountId: String(follower.followerAccountId),
                    details: { targetQty, riskCheck }
                });
                return {
                    followerAccountId: follower.followerAccountId,
                    success: false,
                    reason: riskCheck.reason
                };
            }

            // Generate deterministic idempotency key
            const idempotencyKey = idempotencyService.generateKey({
                masterAccountId: canonical.accountId,
                masterOrderId: canonical.orderId,
                eventVersion: canonical.version,
                followerAccountId: String(follower.followerAccountId),
                operation: "PLACE"
            });

            if (idempotencyService.isDuplicate(idempotencyKey)) {
                return {
                    followerAccountId: follower.followerAccountId,
                    success: false,
                    reason: "Duplicate event detected (idempotent no-op)"
                };
            }
            idempotencyService.markProcessed(idempotencyKey);

            // Normalize product and exchange for target broker
            const { exchange } = instrumentMappingService.normalizeExchange(
                canonical.exchange,
                canonical.segment,
                follower.followerBroker
            );
            const productCode = instrumentMappingService.mapProductCode(
                canonical.productCode,
                follower.followerBroker
            );

            // Create initial pending order mapping in DB
            let mapping = null;
            try {
                mapping = await CopyOrderMapping.create({
                    userId,
                    copyConfigId: copyConfig._id,
                    idempotencyKey,
                    masterAccountId: canonical.accountId,
                    masterBroker: canonical.broker,
                    masterOrderId: canonical.orderId,
                    masterOrderStatus: canonical.status,
                    sourceEventId: canonical.getFingerprint(),
                    eventVersion: canonical.version,
                    symbol: canonical.symbol,
                    exchange,
                    segment: canonical.segment,
                    transactionType: canonical.transactionType,
                    orderType: canonical.orderType,
                    productCode,
                    masterPrice: canonical.price,
                    masterTriggerPrice: canonical.triggerPrice,
                    masterQuantity: canonical.quantity,
                    masterFilledQuantity: canonical.filledQuantity,
                    followerAccountId: String(follower.followerAccountId),
                    followerBroker: follower.followerBroker,
                    requestedOperation: "PLACE",
                    followerStatus: "SUBMITTED",
                    followerQuantity: targetQty,
                    followerFilledQuantity: 0,
                    followerRemainingQuantity: targetQty,
                    timing: {
                        masterEventReceivedAt: new Date(receivedAt),
                        riskValidatedAt: new Date(),
                        submittedAt: new Date()
                    }
                });
            } catch (dbErr) {
                if (dbErr.code === 11000) {
                    // Unique index collision: duplicate submission prevented
                    return { followerAccountId: follower.followerAccountId, success: false, reason: "Duplicate submission" };
                }
                throw dbErr;
            }

            // Resolve adapter and submit to broker
            const adapter = this.adapterResolver 
                ? await this.adapterResolver(follower.followerAccountId, follower.followerBroker) 
                : null;

            if (!adapter) {
                mapping.followerStatus = "FAILED";
                mapping.errorMessage = `No adapter available for broker ${follower.followerBroker}`;
                await mapping.save();
                return { followerAccountId: follower.followerAccountId, success: false, reason: mapping.errorMessage };
            }

            const submitNs = copyTradingMetrics.startTimer();
            const latencyMs = CopyTradingMetrics.nsToMs(startNs, submitNs);
            mapping.timing.latencyMs = latencyMs;
            copyTradingMetrics.recordSample("receipt_to_submit", latencyMs);

            try {
                const response = await adapter.placeOrder({
                    symbol: canonical.symbol,
                    exchange,
                    segment: canonical.segment,
                    transactionType: canonical.transactionType,
                    orderType: canonical.orderType,
                    productCode,
                    quantity: targetQty,
                    price: canonical.price,
                    triggerPrice: canonical.triggerPrice,
                    tag: idempotencyKey
                });

                const ackNs = copyTradingMetrics.startTimer();
                const totalAckLatencyMs = CopyTradingMetrics.nsToMs(startNs, ackNs);
                const submitToAckMs = CopyTradingMetrics.nsToMs(submitNs, ackNs);
                copyTradingMetrics.recordSample("submit_to_ack", submitToAckMs);

                mapping.followerOrderId = response.orderId || null;
                mapping.followerStatus = response.status || (response.success ? "ACKNOWLEDGED" : "REJECTED");
                mapping.timing.acknowledgedAt = new Date();
                mapping.timing.totalAckLatencyMs = totalAckLatencyMs;
                if (!response.success) {
                    mapping.rejectionReason = response.message || "Broker rejected order";
                }
                await mapping.save();

                await copyTradingAuditService.log({
                    userId,
                    eventType: response.success ? "SUBMISSION_SUCCESS" : "SUBMISSION_FAIL",
                    severity: response.success ? "INFO" : "ERROR",
                    message: `Order submitted to ${follower.followerName}: ${mapping.followerStatus}`,
                    masterOrderId: canonical.orderId,
                    followerOrderId: mapping.followerOrderId,
                    followerAccountId: String(follower.followerAccountId),
                    latencyMs: totalAckLatencyMs,
                    details: { response, targetQty }
                });

                this._emitUpdate("ORDER_SYNC", mapping);
                return { followerAccountId: follower.followerAccountId, success: response.success, mapping };
            } catch (subErr) {
                const isUnknown = subErr.isUnknownOutcome || subErr.code === "ECONNABORTED" || subErr.code === "ETIMEDOUT";
                mapping.followerStatus = isUnknown ? "UNKNOWN" : "FAILED";
                mapping.errorMessage = subErr.message;
                await mapping.save();

                if (follower.pauseOnFailure) {
                    follower.isPaused = true;
                    await copyConfig.save();
                }

                await copyTradingAuditService.log({
                    userId,
                    eventType: isUnknown ? "DISCREPANCY" : "SUBMISSION_FAIL",
                    severity: "ERROR",
                    message: `Order dispatch error for ${follower.followerName}: ${subErr.message}`,
                    masterOrderId: canonical.orderId,
                    followerAccountId: String(follower.followerAccountId),
                    details: { error: subErr.message, isUnknown }
                });

                this._emitUpdate("ORDER_SYNC", mapping);
                return { followerAccountId: follower.followerAccountId, success: false, error: subErr.message, isUnknown };
            }
        });

        const settled = await Promise.allSettled(operations);
        const results = settled.map((s) => (s.status === "fulfilled" ? s.value : { success: false, error: s.reason?.message }));
        return { processed: true, results };
    }

    /**
     * Handles ORDER MODIFICATION replication across associated follower orders
     */
    async handleMasterModification({ userId, copyConfig, canonical, startNs }) {
        const mappings = await CopyOrderMapping.find({
            userId,
            masterOrderId: canonical.orderId,
            followerStatus: { $in: ["ACKNOWLEDGED", "PARTIALLY_FILLED"] }
        });

        if (mappings.length === 0) {
            return { processed: false, reason: "No active follower orders found to modify" };
        }

        const lotSize = instrumentMappingService.getLotSize(canonical.symbol, canonical.segment);

        const operations = mappings.map(async (mapping) => {
            const follower = copyConfig.followers.find((f) => String(f.followerAccountId) === String(mapping.followerAccountId));
            if (!follower || !follower.isEnabled || follower.isPaused || follower.copyModifications === false) {
                return { followerAccountId: mapping.followerAccountId, success: false, reason: "Modification not allowed" };
            }

            const modCalc = copyPolicyEngine.calculateModification({
                newMasterTotalQuantity: canonical.quantity,
                follower,
                followerFilledQuantity: mapping.followerFilledQuantity,
                lotSize
            });

            if (!modCalc.isValid) {
                await copyTradingAuditService.log({
                    userId,
                    eventType: "DISCREPANCY",
                    severity: "WARN",
                    message: `Cannot modify follower order ${mapping.followerOrderId}: ${modCalc.reason}`,
                    masterOrderId: canonical.orderId,
                    followerOrderId: mapping.followerOrderId
                });
                return { followerAccountId: mapping.followerAccountId, success: false, reason: modCalc.reason };
            }

            const adapter = this.adapterResolver
                ? await this.adapterResolver(follower.followerAccountId, follower.followerBroker)
                : null;

            if (!adapter) {
                return { followerAccountId: mapping.followerAccountId, success: false, reason: "No adapter found" };
            }

            try {
                const response = await adapter.modifyOrder({
                    orderId: mapping.followerOrderId,
                    quantity: modCalc.newFollowerTotalQuantity,
                    price: canonical.price,
                    triggerPrice: canonical.triggerPrice,
                    orderType: canonical.orderType
                });

                mapping.followerQuantity = modCalc.newFollowerTotalQuantity;
                mapping.followerRemainingQuantity = modCalc.newRemainingQuantity;
                mapping.eventVersion = canonical.version;
                await mapping.save();

                await copyTradingAuditService.log({
                    userId,
                    eventType: "MODIFICATION",
                    severity: "INFO",
                    message: `Modified follower order ${mapping.followerOrderId} to qty ${modCalc.newFollowerTotalQuantity}`,
                    masterOrderId: canonical.orderId,
                    followerOrderId: mapping.followerOrderId
                });

                this._emitUpdate("ORDER_SYNC", mapping);
                return { followerAccountId: mapping.followerAccountId, success: true, mapping };
            } catch (err) {
                await copyTradingAuditService.log({
                    userId,
                    eventType: "DISCREPANCY",
                    severity: "ERROR",
                    message: `Failed to modify follower order ${mapping.followerOrderId}: ${err.message}`,
                    masterOrderId: canonical.orderId,
                    followerOrderId: mapping.followerOrderId
                });
                return { followerAccountId: mapping.followerAccountId, success: false, error: err.message };
            }
        });

        const settled = await Promise.allSettled(operations);
        const results = settled.map((s) => (s.status === "fulfilled" ? s.value : { success: false, error: s.reason?.message }));
        return { processed: true, results };
    }

    /**
     * Handles ORDER CANCELLATION replication across associated follower orders
     */
    async handleMasterCancellation({ userId, copyConfig, canonical }) {
        const mappings = await CopyOrderMapping.find({
            userId,
            masterOrderId: canonical.orderId,
            followerStatus: { $in: ["ACKNOWLEDGED", "PARTIALLY_FILLED", "SUBMITTED"] }
        });

        if (mappings.length === 0) {
            return { processed: false, reason: "No cancellable follower orders found" };
        }

        const operations = mappings.map(async (mapping) => {
            const follower = copyConfig.followers.find((f) => String(f.followerAccountId) === String(mapping.followerAccountId));
            if (!follower || follower.copyCancellations === false) {
                return { followerAccountId: mapping.followerAccountId, success: false, reason: "Cancellation copying disabled" };
            }

            const adapter = this.adapterResolver
                ? await this.adapterResolver(follower.followerAccountId, follower.followerBroker)
                : null;

            if (!adapter) {
                return { followerAccountId: mapping.followerAccountId, success: false, reason: "No adapter found" };
            }

            try {
                const response = await adapter.cancelOrder({
                    orderId: mapping.followerOrderId
                });

                mapping.followerStatus = "CANCELLED";
                mapping.followerRemainingQuantity = 0;
                mapping.timing.finalStateAt = new Date();
                await mapping.save();

                await copyTradingAuditService.log({
                    userId,
                    eventType: "CANCELLATION",
                    severity: "INFO",
                    message: `Cancelled follower order ${mapping.followerOrderId}`,
                    masterOrderId: canonical.orderId,
                    followerOrderId: mapping.followerOrderId
                });

                this._emitUpdate("ORDER_SYNC", mapping);
                return { followerAccountId: mapping.followerAccountId, success: true, mapping };
            } catch (err) {
                const isAlreadyFilled = err.code === "ORDER_ALREADY_FILLED";
                if (isAlreadyFilled) {
                    mapping.followerStatus = "FILLED";
                    mapping.followerRemainingQuantity = 0;
                    await mapping.save();
                }

                await copyTradingAuditService.log({
                    userId,
                    eventType: "DISCREPANCY",
                    severity: isAlreadyFilled ? "WARN" : "ERROR",
                    message: `Cancellation error for follower order ${mapping.followerOrderId}: ${err.message}`,
                    masterOrderId: canonical.orderId,
                    followerOrderId: mapping.followerOrderId,
                    details: { isAlreadyFilled }
                });

                this._emitUpdate("ORDER_SYNC", mapping);
                return { followerAccountId: mapping.followerAccountId, success: false, error: err.message };
            }
        });

        const settled = await Promise.allSettled(operations);
        const results = settled.map((s) => (s.status === "fulfilled" ? s.value : { success: false, error: s.reason?.message }));
        return { processed: true, results };
    }
}

export const copyExecutionRouter = new CopyExecutionRouter();
export default copyExecutionRouter;
