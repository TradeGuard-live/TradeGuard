import AngelOneAdapter from "./AngelOneAdapter.js";

/**
 * AngelOneMarketDataService.js
 * Manages live market quotes and ticker feeds for Angel One instruments.
 */
class AngelOneMarketDataService {
    constructor() {
        this.streamers = new Map();     // userId -> active stream/polling object
        this.subscribers = new Map();   // userId -> Set of instrument objects / symbols
    }

    /**
     * Start market data streaming for an Angel One user
     * @param {string} userId - User identifier
     * @param {string} apiKey - SmartAPI API Key
     * @param {string} accessToken - Angel One JWT token
     * @param {Array<string|object>} instruments - List of symbols or { tradingsymbol, symboltoken, exchange }
     * @param {Function} onMarketData - Callback for tick data
     */
    async start(userId, apiKey, accessToken, instruments, onMarketData) {
        if (!userId) {
            throw new Error("userId is required");
        }

        if (!accessToken) {
            throw new Error("Angel One access token is required");
        }

        if (!Array.isArray(instruments) || instruments.length === 0) {
            throw new Error("No instruments supplied");
        }

        // Stop existing stream for this user
        await this.stop(userId);

        const adapter = new AngelOneAdapter({
            apiKey,
            accessToken
        });

        this.subscribers.set(userId, instruments);

        console.log(`[AngelOneMarketData] Initializing market data for user ${userId} (${instruments.length} instruments)`);

        const pollQuotes = async () => {
            try {
                const items = this.subscribers.get(userId) || [];
                if (items.length === 0) return;

                for (const item of items) {
                    let tradingsymbol = typeof item === "string" ? item : (item.tradingsymbol || item.symbol);
                    let symboltoken = typeof item === "object" ? (item.symboltoken || item.instrumentToken) : "";
                    let exchange = typeof item === "object" ? (item.exchange || "NSE") : "NSE";

                    // Strip any exchange prefix like "NSE:" or "NSE|"
                    if (tradingsymbol && tradingsymbol.includes(":")) {
                        const parts = tradingsymbol.split(":");
                        exchange = parts[0];
                        tradingsymbol = parts[1];
                    }

                    if (!symboltoken) {
                        // If no token is provided, we can skip or pass placeholder if available
                        continue;
                    }

                    try {
                        const res = await adapter.getLtp({
                            exchange,
                            tradingsymbol,
                            symboltoken
                        });

                        const ltp = Number(res?.data?.ltp || res?.ltp || 0);
                        if (ltp > 0) {
                            onMarketData({
                                broker: "ANGEL_ONE",
                                instrumentKey: symboltoken || tradingsymbol,
                                symbol: tradingsymbol,
                                ltp,
                                timestamp: new Date()
                            });
                        }
                    } catch (itemErr) {
                        // ignore individual quote error
                    }
                }
            } catch (err) {
                // Ignore transient errors
            }
        };

        // Initial poll
        pollQuotes();

        // Poll at 2-second intervals
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
                console.error(`[AngelOneMarketData] Error stopping for ${userId}:`, error.message);
            }
            this.streamers.delete(userId);
        }
        this.subscribers.delete(userId);
    }
}

const angelOneMarketData = new AngelOneMarketDataService();
export default angelOneMarketData;
