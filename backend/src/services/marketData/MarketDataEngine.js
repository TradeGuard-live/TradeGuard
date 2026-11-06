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
import { getMarketSession, isIndianMarketOpen, isAnyMarketOpen } from "./marketSessionService.js";

export { isIndianMarketOpen, getMarketSession, isAnyMarketOpen };

export class MarketDataEngine {
    constructor() {
        this.subscribers = new Map();   // userId -> Set of instrument tokens
        this.listeners = new Set();     // Callbacks: (userId, instrumentKey, ltp, quoteObj) => void
        this.pollers = new Map();       // userId -> setInterval ID
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
                if (p.instrumentToken && !instrumentKeys.includes(p.instrumentToken)) {
                    instrumentKeys.push(p.instrumentToken);
                }
                if (p.securityId && !instrumentKeys.includes(`${p.exchange || "NSE"}_EQ|${p.securityId}`)) {
                    instrumentKeys.push(`${p.exchange || "NSE"}_EQ|${p.securityId}`);
                }

                // Pre-populate quote cache with existing position broker prices if available
                const existingLtp = Number(p.lastBrokerPrice || p.lastPrice || 0);
                if (quoteCache.isValidPrice(existingLtp)) {
                    // ✅ Do NOT fabricate Date.now(); use provider/trade timestamp or null
                    const providerTime = p.lastTradeDate ? new Date(p.lastTradeDate).getTime() : null;
                    const quoteRecord = {
                        instrumentKey: key,
                        symbol: p.symbol,
                        exchange: p.exchange || "NSE",
                        segment: p.segment || "EQUITY",
                        lastPrice: existingLtp,
                        source: p.broker ? `${p.broker}_POSITION` : "BROKER_POSITION",
                        lastPriceAt: providerTime
                    };
                    quoteCache.updateQuote(quoteRecord);
                    if (p.symbol) {
                        quoteCache.updateQuote({ ...quoteRecord, instrumentKey: p.symbol });
                    }
                    if (p.instrumentToken && p.instrumentToken !== key) {
                        quoteCache.updateQuote({ ...quoteRecord, instrumentKey: p.instrumentToken });
                    }
                    if (p.securityId) {
                        quoteCache.updateQuote({ ...quoteRecord, instrumentKey: `${p.exchange || "NSE"}_EQ|${p.securityId}` });
                    }

                    // Dispatch immediately to registered listeners
                    this.notify(uId, key, existingLtp, quoteRecord);
                    if (p.symbol) this.notify(uId, p.symbol, existingLtp, quoteRecord);
                    if (p.instrumentToken && p.instrumentToken !== key) {
                        this.notify(uId, p.instrumentToken, existingLtp, quoteRecord);
                    }
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
                let restQuotes = new Map();
                try {
                    restQuotes = await upstoxMarketDataService.fetchQuotesRest(upstoxToken, instrumentKeys);
                } catch (rErr) {
                    if (rErr.status === 401 || /401|unauthorized/i.test(rErr.message)) {
                        console.warn(`[MarketDataEngine] Upstox token unauthorized (401) for user ${uId}. Skipping Upstox feed.`);
                        throw rErr;
                    }
                }

                // Broadcast official quotes to subscribers immediately
                for (const [key, q] of restQuotes.entries()) {
                    this.notify(uId, key, q.lastPrice, q);
                    if (q.symbol) this.notify(uId, q.symbol, q.lastPrice, q);
                }

                // Check session: only connect live WebSocket and rapid polling during active market hours
                const isMarketActive = isAnyMarketOpen(instrumentKeys);
                if (isMarketActive) {
                    // Connect live WebSocket feed for streaming updates
                    try {
                        const startRes = await upstoxMarketDataService.start(
                            uId,
                            upstoxToken,
                            instrumentKeys,
                            (key, ltp, quoteObj) => {
                                this.notify(uId, key, ltp, quoteObj);
                            }
                        );
                        if (startRes && startRes.connected === false && startRes.error) {
                            console.warn(`[MarketDataEngine] Upstox streamer could not start for ${uId}: ${startRes.error}`);
                            return;
                        }
                    } catch (sErr) {
                        console.warn("[MarketDataEngine] Upstox WebSocket streamer notice:", sErr.message);
                        return;
                    }

                    // Periodic REST quote polling (every 3 seconds) as a robust real-time fallback
                    if (instrumentKeys.length > 0) {
                        const pollTimer = setInterval(async () => {
                            if (!this.subscribers.has(uId)) {
                                clearInterval(pollTimer);
                                return;
                            }

                            // Auto-stop polling if all subscribed instrument markets have closed
                            const currentSubs = Array.from(this.subscribers.get(uId) || []);
                            if (!isAnyMarketOpen(currentSubs)) {
                                console.log(`[MarketDataEngine] Markets closed for all instruments. Stopping rapid polling and live stream for user ${uId}.`);
                                clearInterval(pollTimer);
                                this.pollers.delete(uId);
                                await this.stop(uId);
                                return;
                            }

                            try {
                                if (currentSubs.length > 0) {
                                    const quotes = await upstoxMarketDataService.fetchQuotesRest(upstoxToken, currentSubs);
                                    for (const [key, q] of quotes.entries()) {
                                        this.notify(uId, key, q.lastPrice, q);
                                        if (q.symbol) this.notify(uId, q.symbol, q.lastPrice, q);
                                    }
                                }
                            } catch (pErr) {
                                if (pErr.status === 401 || /401|unauthorized/i.test(pErr.message)) {
                                    console.warn(`[MarketDataEngine] Upstox REST poller 401 Unauthorized for user ${uId}. Stopping poll timer.`);
                                    clearInterval(pollTimer);
                                    this.pollers.delete(uId);
                                }
                            }
                        }, 3000);
                        this.pollers.set(uId, pollTimer);
                    }
                } else {
                    console.log(`[MarketDataEngine] Indian market is closed. Preserved official closing quotes via REST; WebSocket streaming and rapid polling paused.`);
                }
            } catch (err) {
                console.warn("[MarketDataEngine] Upstox market data notice:", err.message);
            }
        }

