/**
 * UpstoxMarketDataService.js
 * 
 * ✅ Professional Upstox Market Data Feeder & REST Quote Client
 * - ES Module compliant
 * - Correct Upstox MarketDataStreamerV3 instantiation using ApiClient.instance singleton
 * - Real-time decoded protobuf stream ingestion with timestamp validation
 * - REST snapshot client for live LTP, OHLC, and official closing prices
 * - Bounded auto-reconnect without retry storms
 */

import UpstoxClient from "upstox-js-sdk";
import axios from "axios";
import { createRequire } from "module";
import BrokerAccount from "../../models/BrokerAccount.js";
import quoteCache from "../../services/marketData/quoteCache.js";
import upstoxInstrumentService from "../../services/marketData/upstoxInstrumentService.js";
import { getMarketSession } from "../../services/marketData/marketSessionService.js";

// ✅ Fix Upstox SDK bug: Streamer.js calls this.streamer.clearSubscriptions() on autoReconnect stop,
// but MarketDataFeederV3 lacks clearSubscriptions, resulting in an unhandled TypeError crash.
try {
    const require = createRequire(import.meta.url);
    const { MarketDataFeederV3 } = require("upstox-js-sdk/dist/feeder/MarketDataFeederV3");
    if (MarketDataFeederV3 && typeof MarketDataFeederV3.prototype.clearSubscriptions !== "function") {
        MarketDataFeederV3.prototype.clearSubscriptions = function() {
            this.instrumentKeys = [];
        };
    }
} catch (e) {
    // ignore
}

class UpstoxMarketDataService {
    constructor() {
        this.streamers = new Map(); // userId -> MarketDataStreamerV3 instance
        this.restClient = axios.create({
            baseURL: "https://api.upstox.com/v2",
            timeout: 10000
        });
    }

    /**
     * Fetch immediate live market quotes from Upstox REST API
     * @param {string} accessToken 
     * @param {Array<string>} instrumentKeys 
     * @returns {Promise<Map<string, object>>} Map of instrumentKey -> quote record
     */
    async fetchQuotesRest(accessToken, instrumentKeys = []) {
        if (!accessToken || !Array.isArray(instrumentKeys) || instrumentKeys.length === 0) {
            return new Map();
        }

        try {
            // Upstox expects comma-separated instrument keys
            // e.g. "NSE_EQ|INE002A01018,NSE_EQ|INE467B01029"
            const symbolsParam = instrumentKeys
                .map(k => upstoxInstrumentService.normalizeInstrumentKey(k))
                .filter(Boolean)
                .join(",");

            if (!symbolsParam) return new Map();

            let response;
            try {
                response = await this.restClient.get("/market-quote/quotes", {
                    params: { instrument_key: symbolsParam },
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${accessToken}`,
                        "Api-Version": "2.0"
                    }
                });
            } catch (err) {
                const is401 = err.response?.status === 401 || /401|unauthorized|invalid.*token/i.test(err.message);
                if (is401) {
                    const authErr = new Error("Upstox REST API 401 Unauthorized: Invalid or expired access token");
                    authErr.status = 401;
                    throw authErr;
                }
                // Fallback to /market-quote/ltp
                try {
                    response = await this.restClient.get("/market-quote/ltp", {
                        params: { instrument_key: symbolsParam },
                        headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${accessToken}`,
                            "Api-Version": "2.0"
                        }
                    });
                } catch (ltpErr) {
                    const isLtp401 = ltpErr.response?.status === 401 || /401|unauthorized|invalid.*token/i.test(ltpErr.message);
                    if (isLtp401) {
                        const authErr = new Error("Upstox REST API 401 Unauthorized: Invalid or expired access token");
                        authErr.status = 401;
                        throw authErr;
                    }
                    console.warn("[UpstoxMarketData] REST quotes & LTP fetch notice:", ltpErr.response?.data?.message || ltpErr.message);
                    return new Map();
                }
            }

            const quoteMap = new Map();
            const data = response?.data?.data;

