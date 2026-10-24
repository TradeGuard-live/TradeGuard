import KotakNeoAdapter from "./KotakNeoAdapter.js";

/**
 * KotakNeoMarketDataService.js
 * Manages live market quotes and ticker feeds for Kotak Neo instruments.
 * Utilizes Kotak Neo Batch Quotes API (/script-details/1.0/quotes/neosymbol/<queries>/ltp)
 * for low-latency live price streaming.
 */
class KotakNeoMarketDataService {
    constructor() {
        this.streamers = new Map();     // userId -> { adapter, intervalId, disconnect }
        this.subscribers = new Map();   // userId -> Array of instrument keys / symbols
    }

    /**
     * Start market data polling/streaming for a Kotak Neo user
     * @param {string} userId - User identifier
     * @param {string} apiKey - Neo API Access Token
     * @param {string} accessToken - Trading Session Token
     * @param {Array<string|object>} instruments - List of symbols or { tradingsymbol, exchangeSegment }
     * @param {Function} onMarketData - Callback for tick data ({ broker, instrumentKey, symbol, ltp, timestamp })
     * @param {Object} [extraConfig] - Additional config (baseUrl, sid)
     */
    async start(userId, apiKey, accessToken, instruments, onMarketData, extraConfig = {}) {
        if (!userId) {
            throw new Error("userId is required");
        }

        if (!Array.isArray(instruments) || instruments.length === 0) {
            throw new Error("No instruments supplied");
        }

        // Stop existing stream for this user if already running
        await this.stop(userId);

        const adapter = new KotakNeoAdapter({
            apiKey,
            accessToken,
            sid: extraConfig.sid || "",
            baseUrl: extraConfig.baseUrl || "https://cis.kotaksecurities.com"
        });

        this.subscribers.set(userId, instruments);

        console.log(`[KotakNeoMarketData] Initializing market quotes for user ${userId} (${instruments.length} instruments)`);

        const pollQuotes = async () => {
            try {
                const items = this.subscribers.get(userId) || [];
                if (items.length === 0) return;

                // Build query array formatted as "<exchange_segment>|<instrument>"
                // Example: "nse_cm|ITBEES-EQ"
                const queries = [];
                const itemLookup = new Map(); // query -> { originalSymbol, instrumentKey }

                for (const item of items) {
                    let symbol = typeof item === "string" ? item : (item.symbol || item.tradingsymbol);
                    let es = typeof item === "object" ? (item.exchangeSegment || "nse_cm") : "nse_cm";

                    if (!symbol) continue;

                    // Clean symbol
                    let cleanSym = String(symbol).trim().toUpperCase();
                    if (cleanSym.includes(":")) {
                        const parts = cleanSym.split(":");
                        const ex = parts[0].toLowerCase();
                        es = ex === "bse" ? "bse_cm" : (ex === "nfo" ? "nse_fo" : "nse_cm");
                        cleanSym = parts[1];
                    }

                    // Format equity symbols if no -EQ suffix
                    let finalSymbol = cleanSym;
                    if (es.endsWith("_cm") && !finalSymbol.includes("-") && !finalSymbol.includes(" ")) {
                        finalSymbol = `${finalSymbol}-EQ`;
                    }

                    const queryKey = `${es}|${finalSymbol}`;
                    queries.push(queryKey);
                    itemLookup.set(queryKey, {
                        originalSymbol: cleanSym,
                        instrumentKey: typeof item === "object" ? (item.instrumentToken || symbol) : symbol
                    });
                }

                if (queries.length === 0) return;

                // Batch request quotes in slices of 20
                const batchSize = 20;
                for (let i = 0; i < queries.length; i += batchSize) {
                    const batch = queries.slice(i, i + batchSize);
                    try {
                        const quotes = await adapter.getQuotes(batch, "ltp");
                        const list = Array.isArray(quotes) ? quotes : (Array.isArray(quotes?.data) ? quotes.data : [quotes]);

                        for (const q of list) {
                            if (!q) continue;
                            const exchange = q.exchange || "nse_cm";
                            const symName = q.display_symbol || q.exchange_token || "";
                            const queryKey = `${exchange}|${symName}`;
                            const meta = itemLookup.get(queryKey) || { originalSymbol: symName, instrumentKey: symName };

                            const ltp = Number(q.ltp || 0);
                            if (ltp > 0) {
                                onMarketData({
                                    broker: "KOTAK_NEO",
                                    instrumentKey: meta.instrumentKey,
                                    symbol: meta.originalSymbol,
                                    ltp,
                                    timestamp: new Date()
                                });
                            }
                        }
                    } catch (batchErr) {
                        // ignore batch query errors
                    }
                }
            } catch (err) {
                // Ignore transient network/poll errors
            }
        };

        // Initial fetch
        pollQuotes();

        // Poll at 2-second interval
        const intervalId = setInterval(pollQuotes, 2000);

        this.streamers.set(userId, {
            adapter,
            intervalId,
            disconnect: () => clearInterval(intervalId)
        });

        return {
            connected: true,
            instruments
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
                console.error(`[KotakNeoMarketData] Error stopping for ${userId}:`, error.message);
            }
            this.streamers.delete(userId);
        }
        this.subscribers.delete(userId);
    }
}

const kotakNeoMarketData = new KotakNeoMarketDataService();
export default kotakNeoMarketData;
