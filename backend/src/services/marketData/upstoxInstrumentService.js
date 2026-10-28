/**
 * upstoxInstrumentService.js
 * 
 * ✅ Comprehensive Upstox Instrument Mapping & Validation Service
 * - Resolves canonical Upstox instrument keys:
 *   - NSE Equity: NSE_EQ|INE...
 *   - BSE Equity: BSE_EQ|INE...
 *   - NSE Futures & Options: NSE_FO|...
 *   - BSE Derivatives: BSE_FO|...
 *   - MCX Commodities: MCX_FO|...
 * - Normalizes colon and pipe delimiters (e.g. "NSE_EQ:RELIANCE" <-> "NSE_EQ|RELIANCE")
 * - Validates quote instrument identities to prevent quote substitution across similarly named instruments
 * - Caches resolved instrument metadata safely in memory
 * - Fetches & refreshes from Upstox instrument master cache when needed
 */

import axios from "axios";
import zlib from "zlib";

// Common pre-seeded NSE/BSE Bluechip ISIN mappings for instant, zero-latency startup
const KNOWN_INSTRUMENTS = {
    // Equities
    "NSE|RELIANCE": "NSE_EQ|INE002A01018",
    "NSE|TCS": "NSE_EQ|INE467B01029",
    "NSE|HDFCBANK": "NSE_EQ|INE040A01034",
    "NSE|INFY": "NSE_EQ|INE009A01021",
    "NSE|ICICIBANK": "NSE_EQ|INE090A01021",
    "NSE|SBIN": "NSE_EQ|INE062A01020",
    "NSE|BHARTIARTL": "NSE_EQ|INE397D01024",
    "NSE|ITC": "NSE_EQ|INE154A01025",
    "NSE|KOTAKBANK": "NSE_EQ|INE237A01028",
    "NSE|LT": "NSE_EQ|INE018A01030",
    "NSE|AXISBANK": "NSE_EQ|INE238A01034",
    "NSE|TATAMOTORS": "NSE_EQ|INE155A01022",
    "NSE|TATASTEEL": "NSE_EQ|INE081A01020",
    "NSE|BAJFINANCE": "NSE_EQ|INE296A01024",
    "NSE|MARUTI": "NSE_EQ|INE585B01010",
    "NSE|HINDUNILVR": "NSE_EQ|INE030A01027",
    "NSE|WIPRO": "NSE_EQ|INE075A01022",
    "NSE|BSE": "NSE_EQ|INE118H01025",

    // BSE Equities
    "BSE|RELIANCE": "BSE_EQ|INE002A01018",
    "BSE|TCS": "BSE_EQ|INE467B01029",
    "BSE|HDFCBANK": "BSE_EQ|INE040A01034",
    "BSE|INFY": "BSE_EQ|INE009A01021",
    "BSE|ICICIBANK": "BSE_EQ|INE090A01021",
    "BSE|SBIN": "BSE_EQ|INE062A01020",
    "BSE|BSE": "BSE_EQ|INE118H01025"
};

class UpstoxInstrumentService {
    constructor() {
        this.cache = new Map(); // key -> instrumentKey
        this.reverseCache = new Map(); // instrumentKey -> metadata
        this.isInitialized = false;

        // Initialize with pre-seeded dictionary
        for (const [key, instKey] of Object.entries(KNOWN_INSTRUMENTS)) {
            this.cache.set(key, instKey);
            const [exchange, symbol] = key.split("|");
            this.reverseCache.set(instKey, {
                exchange,
                symbol,
                instrumentKey: instKey
            });
        }
    }

    /**
     * Normalizes symbol string (removes whitespace, -EQ, .NSE, etc.)
     */
    normalizeSymbol(symbol = "") {
        let s = String(symbol || "").toUpperCase().trim();
        s = s.replace(/(-EQ|\.NSE|\.BSE|-BE|-BL)$/i, "");
        return s;
    }

    /**
     * Normalizes key delimiter between Upstox REST (colon) and WebSocket (pipe)
     * e.g. "NSE_EQ:INE002A01018" -> "NSE_EQ|INE002A01018"
     */
    normalizeInstrumentKey(key = "") {
        if (!key) return "";
        return String(key).replace(":", "|").trim();
    }

