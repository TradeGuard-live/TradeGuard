/**
 * RiskValidationService.js
 * 
 * Enforces rigorous pre-trade risk controls and safety gates before any follower
 * order is dispatched. Any failure causes the submission to fail-closed.
 */

import { getBrokerCapabilities } from "../contracts/BrokerCapabilityRegistry.js";

export class RiskValidationService {
    constructor() {
        this.rateLimitWindows = new Map(); // followerAccountId -> Array<timestamps>
    }

    /**
     * Validates whether an intended follower operation complies with all safety & risk limits.
     * 
     * @param {Object} params
     * @param {Object} params.copyConfig - User's CopyConfig document
     * @param {Object} params.follower - Follower configuration object
     * @param {Object} params.canonicalEvent - Master CanonicalOrderEvent
     * @param {string} params.operation - "PLACE" | "MODIFY" | "CANCEL"
     * @param {number} params.targetQuantity - Sized follower quantity
     * @param {number} [params.price=0] - Estimated or limit price
     * @returns {{ allowed: boolean, reason?: string }}
     */
    validateOperation({ copyConfig, follower, canonicalEvent, operation, targetQuantity, price = 0 }) {
        // 1. Global Copy Trading Enablement
        if (!copyConfig || !copyConfig.isEnabled) {
            return { allowed: false, reason: "Global copy trading is disabled" };
        }

        // 2. Global Emergency Stop (Kill Switch)
        if (copyConfig.emergencyStop) {
            return { 
                allowed: false, 
                reason: `Emergency Stop active: ${copyConfig.emergencyStopReason || "Trading halted immediately"}` 
            };
        }

        // 3. Global Pause
        if (copyConfig.isPaused) {
            return { allowed: false, reason: "Copy trading engine is globally paused" };
        }

        // 4. Follower Enablement and Independent Pause
        if (!follower || !follower.isEnabled) {
            return { allowed: false, reason: `Follower account ${follower?.followerName || "unnamed"} is disabled` };
        }
        if (follower.isPaused) {
            return { allowed: false, reason: `Follower account ${follower.followerName} is paused` };
        }

        // 5. Operation Toggle Checks
        if (operation === "PLACE" && follower.copyNewOrders === false) {
            return { allowed: false, reason: "New order copying is disabled for this follower" };
        }
        if (operation === "MODIFY" && follower.copyModifications === false) {
            return { allowed: false, reason: "Order modification copying is disabled for this follower" };
        }
        if (operation === "CANCEL" && follower.copyCancellations === false) {
            return { allowed: false, reason: "Order cancellation copying is disabled for this follower" };
        }

        // For cancellations, quantity & notional limits do not apply
        if (operation === "CANCEL") {
            return { allowed: true };
        }

        // 6. Broker Capabilities Verification
        const capabilities = getBrokerCapabilities(follower.followerBroker);
        if (operation === "PLACE" && !capabilities.supportsOrderPlacement) {
            return { allowed: false, reason: `Broker ${follower.followerBroker} does not support automated order placement` };
        }
        if (operation === "MODIFY" && !capabilities.supportsOrderModification) {
            return { allowed: false, reason: `Broker ${follower.followerBroker} does not support order modification` };
        }
        if (operation === "CANCEL" && !capabilities.supportsOrderCancellation) {
            return { allowed: false, reason: `Broker ${follower.followerBroker} does not support order cancellation` };
        }

        // 7. Allowed Segments, Products & Order Types
        const seg = String(canonicalEvent.segment || "EQUITY").toUpperCase();
        if (Array.isArray(follower.allowedSegments) && follower.allowedSegments.length > 0) {
            const hasSeg = follower.allowedSegments.some((s) => s.toUpperCase() === seg);
            if (!hasSeg) {
                return { allowed: false, reason: `Segment '${seg}' is not allowed for this follower` };
            }
        }

        const prod = String(canonicalEvent.productCode || "INTRADAY").toUpperCase();
        if (Array.isArray(follower.allowedProducts) && follower.allowedProducts.length > 0) {
            const hasProd = follower.allowedProducts.some((p) => p.toUpperCase() === prod);
            if (!hasProd) {
                return { allowed: false, reason: `Product '${prod}' is not allowed for this follower` };
            }
        }

        const ot = String(canonicalEvent.orderType || "MARKET").toUpperCase();
        if (Array.isArray(follower.allowedOrderTypes) && follower.allowedOrderTypes.length > 0) {
            const hasOt = follower.allowedOrderTypes.some((o) => o.toUpperCase() === ot);
            if (!hasOt) {
                return { allowed: false, reason: `Order type '${ot}' is not allowed for this follower` };
            }
        }

        // 8. Quantity Constraints
        const qty = Number(targetQuantity || 0);
        if (qty <= 0) {
            return { allowed: false, reason: "Calculated follower order quantity is zero or negative" };
        }

        const maxQty = Number(follower.maxOrderQuantity || 0);
        if (maxQty > 0 && qty > maxQty) {
            return { 
                allowed: false, 
                reason: `Calculated quantity (${qty}) exceeds follower max order quantity limit (${maxQty})` 
            };
        }

        // 9. Notional Value Constraints
        const estPrice = Number(price > 0 ? price : canonicalEvent.price > 0 ? canonicalEvent.price : 0);
        if (estPrice > 0) {
            const notional = qty * estPrice;
            const maxNotional = Number(follower.maxOrderNotional || 0);
            if (maxNotional > 0 && notional > maxNotional) {
                return {
                    allowed: false,
                    reason: `Estimated notional value (₹${notional.toFixed(2)}) exceeds follower limit (₹${maxNotional})`
                };
            }
        }

        // 10. Rate Limiting Check
        const rateLimitResult = this._checkRateLimit(follower.followerAccountId, copyConfig.riskLimits?.maxOrdersPerSecond || 10);
        if (!rateLimitResult.allowed) {
            return rateLimitResult;
        }

        return { allowed: true };
    }

    _checkRateLimit(accountId, maxPerSecond) {
        const now = Date.now();
        const windowStart = now - 1000;
        let timestamps = this.rateLimitWindows.get(accountId) || [];
        
        // Retain only timestamps within the last second
        timestamps = timestamps.filter((t) => t > windowStart);
        
        if (timestamps.length >= maxPerSecond) {
            return { 
                allowed: false, 
                reason: `Order rate limit exceeded (${timestamps.length}/${maxPerSecond} per second)` 
            };
        }

        timestamps.push(now);
        this.rateLimitWindows.set(accountId, timestamps);
        return { allowed: true };
    }

    clearRateLimits() {
        this.rateLimitWindows.clear();
    }
}

export const riskValidationService = new RiskValidationService();
export default riskValidationService;
