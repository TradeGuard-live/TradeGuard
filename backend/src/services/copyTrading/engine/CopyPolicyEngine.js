/**
 * CopyPolicyEngine.js
 * 
 * Computes follower-specific order sizes, multipliers, rounding rules,
 * remaining quantities during modifications, and handles partial fill tracking.
 */

export class CopyPolicyEngine {
    /**
     * Calculates the follower target quantity based on the follower's sizing policy.
     * 
     * @param {Object} params
     * @param {number} params.masterQuantity - Master order quantity
     * @param {Object} params.follower - Follower configuration
     * @param {number} [params.lotSize=1] - Instrument lot size (default 1 for equities)
     * @returns {number} Sized integer quantity
     */
    calculateQuantity({ masterQuantity, follower, lotSize = 1 }) {
        const masterQty = Number(masterQuantity || 0);
        if (masterQty <= 0) return 0;

        const mode = follower.sizingMode || "MULTIPLIER";
        let rawQty = 0;

        if (mode === "FIXED_QUANTITY") {
            rawQty = Number(follower.fixedQuantity || 1);
        } else if (mode === "LOT_PROPORTIONAL") {
            const masterLots = Math.max(1, Math.floor(masterQty / lotSize));
            const multiplier = Number(follower.multiplier || 1.0);
            rawQty = masterLots * multiplier * lotSize;
        } else {
            // Default: MULTIPLIER
            const multiplier = Number(follower.multiplier || 1.0);
            rawQty = masterQty * multiplier;
        }

        const rounding = follower.roundingRule || "ROUND_DOWN";
        let finalQty = 0;

        if (rounding === "ROUND_UP") {
            finalQty = Math.ceil(rawQty);
        } else if (rounding === "ROUND_NEAREST") {
            finalQty = Math.round(rawQty);
        } else {
            // Default safe: ROUND_DOWN
            finalQty = Math.floor(rawQty);
        }

        // Align with lot size if applicable
        if (lotSize > 1) {
            const lots = rounding === "ROUND_UP" 
                ? Math.ceil(finalQty / lotSize) 
                : Math.floor(finalQty / lotSize);
            finalQty = Math.max(0, lots * lotSize);
        }

        return Math.max(0, finalQty);
    }

    /**
     * Computes modified quantities accounting for cumulative fills already executed on the follower.
     * 
     * @param {Object} params
     * @param {number} params.newMasterTotalQuantity - New master order total quantity
     * @param {Object} params.follower - Follower configuration
     * @param {number} params.followerFilledQuantity - Quantity already filled on the follower order
     * @param {number} [params.lotSize=1]
     * @returns {{ isValid: boolean, newFollowerTotalQuantity: number, newRemainingQuantity: number, reason?: string }}
     */
    calculateModification({ newMasterTotalQuantity, follower, followerFilledQuantity = 0, lotSize = 1 }) {
        const newFollowerTotal = this.calculateQuantity({
            masterQuantity: newMasterTotalQuantity,
            follower,
            lotSize
        });

        const filled = Number(followerFilledQuantity || 0);

        if (newFollowerTotal < filled) {
            return {
                isValid: false,
                newFollowerTotalQuantity: newFollowerTotal,
                newRemainingQuantity: 0,
                reason: `New target quantity (${newFollowerTotal}) is less than already filled quantity (${filled})`
            };
        }

        const newRemaining = newFollowerTotal - filled;

        return {
            isValid: true,
            newFollowerTotalQuantity: newFollowerTotal,
            newRemainingQuantity: newRemaining
        };
    }
}

export const copyPolicyEngine = new CopyPolicyEngine();
export default copyPolicyEngine;