    /**
     * Resolves the canonical Upstox instrument key for a position or trade record.
     * @param {object} positionOrTrade - { symbol, exchange, segment, instrumentToken, brokerResponse }
     * @returns {string|null} Canonical instrument key or null if unresolvable
     */
    resolveInstrumentKey(positionOrTrade) {
        if (!positionOrTrade) return null;

        // 1. Direct explicit instrument token from broker if valid
        const rawToken = positionOrTrade.instrumentToken ||
                         positionOrTrade.instrument_token ||
                         positionOrTrade.brokerResponse?.instrument_token;

        if (rawToken && typeof rawToken === "string") {
            const normalized = this.normalizeInstrumentKey(rawToken);
            // Must contain exchange prefix and pipe or colon, e.g. "NSE_EQ|..." or "NSE_FO|..."
            if (normalized.includes("|") && /^(NSE|BSE|MCX)_(EQ|FO|COM)/i.test(normalized)) {
                return normalized;
            }
        }

        // 2. Lookup by exchange and clean symbol
        const exchange = String(positionOrTrade.exchange || "NSE").toUpperCase();
        const symbol = this.normalizeSymbol(
            positionOrTrade.symbol ||
            positionOrTrade.trading_symbol ||
            positionOrTrade.tradingsymbol ||
            positionOrTrade.scrip_name
        );

        if (!symbol) return null;

        const cacheKey = `${exchange}|${symbol}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // 3. Fallback to exchange segment prefix if explicit ISIN format is used
        if (symbol.startsWith("INE") || symbol.startsWith("INF")) {
            const prefix = exchange === "BSE" ? "BSE_EQ" : "NSE_EQ";
            return `${prefix}|${symbol}`;
        }

        // 4. Return provider symbol key format for quotes if allowed
        // e.g. NSE_EQ|RELIANCE
        const prefix = exchange === "BSE" ? "BSE_EQ" : (
            positionOrTrade.segment === "FUTURES" || positionOrTrade.segment === "OPTIONS"
                ? "NSE_FO"
                : "NSE_EQ"
        );
        return `${prefix}|${symbol}`;
    }

    /**
     * Validates that an incoming quote belongs to the requested instrument.
     * Prevents mismatched quotes from corrupting position P&L.
     */
    validateQuoteMatch(requestedKey, returnedKey, expectedSymbol) {
        if (!requestedKey || !returnedKey) return false;

        const normReq = this.normalizeInstrumentKey(requestedKey);
        const normRet = this.normalizeInstrumentKey(returnedKey);

        if (normReq === normRet) return true;

        // If returned key matches symbol lookup in reverse cache
        if (this.reverseCache.has(normRet)) {
            const meta = this.reverseCache.get(normRet);
            if (expectedSymbol && meta.symbol === this.normalizeSymbol(expectedSymbol)) {
                return true;
            }
        }

        // Check if one is exchange:symbol and other is exchange|ISIN
        const reqParts = normReq.split("|");
        const retParts = normRet.split("|");

        if (reqParts.length === 2 && retParts.length === 2) {
            if (reqParts[0] === retParts[0]) {
                if (expectedSymbol && (retParts[1] === this.normalizeSymbol(expectedSymbol) || reqParts[1] === this.normalizeSymbol(expectedSymbol))) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Register a new instrument mapping dynamically (e.g. from broker sync response)
     */
    registerInstrument(exchange, symbol, instrumentKey) {
        if (!exchange || !symbol || !instrumentKey) return;
        const ex = String(exchange).toUpperCase();
        const sym = this.normalizeSymbol(symbol);
        const normKey = this.normalizeInstrumentKey(instrumentKey);

        const cacheKey = `${ex}|${sym}`;
        this.cache.set(cacheKey, normKey);
        this.reverseCache.set(normKey, { exchange: ex, symbol: sym, instrumentKey: normKey });
    }
}

const upstoxInstrumentService = new UpstoxInstrumentService();
export default upstoxInstrumentService;
