const UpstoxClient = require("upstox-js-sdk");

class UpstoxMarketDataService {
    constructor() {
        this.streamers = new Map();
    }

    async start(userId, accessToken, instrumentKeys, onMarketData) {
        if (!userId) {
            throw new Error("userId is required");
        }

        if (!accessToken) {
            throw new Error("Upstox access token is required");
        }

        if (!Array.isArray(instrumentKeys) || instrumentKeys.length === 0) {
            throw new Error("No instrument keys supplied");
        }

        // Stop existing stream for this user
        await this.stop(userId);

        /*
         * Create a separate API client for this user.
         */
        const apiClient = new UpstoxClient.ApiClient();

        apiClient.authentications["OAUTH2"].accessToken = accessToken;

        /*
         * LTPC is enough for live P&L.
         *
         * We don't need full market depth just to calculate P&L.
         */
        const streamer = new UpstoxClient.MarketDataStreamerV3(
            apiClient,
            instrumentKeys,
            "ltpc"
        );

        streamer.autoReconnect(true, 5, 10);

        streamer.on("open", () => {
            console.log(
                `[MarketData] Connected for user ${userId}`
            );

            console.log(
                `[MarketData] Subscribing to ${instrumentKeys.length} instruments`
            );

            streamer.subscribe(instrumentKeys, "ltpc");
        });

        streamer.on("message", (data) => {
            try {
                onMarketData(data);
            } catch (error) {
                console.error(
                    `[MarketData] Message processing error for ${userId}:`,
                    error
                );
            }
        });

        streamer.on("error", (error) => {
            console.error(
                `[MarketData] Error for user ${userId}:`,
                error
            );
        });

        streamer.on("close", () => {
            console.log(
                `[MarketData] Connection closed for user ${userId}`
            );
        });

        streamer.on("reconnecting", () => {
            console.log(
                `[MarketData] Reconnecting for user ${userId}`
            );
        });

        this.streamers.set(userId, streamer);

        streamer.connect();

        return {
            connected: true,
            instrumentKeys
        };
    }

    async stop(userId) {
        const streamer = this.streamers.get(userId);

        if (!streamer) {
            return;
        }

        try {
            streamer.disconnect();
        } catch (error) {
            console.error(
                `[MarketData] Error disconnecting ${userId}:`,
                error
            );
        }

        this.streamers.delete(userId);
    }

    async subscribe(userId, instrumentKeys) {
        const streamer = this.streamers.get(userId);

        if (!streamer) {
            throw new Error(
                `No market data connection for user ${userId}`
            );
        }

        streamer.subscribe(instrumentKeys, "ltpc");
    }

    async unsubscribe(userId, instrumentKeys) {
        const streamer = this.streamers.get(userId);

        if (!streamer) {
            return;
        }

        streamer.unsubscribe(instrumentKeys);
    }
}

module.exports = new UpstoxMarketDataService();