import DhanAdapter from "./DhanAdapter.js";
import quoteCache from "../../services/marketData/quoteCache.js";
import upstoxInstrumentService from "../../services/marketData/upstoxInstrumentService.js";

/**
 * DhanMarketDataService.js
 * Manages live market quotes and ticker feeds for Dhan instruments.
 * Supports:
 * 1. Dhan /marketfeed/ltp ticker API (when Data APIs are subscribed)
 * 2. Dhan live position PnL derivation fallback (when Data APIs are not subscribed / error 806)
 * 3. fetchQuotesRest snapshot method for immediate quote initialization
 */
class DhanMarketDataService {
    constructor() {
        this.streamers = new Map();     // userId -> active stream/polling object
        this.subscribers = new Map();   // userId -> Set of instrument keys
        this.hasDataApiMap = new Map(); // clientId -> boolean (whether 806 was received)
    }

    /**
     * Helper to extract numeric security IDs from keys.
     */
    buildPayload(keys) {
        const payload = { "NSE_EQ": [] };
        for (const k of keys) {
            const str = String(k || "").trim();
            const parts = str.split("|");
            if (parts.length >= 2) {
                const seg = parts[0];
                const id = parseInt(parts[1], 10);
                if (!isNaN(id)) {
                    if (!payload[seg]) payload[seg] = [];
                    payload[seg].push(id);
                }
            } else {
                const id = parseInt(str, 10);
                if (!isNaN(id)) {
                    payload["NSE_EQ"].push(id);
                }
            }
        }
        return payload;
    }

    /**
     * Fetch immediate official or broker position quotes snapshot from Dhan.
     * @param {string} clientId 
     * @param {string} accessToken 
     * @param {Array<string>} instrumentKeys 
     * @returns {Promise<Map<string, object>>}
     */
    async fetchQuotesRest(clientId, accessToken, instrumentKeys = []) {
        const quoteMap = new Map();
        if (!clientId || !accessToken) return quoteMap;

        const adapter = new DhanAdapter({ clientId, accessToken });
        const hasDataApi = this.hasDataApiMap.get(clientId) !== false;

        if (hasDataApi && Array.isArray(instrumentKeys) && instrumentKeys.length > 0) {
            const payload = this.buildPayload(instrumentKeys);
            const hasValidSecurities = Object.values(payload).some(arr => arr.length > 0);
            if (hasValidSecurities) {
                try {
                    const ltpData = await adapter.getLtp(payload);
                    if (ltpData && typeof ltpData === "object") {
                        for (const [seg, secMap] of Object.entries(ltpData)) {
                            if (secMap && typeof secMap === "object") {
                                for (const [secId, item] of Object.entries(secMap)) {
                                    const ltp = Number(item?.last_price || item?.ltp);
                                    if (quoteCache.isValidPrice(ltp)) {
                                        const key = `${seg}|${secId}`;
                                        const quoteObj = {
                                            instrumentKey: key,
                                            symbol: secId,
                                            exchange: seg.split("_")[0] || "NSE",
                                            segment: "EQUITY",
                                            lastPrice: ltp,
                                            source: "DHAN_TICKER",
                                            lastPriceAt: Date.now()
                                        };
                                        quoteMap.set(key, quoteObj);
                                        quoteMap.set(secId, quoteObj);
                                    }
                                }
                            }
                        }
                        if (quoteMap.size > 0) return quoteMap;
                    }
                } catch (err) {
                    if (err.status === 401 || err.data?.data?.["806"] || /806|Data APIs not Subscribed/i.test(err.message)) {
                        this.hasDataApiMap.set(clientId, false);
                    }
                }
            }
        }

        // Fallback: fetch Dhan live positions and derive LTP from unrealized PnL & cost price
        try {
            const positions = await adapter.getPositions();
            if (Array.isArray(positions)) {
                for (const pos of positions) {
                    const netQty = Number(pos.netQty || 0);
                    if (netQty === 0) continue;
                    const buyAvg = Number(pos.buyAvg || pos.costPrice || 0);
                    const sellAvg = Number(pos.sellAvg || 0);
                    const unrealizedPnL = Number(pos.unrealizedProfit || 0);

                    let ltp = 0;
                    const directLtp = Number(pos.lastPrice ?? pos.ltp ?? pos.closePrice ?? 0);
                    if (directLtp > 0) {
                        ltp = directLtp;
                    } else if (netQty > 0 && buyAvg > 0) {
                        ltp = buyAvg + (unrealizedPnL / netQty);
                    } else if (netQty < 0 && sellAvg > 0) {
                        ltp = sellAvg - (unrealizedPnL / Math.abs(netQty));
                    }

                    if (quoteCache.isValidPrice(ltp)) {
                        const roundedLtp = Math.round((ltp + Number.EPSILON) * 100) / 100;
                        const symbol = pos.tradingSymbol || (pos.securityId ? `SEC-${pos.securityId}` : "UNKNOWN");
                        const seg = pos.exchangeSegment || "NSE_EQ";
                        const secKey = pos.securityId ? `${seg}|${pos.securityId}` : symbol;
                        const quoteObj = {
                            instrumentKey: secKey,
                            symbol,
                            securityId: pos.securityId ? String(pos.securityId) : undefined,
                            exchange: seg.split("_")[0] || "NSE",
                            segment: "EQUITY",
                            lastPrice: roundedLtp,
                            source: "DHAN_POSITION",
                            lastPriceAt: Date.now()
                        };
                        quoteMap.set(secKey, quoteObj);
                        quoteMap.set(symbol, quoteObj);
                        if (pos.securityId) quoteMap.set(String(pos.securityId), quoteObj);
                    }
                }
            }
        } catch (posErr) {
            console.warn("[DhanMarketData] fetchQuotesRest position fallback notice:", posErr.message);
        }

        return quoteMap;
    }

