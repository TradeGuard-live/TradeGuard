/**
 * MarketDataEngine.js
 * 
 * ✅ Real-Time Market Data Engine for TradeGuard
 * 
 * Core Features:
 * - Direct integration with UpstoxMarketDataService (REST quote snapshot + WebSocket streamer)
 * - Support for Dhan & Angel One real-time feeds
 * - Session-aware: checks official Indian market hours (09:15 - 15:30 IST) & trading holidays
 * - NO SIMULATED OR RANDOM PRICES: Math.random() is strictly forbidden in production.
 * - During off-market / closed sessions:
 *   - Fetches and preserves official closing price / last traded price from provider
 *   - Freezes ticks completely; no phantom price movements
 *   - Labels quotes with accurate session status ("MARKET_CLOSED" / "PRE_OPEN" / "LIVE")
 * - Dispatches validated live price updates to P&L Engine and live WebSocket clients
 */

import upstoxMarketDataService from "../../brokers/upstox/UpstoxMarketDataService.js";
import dhanMarketData from "../../brokers/dhan/DhanMarketDataService.js";
import angelOneMarketData from "../../brokers/angelOne/AngelOneMarketDataService.js";
import quoteCache from "./quoteCache.js";
import upstoxInstrumentService from "./upstoxInstrumentService.js";
import { getMarketSession, isIndianMarketOpen } from "./marketSessionService.js";

export { isIndianMarketOpen, getMarketSession };

export class MarketDataEngine {
    constructor() {
        this.subscribers = new Map();   // userId -> Set of instrument tokens
        this.listeners = new Set();     // Callbacks: (userId, instrumentKey, ltp, quoteObj) => void
    }

    /**
     * Register a callback for price updates
     */
    onPriceUpdate(callback) {
        if (typeof callback === "function") {
            this.listeners.add(callback);
        }
    }

    /**
     * Notify all registered listeners of a price update
     */
    notify(userId, instrumentKey, ltp, quoteObj = null) {
        if (!quoteCache.isValidPrice(ltp)) return;

        const normalizedKey = upstoxInstrumentService.normalizeInstrumentKey(instrumentKey);
        for (const cb of this.listeners) {
            try {
                cb(userId, normalizedKey, Number(ltp), quoteObj);
            } catch (err) {
                console.error("[MarketDataEngine] Listener error:", err.message);
            }
        }
    }

    /**
     * Start market data streaming & quote loading for a user's open positions
     * @param {string} userId - User identifier
     * @param {Array} positions - User open positions
     * @param {string|object} brokerAuth - Upstox access token OR credentials object
     */
    async start(userId, positions = [], brokerAuth = null) {
        if (!userId) return;
        const uId = String(userId);

        // Stop existing streams for this user
        await this.stop(uId);

        if (!Array.isArray(positions) || positions.length === 0) {
            return;
        }

        // Collect resolved instrument keys
        const instrumentKeys = [];
        positions.forEach(p => {
            const key = upstoxInstrumentService.resolveInstrumentKey(p) || p.instrumentToken || p.symbol;
            if (key) {
                instrumentKeys.push(key);
                // Pre-populate quote cache with existing position broker prices if available
                const existingLtp = Number(p.lastBrokerPrice || p.lastPrice || 0);
                if (quoteCache.isValidPrice(existingLtp)) {
                    quoteCache.updateQuote({
                        instrumentKey: key,
                        symbol: p.symbol,
                        exchange: p.exchange || "NSE",
                        segment: p.segment || "EQUITY",
                        lastPrice: existingLtp,
                        source: "BROKER_POSITION",
                        lastPriceAt: Date.now()
                    });
                }
            }
        });

        this.subscribers.set(uId, new Set(instrumentKeys));

        const upstoxToken = typeof brokerAuth === "string" ? brokerAuth : brokerAuth?.upstoxToken;
        const dhanToken = typeof brokerAuth === "object" ? brokerAuth?.dhanToken : null;
        const dhanClientId = typeof brokerAuth === "object" ? brokerAuth?.dhanClientId : null;
        const angelToken = typeof brokerAuth === "object" ? brokerAuth?.angelToken : null;
        const angelApiKey = typeof brokerAuth === "object" ? brokerAuth?.angelApiKey : null;

        // 1. Upstox Market Data Feed & Quotes
        if (upstoxToken) {
            try {
                // Fetch immediate official REST quote snapshot for all instruments
                const restQuotes = await upstoxMarketDataService.fetchQuotesRest(upstoxToken, instrumentKeys);

                // Broadcast official quotes to subscribers immediately
                for (const [key, q] of restQuotes.entries()) {
                    this.notify(uId, key, q.lastPrice, q);
                    if (q.symbol) this.notify(uId, q.symbol, q.lastPrice, q);
                }

                // If regular trading market session is open, connect live WebSocket feed
                const session = getMarketSession("NSE", "EQUITY");
                if (session.isOpen) {
                    await upstoxMarketDataService.start(
                        uId,
                        upstoxToken,
                        instrumentKeys,
                        (key, ltp, quoteObj) => {
                            this.notify(uId, key, ltp, quoteObj);
                        }
                    );
                } else {
                    console.log(`[MarketDataEngine] Indian market is currently ${session.session} (${session.message}). Holding steady closing quotes.`);
                }
            } catch (err) {
                console.warn("[MarketDataEngine] Upstox market data notice:", err.message);
            }
        }

        // 2. Dhan Market Data
        if (dhanToken && dhanClientId) {
            try {
                await dhanMarketData.start(
                    uId,
                    dhanClientId,
                    dhanToken,
                    instrumentKeys,
                    (tick) => {
                        if (tick?.instrumentKey && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.instrumentKey, Number(tick.ltp));
                        }
                        if (tick?.symbol && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.symbol, Number(tick.ltp));
                        }
                    }
                );
            } catch (dErr) {
                console.warn("[MarketDataEngine] Dhan market data notice:", dErr.message);
            }
        }

        // 3. Angel One Market Data
        if (angelToken) {
            try {
                await angelOneMarketData.start(
                    uId,
                    angelApiKey,
                    angelToken,
                    instrumentKeys,
                    (tick) => {
                        if (tick?.instrumentKey && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.instrumentKey, Number(tick.ltp));
                        }
                        if (tick?.symbol && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.symbol, Number(tick.ltp));
                        }
                    }
                );
            } catch (aErr) {
                console.warn("[MarketDataEngine] Angel One market data notice:", aErr.message);
            }
        }

        // ✅ NO RANDOM SIMULATOR IS STARTED. Prices stay rock-solid at last verified closing/trade price.
    }

    /**
     * Stop market data streaming for a user
     */
    async stop(userId) {
        if (!userId) return;
        const uId = String(userId);

        try {
            await upstoxMarketDataService.stop(uId);
        } catch (e) {
            // ignore
        }

        try {
            dhanMarketData.stop(uId);
        } catch (e) {
            // ignore
        }

        try {
            angelOneMarketData.stop(uId);
        } catch (e) {
            // ignore
        }

        this.subscribers.delete(uId);
    }
}

const marketDataEngine = new MarketDataEngine();
export default marketDataEngine;
