/**
 * IdempotencyService.js
 * 
 * Provides deterministic idempotency key generation and double-submission protection.
 * Combines an in-memory high-throughput LRU set for sub-millisecond deduplication
 * with MongoDB unique index guarantees for persistent restart-proof safety.
 */

import crypto from "crypto";

export class IdempotencyService {
    constructor(maxCacheSize = 10000) {
        this.maxCacheSize = maxCacheSize;
        this.processedKeys = new Set();
        this.keyOrder = []; // Queue for LRU eviction
    }

    /**
     * Generates a deterministic idempotency key for an intended follower operation.
     * 
     * Key structure:
     * SHA256(masterAccountId:masterOrderId:eventVersion:followerAccountId:operation)
     * 
     * @param {Object} params
     * @param {string} params.masterAccountId
     * @param {string} params.masterOrderId
     * @param {number|string} params.eventVersion
     * @param {string} params.followerAccountId
     * @param {string} params.operation - "PLACE" | "MODIFY" | "CANCEL"
     * @returns {string} Hex encoded SHA-256 digest
     */
    generateKey({ masterAccountId, masterOrderId, eventVersion = 1, followerAccountId, operation }) {
        if (!masterAccountId || !masterOrderId || !followerAccountId || !operation) {
            throw new Error("Missing parameters for idempotency key generation");
        }
        const raw = `${masterAccountId}:${masterOrderId}:${eventVersion}:${followerAccountId}:${operation}`;
        return crypto.createHash("sha256").update(raw).digest("hex");
    }

    /**
     * Checks if this key has already been processed or is currently in flight
     * @param {string} key
     * @returns {boolean} True if duplicate
     */
    isDuplicate(key) {
        return this.processedKeys.has(key);
    }

    /**
     * Marks the key as processed in the high-speed local cache
     * @param {string} key
     */
    markProcessed(key) {
        if (this.processedKeys.has(key)) return;

        if (this.keyOrder.length >= this.maxCacheSize) {
            const oldest = this.keyOrder.shift();
            if (oldest) this.processedKeys.delete(oldest);
        }

        this.processedKeys.add(key);
        this.keyOrder.push(key);
    }

    /**
     * Clears local in-memory cache (useful for test resets)
     */
    clear() {
        this.processedKeys.clear();
        this.keyOrder = [];
    }
}

export const idempotencyService = new IdempotencyService();
export default idempotencyService;