    /**
     * Start market data streaming for a Dhan user
     * @param {string} userId - User identifier
     * @param {string} clientId - Dhan Client ID
     * @param {string} accessToken - Dhan access token
     * @param {Array<string>} instrumentKeys - List of symbols or security tokens
     * @param {Function} onMarketData - Callback invoked with price tick data
     */
    async start(userId, clientId, accessToken, instrumentKeys, onMarketData) {
        if (!userId) {
            throw new Error("userId is required");
        }

        if (!accessToken || !clientId) {
            throw new Error("Dhan clientId and access token are required");
        }

        if (!Array.isArray(instrumentKeys) || instrumentKeys.length === 0) {
            throw new Error("No instrument keys supplied");
        }

        // Stop existing stream for this user
        await this.stop(userId);

        const adapter = new DhanAdapter({
            clientId,
            accessToken
        });

        this.subscribers.set(userId, new Set(instrumentKeys));

        console.log(`[DhanMarketData] Initializing market data for user ${userId} (${instrumentKeys.length} instruments)`);

        const pollQuotes = async () => {
            try {
                const keys = Array.from(this.subscribers.get(userId) || []);
                if (keys.length === 0) return;

                const hasDataApi = this.hasDataApiMap.get(clientId) !== false;

                if (hasDataApi) {
                    const payload = this.buildPayload(keys);
                    const hasValidSecurities = Object.values(payload).some(arr => arr.length > 0);

                    if (hasValidSecurities) {
                        try {
                            const ltpData = await adapter.getLtp(payload);
                            if (ltpData && typeof ltpData === "object") {
                                for (const [seg, secMap] of Object.entries(ltpData)) {
                                    if (secMap && typeof secMap === "object") {
                                        for (const [secId, item] of Object.entries(secMap)) {
                                            const ltp = Number(item?.last_price || item?.ltp);
                                            if (quoteCache.isValidPrice(ltp)) {
                                                onMarketData({
                                                    broker: "DHAN",
                                                    instrumentKey: `${seg}|${secId}`,
                                                    symbol: secId,
                                                    ltp,
                                                    timestamp: new Date()
                                                });
                                            }
                                        }
                                    }
                                }
                                return;
                            }
                        } catch (err) {
                            if (err.status === 401 || err.data?.data?.["806"] || /806|Data APIs not Subscribed/i.test(err.message)) {
                                this.hasDataApiMap.set(clientId, false);
                                console.log("[DhanMarketData] Dhan Data APIs not subscribed (error 806). Using live position PnL tick derivation.");
                            }
                        }
                    }
                }

                // Fallback: poll Dhan live positions to derive live price ticks from Dhan's position updates
                try {
                    const positions = await adapter.getPositions();
                    if (Array.isArray(positions)) {
                        for (const pos of positions) {
                            const netQty = Number(pos.netQty || 0);
                            if (netQty === 0) continue;
                            const buyAvg = Number(pos.buyAvg || pos.costPrice || 0);
                            const sellAvg = Number(pos.sellAvg || 0);
                            const unrealizedPnL = Number(pos.unrealizedProfit || 0);

                            let ltp = 0;
                            const directLtp = Number(pos.lastPrice ?? pos.ltp ?? pos.closePrice ?? 0);
                            if (directLtp > 0) {
                                ltp = directLtp;
                            } else if (netQty > 0 && buyAvg > 0) {
                                ltp = buyAvg + (unrealizedPnL / netQty);
                            } else if (netQty < 0 && sellAvg > 0) {
                                ltp = sellAvg - (unrealizedPnL / Math.abs(netQty));
                            }

                            if (quoteCache.isValidPrice(ltp)) {
                                const roundedLtp = Math.round((ltp + Number.EPSILON) * 100) / 100;
                                const seg = pos.exchangeSegment || "NSE_EQ";
                                const secKey = pos.securityId ? `${seg}|${pos.securityId}` : pos.tradingSymbol;
                                onMarketData({
                                    broker: "DHAN",
                                    instrumentKey: secKey,
                                    symbol: pos.tradingSymbol,
                                    securityId: pos.securityId ? String(pos.securityId) : undefined,
                                    ltp: roundedLtp,
                                    timestamp: new Date(),
                                    source: "DHAN_POSITION"
                                });
                            }
                        }
                    }
                } catch {
                    // Ignore transient position poll error
                }
            } catch (err) {
                // Ignore transient network or off-market polling errors
            }
        };

        // Initial poll immediately
        await pollQuotes();

        // 3-second interval polling for Dhan quotes
        const intervalId = setInterval(pollQuotes, 3000);

        this.streamers.set(userId, {
            adapter,
            intervalId,
            disconnect: () => clearInterval(intervalId)
        });

        return {
            connected: true,
            instrumentKeys
        };
    }

    async stop(userId) {
        const stream = this.streamers.get(userId);
        if (stream) {
            try {
                if (typeof stream.disconnect === "function") {
                    stream.disconnect();
                }
            } catch (error) {
                console.error(`[DhanMarketData] Error stopping for ${userId}:`, error.message);
            }
            this.streamers.delete(userId);
        }
        this.subscribers.delete(userId);
    }
}

const dhanMarketData = new DhanMarketDataService();
export default dhanMarketData;