            if (data && typeof data === "object") {
                for (const [key, quote] of Object.entries(data)) {
                    // Normalize key
                    const normalizedKey = upstoxInstrumentService.normalizeInstrumentKey(key);
                    const ltp = Number(quote.last_price);

                    if (quoteCache.isValidPrice(ltp)) {
                        const previousClose = Number(quote.ohlc?.close ?? quote.close ?? quote.net_change ?? 0);
                        const open = Number(quote.ohlc?.open ?? 0);
                        const high = Number(quote.ohlc?.high ?? 0);
                        const low = Number(quote.ohlc?.low ?? 0);
                        const timestamp = quote.timestamp ? new Date(quote.timestamp).getTime() : Date.now();

                        const exchange = normalizedKey.startsWith("BSE") ? "BSE" : "NSE";
                        const segment = normalizedKey.includes("_FO") ? "FUTURES" : "EQUITY";
                        const symbol = quote.symbol || normalizedKey.split("|")[1] || key;

                        const updatedQuote = quoteCache.updateQuote({
                            instrumentKey: normalizedKey,
                            symbol,
                            exchange,
                            segment,
                            lastPrice: ltp,
                            previousClose: quoteCache.isValidPrice(previousClose) ? previousClose : null,
                            sessionOpen: open,
                            sessionHigh: high,
                            sessionLow: low,
                            lastPriceAt: timestamp,
                            source: "UPSTOX_REST"
                        });

                        if (updatedQuote) {
                            quoteMap.set(normalizedKey, updatedQuote);
                            quoteMap.set(key, updatedQuote);
                            if (symbol) quoteMap.set(symbol, updatedQuote);
                        }
                    }
                }
            }

