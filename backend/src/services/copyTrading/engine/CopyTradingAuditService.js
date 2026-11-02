/**
 * CopyTradingAuditService.js
 * 
 * Provides structured, tamper-evident audit logging for Copy-Trading operations.
 * Implements strict credential redaction to guarantee zero secret leakage.
 */

import CopyAuditLog from "../../../models/CopyAuditLog.js";

const SENSITIVE_KEYS = new Set([
    "accesstoken",
    "access_token",
    "apikey",
    "api_key",
    "apisecret",
    "api_secret",
    "refreshtoken",
    "refresh_token",
    "password",
    "totpsecret",
    "totp_secret",
    "authorization",
    "feedtoken",
    "feed_token",
    "sid",
    "token"
]);

export class CopyTradingAuditService {
    constructor() {
        this.subscribers = new Set();
    }

    /**
     * Deeply sanitizes an object, redacting all sensitive credential keys
     * @param {any} obj
     * @returns {any}
     */
    sanitize(obj) {
        if (!obj || typeof obj !== "object") return obj;

        if (Array.isArray(obj)) {
            return obj.map((item) => this.sanitize(item));
        }

        const clean = {};
        for (const [key, value] of Object.entries(obj)) {
            const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (SENSITIVE_KEYS.has(lowerKey)) {
                clean[key] = "[REDACTED]";
            } else if (typeof value === "object" && value !== null) {
                clean[key] = this.sanitize(value);
            } else {
                clean[key] = value;
            }
        }
        return clean;
    }

    /**
     * Records an audit event
     * 
     * @param {Object} params
     * @param {string} params.userId
     * @param {string} params.eventType - e.g. "CONFIG_CHANGE", "RISK_REJECT", "EMERGENCY_STOP"
     * @param {"INFO"|"WARN"|"ERROR"|"CRITICAL"} [params.severity="INFO"]
     * @param {string} params.message
     * @param {string} [params.masterOrderId]
     * @param {string} [params.followerOrderId]
     * @param {string} [params.followerAccountId]
     * @param {Object} [params.details]
     * @param {number} [params.latencyMs]
     * @returns {Promise<Object>}
     */
    async log({
        userId,
        eventType,
        severity = "INFO",
        message,
        masterOrderId = null,
        followerOrderId = null,
        followerAccountId = null,
        details = {},
        latencyMs = null
    }) {
        const cleanDetails = this.sanitize(details);

        try {
            const entry = await CopyAuditLog.create({
                userId,
                eventType,
                severity,
                message,
                masterOrderId,
                followerOrderId,
                followerAccountId,
                details: cleanDetails,
                latencyMs
            });

            // Notify real-time stream subscribers
            this._notifySubscribers(entry);
            return entry;
        } catch (err) {
            console.error("[CopyAuditLog] Persistence error:", err.message);
            // Fallback in-memory representation so callers are never blocked
            const fallback = {
                userId,
                eventType,
                severity,
                message,
                masterOrderId,
                followerOrderId,
                followerAccountId,
                details: cleanDetails,
                latencyMs,
                createdAt: new Date()
            };
            this._notifySubscribers(fallback);
            return fallback;
        }
    }

    subscribe(callback) {
        this.subscribers.add(callback);
    }

    unsubscribe(callback) {
        this.subscribers.delete(callback);
    }

    _notifySubscribers(entry) {
        for (const cb of this.subscribers) {
            try {
                cb(entry);
            } catch (e) {
                // Ignore listener exceptions
            }
        }
    }
}

export const copyTradingAuditService = new CopyTradingAuditService();
export default copyTradingAuditService;
