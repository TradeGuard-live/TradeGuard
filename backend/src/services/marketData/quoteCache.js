/**
 * quoteCache.js
 * 
 * ✅ Thread-safe, Timestamp-ordered Quote Cache & Price Validator
 * 
 * Rules strictly enforced:
 * 1. Average entry price must NEVER be overwritten by a market quote.
 * 2. Previous close must NOT be confused with current LTP.
 * 3. An API failure must NEVER silently replace the last valid market price with zero,
 *    null converted to zero, entry price, or synthetic random prices.
 * 4. Stale/delayed out-of-order updates are rejected (timestamp ordering).
 * 5. Session awareness: market status & quote freshness explicitly tracked.
 * 6. Malformed prices (NaN, Infinity, <= 0) rejected.
 */

import { getMarketSession } from "./marketSessionService.js";

// Freshness threshold in milliseconds during open market
const FRESHNESS_THRESHOLD_MS = 15000; // 15 seconds

export class QuoteCache {
    constructor() {
        this.quotes = new Map(); // instrumentKey -> quoteObject
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
     */
    normalizeTimestamp(ts) {
        if (!ts) return Date.now();
        if (typeof ts === "number") {
            // Check if timestamp is in seconds or milliseconds
            return ts < 10000000000 ? ts * 1000 : ts;
        }
        const parsed = new Date(ts).getTime();
        return Number.isNaN(parsed) ? Date.now() : parsed;
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

        const existing = this.quotes.get(normalizedKey);

        const rawPrice = data.lastPrice !== undefined ? data.lastPrice : data.ltp;
        const currentLtp = Number(rawPrice);
        if (!this.isValidPrice(currentLtp)) {
            return { accepted: false, reason: "INVALID_PRICE" };
        }

        const rawTime = data.lastPriceAt || data.timestamp || data.time;
        const quoteTime = this.normalizeTimestamp(rawTime);

        // Timestamp ordering check: Prevent delayed or out-of-order responses from overwriting newer quotes
        if (existing && existing.lastPriceAt && quoteTime < existing.lastPriceAt) {
            return { accepted: false, reason: "STALE_TIMESTAMP" };
        }

        const exchange = data.exchange || normalizedKey.split("|")[0]?.split("_")[0] || "NSE";
        const segment = data.segment || "EQUITY";

        // Evaluate session status for this instrument
        const sessionInfo = getMarketSession(exchange, segment, new Date(quoteTime));

        let quoteFreshness = "LIVE";
        if (!sessionInfo.isOpen) {
            quoteFreshness = "MARKET_CLOSED";
        } else {
            const ageMs = Date.now() - quoteTime;
            if (ageMs > FRESHNESS_THRESHOLD_MS) {
                quoteFreshness = "STALE";
            } else {
                quoteFreshness = "LIVE";
            }
        }

        const validClose = this.isValidPrice(data.previousClose || data.cp) ? Number(data.previousClose || data.cp) : (existing?.previousClose || null);
        const validOpen = this.isValidPrice(data.sessionOpen || data.open) ? Number(data.sessionOpen || data.open) : (existing?.sessionOpen || null);
        const validHigh = this.isValidPrice(data.sessionHigh || data.high) ? Number(data.sessionHigh || data.high) : (existing?.sessionHigh || null);
        const validLow = this.isValidPrice(data.sessionLow || data.low) ? Number(data.sessionLow || data.low) : (existing?.sessionLow || null);

        const record = {
            accepted: true,
            instrumentKey: normalizedKey,
            symbol: data.symbol || existing?.symbol || normalizedKey.split("|")[1] || normalizedKey,
            exchange,
            segment,
            lastPrice: currentLtp,
            previousClose: validClose,
            sessionOpen: validOpen,
            sessionHigh: validHigh,
            sessionLow: validLow,
            lastPriceAt: quoteTime,
            quoteReceivedAt: Date.now(),
            quoteSource: data.source || data.quoteSource || "UPSTOX_REST",
            quoteFreshness,
            marketStatus: sessionInfo.session,
            isMarketOpen: sessionInfo.isOpen
        };

        this.quotes.set(normalizedKey, record);

        if (data.symbol) {
            this.quotes.set(String(data.symbol).toUpperCase(), record);
        }

        return record;
    }

    /**
     * Retrieve quote by instrument key or symbol.
     * Evaluates live freshness on retrieval.
     */
    getQuote(keyOrSymbol) {
        if (!keyOrSymbol) return null;
        const normalized = String(keyOrSymbol).replace(":", "|").trim();
        const quote = this.quotes.get(normalized) || this.quotes.get(String(keyOrSymbol).toUpperCase());
        if (!quote) return null;

        // Refresh freshness status on read
        const sessionInfo = getMarketSession(quote.exchange, quote.segment);
        if (!sessionInfo.isOpen) {
            quote.quoteFreshness = "MARKET_CLOSED";
            quote.marketStatus = sessionInfo.session;
            quote.isMarketOpen = false;
        } else {
            const ageMs = Date.now() - quote.lastPriceAt;
            quote.quoteFreshness = ageMs > FRESHNESS_THRESHOLD_MS ? "STALE" : "LIVE";
            quote.marketStatus = sessionInfo.session;
            quote.isMarketOpen = true;
        }

        return { ...quote };
    }

    /**
     * Clear all cached quotes (for testing or reset)
     */
    clear() {
        this.quotes.clear();
    }
}

const quoteCache = new QuoteCache();
export default quoteCache;