            return quoteMap;
        } catch (error) {
            console.warn("[UpstoxMarketData] REST quotes fetch notice:", error.response?.data?.message || error.message);
            return new Map();
        }
    }

    /**
     * Start Upstox WebSocket market data streaming
     * @param {string} userId
     * @param {string} accessToken
     * @param {Array<string>} instrumentKeys
     * @param {function} onMarketData - Callback: (instrumentKey, ltp, quoteObj) => void
     */
    async start(userId, accessToken, instrumentKeys = [], onMarketData = null) {
        if (!userId) throw new Error("userId is required");
        if (!accessToken) throw new Error("Upstox access token is required");
        if (!Array.isArray(instrumentKeys) || instrumentKeys.length === 0) return null;

        const uId = String(userId);
        await this.stop(uId);

        // First, fetch snapshot quotes via REST API
        try {
            await this.fetchQuotesRest(accessToken, instrumentKeys);
        } catch (restErr) {
            if (restErr.status === 401 || /401|unauthorized/i.test(restErr.message)) {
                console.warn(`[UpstoxMarketData] Upstox token unauthorized (401) for user ${uId}. WebSocket connection aborted.`);
                BrokerAccount.updateMany(
                    { userId: uId, broker: "UPSTOX" },
                    { $set: { isConnected: false, verificationError: "Upstox token unauthorized or expired (401)" } }
                ).catch(() => {});
                return { connected: false, error: "401 Unauthorized" };
            }
        }

        // Ensure session allows streaming (no pointless connection when exchange is closed)
        const session = getMarketSession("NSE", "EQUITY");
        if (!session.isOpen) {
            console.log(`[UpstoxMarketData] Market is closed (${session.message || session.session}). Skipping live WebSocket feed; closing quotes preserved via REST.`);
            return {
                connected: false,
                marketClosed: true,
                session
            };
        }

        try {
            // ✅ Configure singleton ApiClient instance required by upstox-js-sdk
            UpstoxClient.ApiClient.instance.authentications["OAUTH2"].accessToken = accessToken;

            const normalizedKeys = instrumentKeys
                .map(k => upstoxInstrumentService.normalizeInstrumentKey(k))
                .filter(Boolean);

            // ✅ Correct MarketDataStreamerV3 constructor signature: (instrumentKeys, mode)
            const streamer = new UpstoxClient.MarketDataStreamerV3(
                normalizedKeys,
                "ltpc"
            );

            // Auto-reconnect with bounded retries (up to 5 attempts, 5s interval)
            streamer.autoReconnect(true, 5, 5);

            streamer.on("open", () => {
                console.log(`[UpstoxMarketData] ✅ WebSocket connected for user ${uId} (${normalizedKeys.length} instruments)`);
                try {
                    streamer.subscribe(normalizedKeys, "ltpc");
                } catch (subErr) {
                    console.warn(`[UpstoxMarketData] Subscribe notice:`, subErr.message);
                }
            });

            streamer.on("message", (data) => {
                try {
                    const parsed = typeof data === "string" ? JSON.parse(data) : data;
                    if (parsed?.feeds && typeof parsed.feeds === "object") {
                        for (const [key, feed] of Object.entries(parsed.feeds)) {
                            const normalizedKey = upstoxInstrumentService.normalizeInstrumentKey(key);
                            const ltp = feed?.ltpc?.ltp ?? feed?.ff?.marketFF?.ltpc?.ltp;
                            const ltt = feed?.ltpc?.ltt ?? feed?.ff?.marketFF?.ltpc?.ltt; // Last Trade Time (ms)
                            const close = feed?.ltpc?.cp ?? feed?.ff?.marketFF?.ltpc?.cp; // Close price

                            if (quoteCache.isValidPrice(ltp)) {
                                const exchange = normalizedKey.startsWith("BSE") ? "BSE" : "NSE";
                                const segment = normalizedKey.includes("_FO") ? "FUTURES" : "EQUITY";

                                const updatedQuote = quoteCache.updateQuote({
                                    instrumentKey: normalizedKey,
                                    exchange,
                                    segment,
                                    lastPrice: Number(ltp),
                                    previousClose: close ? Number(close) : undefined,
                                    lastPriceAt: ltt ? Number(ltt) : Date.now(),
                                    source: "UPSTOX_WS"
                                });

                                if (updatedQuote && typeof onMarketData === "function") {
                                    onMarketData(normalizedKey, Number(ltp), updatedQuote);
                                    if (key && key !== normalizedKey) {
                                        onMarketData(key, Number(ltp), updatedQuote);
                                    }
                                    const sym = updatedQuote.symbol || normalizedKey.split("|")[1];
                                    if (sym) {
                                        onMarketData(sym, Number(ltp), updatedQuote);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Ignore parse error
                }
            });

            streamer.on("error", (err) => {
                const msg = err?.message || String(err);
                const is401 = msg.includes("401") || /unauthorized|invalid.*token/i.test(msg);

                // ✅ Critical Fix: Terminate immediately on 401 Unauthorized to stop reconnect retry loops!
                if (is401) {
                    console.warn(`[UpstoxMarketData] Stream authentication failed (401 Unauthorized) for user ${uId}: ${msg}. Terminating streamer and cancelling auto-reconnect.`);
                    try {
                        if (typeof streamer.autoReconnect === "function") {
                            streamer.autoReconnect(false);
                        }
                    } catch (e) {}
                    try {
                        streamer.disconnect();
                    } catch (e) {}
                    this.streamers.delete(uId);

                    // Mark Upstox account disconnected in DB
                    BrokerAccount.updateMany(
                        { userId: uId, broker: "UPSTOX" },
                        { $set: { isConnected: false, verificationError: "Upstox WebSocket returned 401 Unauthorized" } }
                    ).catch(() => {});
                    return;
                }

                const currentSession = getMarketSession("NSE", "EQUITY");
                if (!currentSession.isOpen) {
                    try {
                        if (typeof streamer.autoReconnect === "function") {
                            streamer.autoReconnect(false);
                        }
                    } catch (e) {}
                    try {
                        streamer.disconnect();
                    } catch (e) {}
                    this.streamers.delete(uId);
                    return;
                }
                if (msg.includes("socket hang up") || msg.includes("EHOSTUNREACH")) {
                    console.warn(`[UpstoxMarketData] Connection notice for ${uId}: ${msg}`);
                } else {
                    console.warn(`[UpstoxMarketData] Stream notice for ${uId}:`, msg);
                }
            });

            streamer.on("close", () => {
                if (!this.streamers.has(uId)) {
                    // Already closed/cleaned up
                    return;
                }
                const currentSession = getMarketSession("NSE", "EQUITY");
                if (!currentSession.isOpen) {
                    console.log(`[UpstoxMarketData] Market closed (${currentSession.session}). Stopping auto-reconnect for ${uId}.`);
                    try {
                        if (typeof streamer.autoReconnect === "function") {
                            streamer.autoReconnect(false);
                        }
                    } catch (e) {}
                    try {
                        streamer.disconnect();
                    } catch (e) {}
                    this.streamers.delete(uId);
                    return;
                }
                console.log(`[UpstoxMarketData] Stream closed for ${uId}`);
            });

            streamer.on("autoReconnectStopped", (reason) => {
                console.log(`[UpstoxMarketData] Auto reconnect stopped for ${uId}:`, reason);
            });

            this.streamers.set(uId, streamer);
            streamer.connect();

            return {
                connected: true,
                instrumentKeys: normalizedKeys
            };
        } catch (err) {
            console.warn(`[UpstoxMarketData] Could not start streamer:`, err.message);
            return null;
        }
    }

    /**
     * Stop streaming for a user
     */
    async stop(userId) {
        if (!userId) return;
        const uId = String(userId);
        const streamer = this.streamers.get(uId);
        if (streamer) {
            try {
                if (typeof streamer.autoReconnect === "function") {
                    streamer.autoReconnect(false);
                }
            } catch (e) {
                // ignore
            }
            try {
                streamer.disconnect();
            } catch (e) {
                // ignore
            }
            this.streamers.delete(uId);
        }
    }
}

const upstoxMarketDataService = new UpstoxMarketDataService();
export default upstoxMarketDataService;