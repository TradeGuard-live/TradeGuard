/**
 * quoteCache.js
 * 
 * ✅ Thread-safe, Timestamp-ordered Quote Cache & Price Validator
 * 
 * Rules strictly enforced:
 * 1. Canonical instrument key as primary key with separate symbol & token indexes (no collisions).
 * 2. Average entry price must NEVER be overwritten by a market quote.
 * 3. Previous close must NOT be confused with current LTP.
 * 4. An API failure must NEVER silently replace the last valid market price with zero,
 *    null converted to zero, entry price, or synthetic random prices.
 * 5. Provider timestamp (lastPriceAt) preserved separately from receipt timestamp (quoteReceivedAt).
 * 6. Never fabricate Date.now() when provider timestamp is missing; handle missing/malformed timestamps explicitly.
 * 7. Out-of-order quote rejection via timestamp ordering.
 * 8. Session-aware: recalculates market status & quote freshness accurately on read using instrument exchange/segment.
 * 9. Malformed prices (NaN, Infinity, <= 0) strictly rejected.
 */

import { getMarketSession } from "./marketSessionService.js";

// Freshness threshold in milliseconds during open market
const FRESHNESS_THRESHOLD_MS = 15000; // 15 seconds

export class QuoteCache {
    constructor() {
        // ✅ Primary storage: canonical instrument key -> quote record
        this.quotes = new Map();
        // ✅ Secondary index: normalized symbol (e.g. RELIANCE) -> canonical instrument key
        this.symbolIndex = new Map();
        // ✅ Secondary index: raw token / alias (e.g. NSE_EQ:RELIANCE, NSE_FO|40005) -> canonical instrument key
        this.aliasIndex = new Map();
    }

    /**
     * Validate raw price value.
     * Must be a finite, positive number.
     */
    isValidPrice(val) {
        if (val === null || val === undefined) return false;
        const num = Number(val);
        return Number.isFinite(num) && num > 0;
    }

    /**
     * Normalizes timestamps into epoch milliseconds.
     * Returns null if missing or malformed — NEVER fabricates Date.now().
     */
    normalizeTimestamp(ts) {
        if (ts === null || ts === undefined || ts === "") return null;
        if (typeof ts === "number") {
            if (!Number.isFinite(ts) || ts <= 0) return null;
            // Check if timestamp is in seconds (e.g. 10 digits) or milliseconds (13 digits)
            return ts < 10000000000 ? Math.round(ts * 1000) : Math.round(ts);
        }
        const parsed = new Date(ts).getTime();
        return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
    }