        // 2. Dhan Market Data Snapshot (REST / Live Positions)
        if (dhanToken && dhanClientId) {
            try {
                const dhanQuotes = await dhanMarketData.fetchQuotesRest(dhanClientId, dhanToken, instrumentKeys);
                for (const [key, q] of dhanQuotes.entries()) {
                    quoteCache.updateQuote(q);
                    this.notify(uId, key, q.lastPrice, q);
                    if (q.symbol) this.notify(uId, q.symbol, q.lastPrice, q);
                    if (q.securityId) this.notify(uId, `${q.exchange || "NSE"}_EQ|${q.securityId}`, q.lastPrice, q);
                }
            } catch (dErr) {
                console.warn("[MarketDataEngine] Dhan quotes snapshot notice:", dErr.message);
            }
        }

        // Check if market is closed before starting other broker feeds
        const session = getMarketSession("NSE", "EQUITY");
        if (!session.isOpen) {
            return;
        }

        // 3. Dhan Market Data Streaming / Polling (during active market hours)
        if (dhanToken && dhanClientId) {
            try {
                await dhanMarketData.start(
                    uId,
                    dhanClientId,
                    dhanToken,
                    instrumentKeys,
                    (tick) => {
                        const quoteObj = {
                            source: tick.source || "DHAN_TICKER",
                            lastPriceAt: tick.ltt ? Number(tick.ltt) : Date.now(),
                            sessionOpen: tick.open ? Number(tick.open) : undefined,
                            sessionHigh: tick.high ? Number(tick.high) : undefined,
                            sessionLow: tick.low ? Number(tick.low) : undefined,
                            previousClose: tick.close ? Number(tick.close) : undefined
                        };
                        if (tick?.instrumentKey && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.instrumentKey, Number(tick.ltp), quoteObj);
                        }
                        if (tick?.symbol && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.symbol, Number(tick.ltp), quoteObj);
                        }
                        if (tick?.securityId && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, `NSE_EQ|${tick.securityId}`, Number(tick.ltp), quoteObj);
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
                        const quoteObj = {
                            source: "ANGEL_ONE_WS",
                            lastPriceAt: tick.ltt ? Number(tick.ltt) : Date.now()
                        };
                        if (tick?.instrumentKey && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.instrumentKey, Number(tick.ltp), quoteObj);
                        }
                        if (tick?.symbol && quoteCache.isValidPrice(tick.ltp)) {
                            this.notify(uId, tick.symbol, Number(tick.ltp), quoteObj);
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

        if (this.pollers.has(uId)) {
            clearInterval(this.pollers.get(uId));
            this.pollers.delete(uId);
        }

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
