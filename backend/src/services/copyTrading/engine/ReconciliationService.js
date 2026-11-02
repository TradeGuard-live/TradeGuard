/**
 * ReconciliationService.js
 * 
 * Reconciles ambiguous, timed-out, or UNKNOWN order outcomes against broker order books.
 * Ensures state integrity without blindly re-submitting orders or replaying duplicates.
 */

import CopyOrderMapping from "../../../models/CopyOrderMapping.js";
import { copyTradingAuditService } from "./CopyTradingAuditService.js";
import { OrderStateMachine } from "./OrderStateMachine.js";

export class ReconciliationService {
    /**
     * Attempts to resolve an unknown or ambiguous order outcome against the broker adapter.
     * 
     * @param {Object} params
     * @param {Object} params.mapping - CopyOrderMapping document
     * @param {Object} params.brokerAdapter - Adapter instance for the follower account
     * @returns {Promise<{ resolved: boolean, state: string, details?: any }>}
     */
    async reconcileOrder({ mapping, brokerAdapter }) {
        if (!mapping || !brokerAdapter) {
            throw new Error("mapping and brokerAdapter are required for reconciliation");
        }

        const orderId = mapping.followerOrderId;
        const tag = mapping.idempotencyKey;

        try {
            // 1. If we have a follower order ID, query directly
            let brokerOrder = null;
            if (orderId) {
                try {
                    brokerOrder = await brokerAdapter.getOrder(orderId);
                } catch (e) {
                    // Fallback to order book search
                }
            }

            // 2. Search day orders by tag, order ID, or contract match
            if (!brokerOrder) {
                const dayOrders = await brokerAdapter.getOrders();
                if (Array.isArray(dayOrders)) {
                    brokerOrder = dayOrders.find((o) => {
                        if (orderId && (o.orderId === orderId || o.order_id === orderId)) return true;
                        if (tag && (o.tag === tag || o.clientOrderId === tag)) return true;
                        return false;
                    });
                }
            }

            // 3. Process matched broker order
            if (brokerOrder) {
                const rawStatus = String(brokerOrder.status || "").toUpperCase();
                let canonicalState = "ACKNOWLEDGED";

                if (rawStatus.includes("COMPLETE") || rawStatus.includes("FILLED")) {
                    canonicalState = "FILLED";
                } else if (rawStatus.includes("REJECT")) {
                    canonicalState = "REJECTED";
                } else if (rawStatus.includes("CANCEL")) {
                    canonicalState = "CANCELLED";
                } else if (rawStatus.includes("PARTIAL")) {
                    canonicalState = "PARTIALLY_FILLED";
                }

                if (OrderStateMachine.canTransition(mapping.followerStatus, canonicalState)) {
                    mapping.followerStatus = canonicalState;
                }

                mapping.followerFilledQuantity = Number(brokerOrder.filledQuantity || brokerOrder.filled_quantity || 0);
                mapping.followerAveragePrice = Number(brokerOrder.averagePrice || brokerOrder.average_price || 0);
                mapping.reconciliation.isReconciled = true;
                mapping.reconciliation.reconciledAt = new Date();
                mapping.reconciliation.discrepancy = null;
                await mapping.save();

                await copyTradingAuditService.log({
                    userId: mapping.userId,
                    eventType: "RECOVERY_ACTION",
                    severity: "INFO",
                    message: `Reconciled order ${orderId || tag} to ${canonicalState} from broker state`,
                    masterOrderId: mapping.masterOrderId,
                    followerOrderId: mapping.followerOrderId,
                    followerAccountId: mapping.followerAccountId,
                    details: { brokerOrder }
                });

                return { resolved: true, state: canonicalState, details: brokerOrder };
            }

            // 4. Conclusively not found: order was never placed on broker
            mapping.followerStatus = "FAILED";
            mapping.errorMessage = "Order was not found in broker order book after timeout";
            mapping.reconciliation.isReconciled = true;
            mapping.reconciliation.reconciledAt = new Date();
            mapping.reconciliation.discrepancy = "Order absent from broker";
            await mapping.save();

            await copyTradingAuditService.log({
                userId: mapping.userId,
                eventType: "DISCREPANCY",
                severity: "WARN",
                message: `Reconciliation concluded: Order ${orderId || tag} was never accepted by broker`,
                masterOrderId: mapping.masterOrderId,
                followerAccountId: mapping.followerAccountId
            });

            return { resolved: true, state: "FAILED", details: null };
        } catch (err) {
            console.error(`[ReconciliationService] Error reconciling order ${orderId}:`, err.message);
            return { resolved: false, state: mapping.followerStatus, error: err.message };
        }
    }

    /**
     * Reconciles all pending UNKNOWN orders for a user
     * @param {string} userId
     * @param {Function} adapterResolver - (followerAccountId, followerBroker) => Promise<adapter>
     * @returns {Promise<number>} Number of resolved orders
     */
    async reconcileAllUnknownOrders(userId, adapterResolver) {
        const nonTerminalOrders = await CopyOrderMapping.find({
            userId,
            followerStatus: { $in: ["UNKNOWN", "SUBMITTED", "ACKNOWLEDGED", "PARTIALLY_FILLED"] }
        });

        let resolvedCount = 0;
        for (const mapping of nonTerminalOrders) {
            try {
                const adapter = await adapterResolver(mapping.followerAccountId, mapping.followerBroker);
                if (adapter) {
                    const result = await this.reconcileOrder({ mapping, brokerAdapter: adapter });
                    if (result.resolved) resolvedCount += 1;
                }
            } catch (e) {
                // Continue to next order
            }
        }
        return resolvedCount;
    }
}

export const reconciliationService = new ReconciliationService();
export default reconciliationService;