    /**
     * Updates or inserts a quote in the cache after strict validation and timestamp ordering.
     * Supports either updateQuote({ instrumentKey, ... }) or updateQuote(key, quoteObj).
     * @returns {object} Result with { accepted: boolean, quote: object, reason?: string, ...quote }
     */
    updateQuote(firstArg, secondArg) {
        let key = null;
        let data = {};

        if (typeof firstArg === "string") {
            key = firstArg;
            data = secondArg || {};
        } else if (firstArg && typeof firstArg === "object") {
            key = firstArg.instrumentKey || firstArg.key;
            data = firstArg;
        }

        if (!key) return { accepted: false, reason: "MISSING_INSTRUMENT_KEY" };

        const normalizedKey = String(key).replace(":", "|").trim();

        // Instrument key validation: if data contains instrumentKey and differs from target key
        if (data.instrumentKey && String(data.instrumentKey).replace(":", "|").trim() !== normalizedKey) {
            return { accepted: false, reason: "INSTRUMENT_MISMATCH" };
        }

        // Check primary quotes or alias
        const existing = this.quotes.get(normalizedKey) || 
                         (this.aliasIndex.has(normalizedKey) ? this.quotes.get(this.aliasIndex.get(normalizedKey)) : null);

        const rawPrice = data.lastPrice !== undefined ? data.lastPrice : data.ltp;
        const currentLtp = Number(rawPrice);
        if (!this.isValidPrice(currentLtp)) {
            return { accepted: false, reason: "INVALID_PRICE" };
        }

        // Provider timestamp (last trade execution timestamp from exchange)
        const hasExplicitTimeField = data.lastPriceAt !== undefined || data.timestamp !== undefined || data.time !== undefined || data.ltt !== undefined;
        const rawTime = data.lastPriceAt !== undefined ? data.lastPriceAt : (data.timestamp ?? data.time ?? data.ltt);
        const quoteTime = this.normalizeTimestamp(rawTime);

        // 1. If timestamp was explicitly provided but malformed, reject it
        if (hasExplicitTimeField && rawTime !== null && rawTime !== undefined && quoteTime === null) {
            return { accepted: false, reason: "MALFORMED_TIMESTAMP" };
        }

        // 2. Prevent a quote with unknown/missing timestamp from overwriting a newer verified timestamped quote
        if (existing && existing.lastPriceAt && !quoteTime) {
            return { accepted: false, reason: "MISSING_TIMESTAMP_OVERWRITE_PREVENTED" };
        }

        // 3. Timestamp ordering check: Prevent delayed or out-of-order responses from overwriting newer quotes
        if (existing && existing.lastPriceAt && quoteTime && quoteTime < existing.lastPriceAt) {
            return { accepted: false, reason: "STALE_TIMESTAMP" };
        }

        const exchange = String(data.exchange || existing?.exchange || normalizedKey.split("|")[0]?.split("_")[0] || "NSE").toUpperCase();
        const segment = String(data.segment || existing?.segment || (normalizedKey.includes("_FO") ? "OPTIONS" : "EQUITY")).toUpperCase();
        const rawSymbol = data.symbol || existing?.symbol || normalizedKey.split("|")[1] || normalizedKey;
        const cleanSymbol = String(rawSymbol).toUpperCase().replace(/(-EQ|\.NSE|\.BSE|-BE|-BL)$/i, "").trim();

        // Evaluate session status using instrument's actual exchange and segment
        const sessionInfo = getMarketSession(exchange, segment);
        const receiptTime = Date.now();
        const effectiveLastPriceAt = quoteTime || existing?.lastPriceAt || null;

        let quoteFreshness = "LIVE";
        if (!sessionInfo.isOpen) {
            quoteFreshness = "MARKET_CLOSED";
        } else if (effectiveLastPriceAt) {
            const ageMs = receiptTime - effectiveLastPriceAt;
            quoteFreshness = ageMs > FRESHNESS_THRESHOLD_MS ? "STALE" : "LIVE";
        } else {
            // Missing provider timestamp: explicitly mark as DELAYED or STALE, NEVER claim verified LIVE
            quoteFreshness = (receiptTime - (existing?.quoteReceivedAt || receiptTime)) > FRESHNESS_THRESHOLD_MS ? "STALE" : "DELAYED";
        }

        const validClose = this.isValidPrice(data.previousClose || data.cp || data.close) 
            ? Number(data.previousClose || data.cp || data.close) 
            : (existing?.previousClose || null);
        const validOpen = this.isValidPrice(data.sessionOpen || data.open) 
            ? Number(data.sessionOpen || data.open) 
            : (existing?.sessionOpen || null);
        const validHigh = this.isValidPrice(data.sessionHigh || data.high) 
            ? Number(data.sessionHigh || data.high) 
            : (existing?.sessionHigh || null);
        const validLow = this.isValidPrice(data.sessionLow || data.low) 
            ? Number(data.sessionLow || data.low) 
            : (existing?.sessionLow || null);

        const record = {
            accepted: true,
            instrumentKey: normalizedKey,
            symbol: cleanSymbol,
            exchange,
            segment,
            lastPrice: currentLtp,
            previousClose: validClose,
            sessionOpen: validOpen,
            sessionHigh: validHigh,
            sessionLow: validLow,
            lastPriceAt: effectiveLastPriceAt,
            quoteReceivedAt: receiptTime,
            quoteSource: data.source || data.quoteSource || existing?.quoteSource || "UPSTOX_REST",
            quoteFreshness,
            marketStatus: sessionInfo.session,
            isMarketOpen: sessionInfo.isOpen,
            marketSessionDate: sessionInfo.dateStr
        };

        // ✅ Primary storage: canonical instrument key
        this.quotes.set(normalizedKey, record);

        // ✅ Separate symbol index (does NOT collide with primary key)
        if (cleanSymbol) {
            this.symbolIndex.set(cleanSymbol, normalizedKey);
        }

        // ✅ Separate token / alias index
        if (data.instrumentToken && data.instrumentToken !== normalizedKey) {
            this.aliasIndex.set(String(data.instrumentToken).replace(":", "|").trim(), normalizedKey);
        }
        if (key !== normalizedKey) {
            this.aliasIndex.set(key, normalizedKey);
        }
        if (data.rawKey && data.rawKey !== normalizedKey) {
            this.aliasIndex.set(data.rawKey, normalizedKey);
        }

        return { ...record };
    }

