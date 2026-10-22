import DhanAdapter from "./DhanAdapter.js";

/**
 * DhanMarketDataService.js
 * Manages live market quotes and ticker feeds for Dhan instruments.
 */
class DhanMarketDataService {
    constructor() {
        this.streamers = new Map();     // userId -> active stream/polling object
        this.subscribers = new Map();   // userId -> Set of instrument keys
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

        // Prepare request payload for /marketfeed/ltp: { "NSE_EQ": [id1, id2] }
        const buildPayload = (keys) => {
            const payload = { "NSE_EQ": [] };
            for (const k of keys) {
                const parts = String(k).split("|");
                if (parts.length >= 2) {
                    const seg = parts[0];
                    const id = parseInt(parts[1], 10);
                    if (!isNaN(id)) {
                        if (!payload[seg]) payload[seg] = [];
                        payload[seg].push(id);
                    }
                }
            }
            return payload;
        };

        const pollQuotes = async () => {
            try {
                const keys = Array.from(this.subscribers.get(userId) || []);
                if (keys.length === 0) return;

                const payload = buildPayload(keys);
                const hasValidSecurities = Object.values(payload).some(arr => arr.length > 0);

                if (hasValidSecurities) {
                    const ltpData = await adapter.getLtp(payload);
                    if (ltpData && typeof ltpData === "object") {
                        for (const [seg, secMap] of Object.entries(ltpData)) {
                            if (secMap && typeof secMap === "object") {
                                for (const [secId, item] of Object.entries(secMap)) {
                                    const ltp = Number(item?.last_price || item?.ltp);
                                    if (ltp && !isNaN(ltp)) {
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
                    }
                }
            } catch (err) {
                // Ignore transient network or off-market polling errors
            }
        };

        // Initial poll
        pollQuotes();

        // 2-second interval polling for Dhan quotes
        const intervalId = setInterval(pollQuotes, 2000);

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