    /**
     * Retrieve quote by instrument key or symbol.
     * Evaluates live freshness on retrieval dynamically against current market session.
     */
    getQuote(keyOrSymbol) {
        if (!keyOrSymbol) return null;
        const normalized = String(keyOrSymbol).replace(":", "|").trim();
        const upper = normalized.toUpperCase();

        // 1. Primary lookup
        let quote = this.quotes.get(normalized) || this.quotes.get(upper);

        // 2. Alias index lookup
        if (!quote && this.aliasIndex.has(normalized)) {
            const canonical = this.aliasIndex.get(normalized);
            quote = this.quotes.get(canonical);
        }

        // 3. Symbol index lookup
        if (!quote && this.symbolIndex.has(upper)) {
            const canonical = this.symbolIndex.get(upper);
            quote = this.quotes.get(canonical);
        }

        if (!quote) return null;

        // ✅ Recalculate session status & quote freshness dynamically on read
        const sessionInfo = getMarketSession(quote.exchange, quote.segment);
        const now = Date.now();

        if (!sessionInfo.isOpen) {
            quote.quoteFreshness = "MARKET_CLOSED";
            quote.marketStatus = sessionInfo.session;
            quote.isMarketOpen = false;
        } else if (quote.lastPriceAt) {
            const ageMs = now - quote.lastPriceAt;
            quote.quoteFreshness = ageMs > FRESHNESS_THRESHOLD_MS ? "STALE" : "LIVE";
            quote.marketStatus = sessionInfo.session;
            quote.isMarketOpen = true;
        } else {
            const ageMs = now - (quote.quoteReceivedAt || now);
            quote.quoteFreshness = ageMs > FRESHNESS_THRESHOLD_MS ? "STALE" : "DELAYED";
            quote.marketStatus = sessionInfo.session;
            quote.isMarketOpen = true;
        }

        quote.marketSessionDate = sessionInfo.dateStr;

        return { ...quote };
    }

    /**
     * Explicitly registers an alias token (e.g. NSE_EQ:RELIANCE) pointing to a canonical instrument key.
     */
    registerAlias(alias, canonicalKey) {
        if (!alias || !canonicalKey) return;
        const raw = String(alias).trim();
        const canon = String(canonicalKey).trim();
        this.aliasIndex.set(raw, canon);
        this.aliasIndex.set(raw.replace(":", "|"), canon);
        this.aliasIndex.set(raw.toUpperCase(), canon);
        this.aliasIndex.set(raw.replace(":", "|").toUpperCase(), canon);
    }

    /**
     * Clear all cached quotes and secondary indexes (for testing or reset)
     */
    clear() {
        this.quotes.clear();
        this.symbolIndex.clear();
        this.aliasIndex.clear();
    }
}

const quoteCache = new QuoteCache();
export default quoteCache;
