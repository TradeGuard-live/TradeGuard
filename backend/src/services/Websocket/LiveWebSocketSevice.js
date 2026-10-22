/**
 * LiveWebSocketService.js
 * 
 * Orchestrates:
 * - Position Engine (Trade matching, Open quantity, Partial square, Fully squared)
 * - Market Data Engine (Live prices via Upstox / real-time feed)
 * - P&L Engine (Live P&L, Gross P&L, Net P&L, Breakeven, 8 combined charges, Risk Amount, R:R)
 * - Real-time WebSocket streaming to React UI at /ws/live
 */

import { WebSocketServer, WebSocket } from "ws";
import mongoose from "mongoose";
import TradeRecord from "../../models/TradeRecord.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import positionEngine from "../position/PositionEngine.js";
import pnlEngine from "../pnl/PnLEngine.js";
import marketDataEngine from "../marketData/MarketDataEngine.js";
import UpstoxAdapter from "../../brokers/upstox/UpstoxAdaptor.js";
import DhanAdapter from "../../brokers/dhan/DhanAdapter.js";
import { mapDhanPosition } from "../../brokers/dhan/DhanMapper.js";
import AngelOneAdapter from "../../brokers/angelOne/AngelOneAdapter.js";
import { mapAngelOnePosition } from "../../brokers/angelOne/AngelOneMapper.js";
import { decrypt } from "../../utils/encryption.js";

class LiveWebSocketService {
    constructor() {
        this.clients = new Map(); // userId -> Set of WebSockets
        this.userInitialized = new Set();

        // Listen for price updates from Market Data Engine
        marketDataEngine.onPriceUpdate((userId, instrumentKey, ltp) => {
            this.handlePriceUpdate(userId, instrumentKey, ltp);
        });
    }

    initialize(server) {
        this.wss = new WebSocketServer({
            server,
            path: "/ws/live"
        });

        this.wss.on("connection", (ws) => {
            console.log("[LiveWS] Client connected to live WebSocket");
            ws.userId = null;
            ws.isAlive = true;

            ws.on("pong", () => {
                ws.isAlive = true;
            });

            ws.on("message", async (message) => {
                try {
                    const data = JSON.parse(message.toString());

                    if (data.type === "AUTH") {
                        await this.handleAuth(ws, data.userId);
                    } else if (data.type === "UPDATE_SL_TARGET") {
                        this.handleUpdateSLTarget(ws.userId, data.symbol, data.stopLoss, data.target);
                    } else if (data.type === "SYNC_TRADES") {
                        await this.refreshUserPositions(ws.userId);
                    } else if (data.type === "PING") {
                        ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
                    }
                } catch (error) {
                    console.error("[LiveWS] Message parse error:", error.message);
                }
            });

            ws.on("close", () => {
                if (!ws.userId) return;
                const userClients = this.clients.get(ws.userId);
                if (userClients) {
                    userClients.delete(ws);
                    if (userClients.size === 0) {
                        this.clients.delete(ws.userId);
                        marketDataEngine.stop(ws.userId);
                        this.userInitialized.delete(ws.userId);
                        console.log(`[LiveWS] All connections closed for user ${ws.userId}. Stopped stream.`);
                    }
                }
            });
        });

        // Heartbeat interval to detect stale connections
        setInterval(() => {
            for (const [userId, clientSet] of this.clients.entries()) {
                for (const ws of clientSet) {
                    if (!ws.isAlive) {
                        ws.terminate();
                        clientSet.delete(ws);
                    } else {
                        ws.isAlive = false;
                        ws.ping();
                    }
                }
            }
        }, 30000);
    }

    /**
     * Handle client authentication and initialize trading engines for the user
     */
    async handleAuth(ws, userId) {
        if (!userId) {
            ws.send(JSON.stringify({ type: "ERROR", message: "userId is required for AUTH" }));
            return;
        }

        const uId = String(userId);
        ws.userId = uId;

        if (!this.clients.has(uId)) {
            this.clients.set(uId, new Set());
        }
        this.clients.get(uId).add(ws);

        ws.send(JSON.stringify({
            type: "AUTH_SUCCESS",
            userId: uId,
            message: "Connected to TradeGuard Live Market Stream"
        }));

        // Load positions & start engine for user
        await this.refreshUserPositions(uId);
    }

    /**
     * Loads trades, computes positions via PositionEngine, and starts MarketDataEngine + PnLEngine
     */
    async refreshUserPositions(userId) {
        if (!userId) return;
        const uId = String(userId);

        try {
            // 1. Fetch trades from DB
            let query = {};
            if (mongoose.Types.ObjectId.isValid(uId)) {
                query = { userId: new mongoose.Types.ObjectId(uId) };
            }

            let trades = await TradeRecord.find(query).lean();

            // If user has no trades yet, look for any trades in DB as demo/preview data
            if (!trades || trades.length === 0) {
                trades = await TradeRecord.find({}).limit(50).lean();
            }

            // 2. Check for active Upstox account to get broker positions & token
            let brokerPositions = [];
            const brokerAuth = {};

            try {
                let accountQuery = { isActive: true };
                if (mongoose.Types.ObjectId.isValid(uId)) {
                    accountQuery.userId = new mongoose.Types.ObjectId(uId);
                }
                const accounts = await BrokerAccount.find(accountQuery);

                for (const acc of accounts) {
                    if (acc.broker === "UPSTOX" && acc.credentials?.accessToken) {
                        const token = decrypt(acc.credentials.accessToken);
                        if (token) {
                            brokerAuth.upstoxToken = token;
                            const upstox = new UpstoxAdapter(token);
                            try {
                                const upstoxPos = await upstox.getPositions();
                                if (Array.isArray(upstoxPos)) brokerPositions.push(...upstoxPos);
                            } catch (e) {
                                // Token might be expired or market closed, ignore
                            }
                        }
                    } else if (acc.broker === "DHAN" && acc.credentials?.accessToken) {
                        const token = decrypt(acc.credentials.accessToken);
                        const clientId = acc.credentials?.clientId;
                        if (token && clientId) {
                            brokerAuth.dhanToken = token;
                            brokerAuth.dhanClientId = clientId;
                            const dhan = new DhanAdapter({ clientId, accessToken: token });
                            try {
                                const dhanPos = await dhan.getPositions();
                                if (Array.isArray(dhanPos)) {
                                    const mapped = dhanPos.map(mapDhanPosition).filter(Boolean);
                                    brokerPositions.push(...mapped);
                                }
                            } catch (e) {
                                // Token might be expired or market closed, ignore
                            }
                        }
                    } else if (acc.broker === "ANGEL_ONE") {
                        const token = acc.credentials?.accessToken ? decrypt(acc.credentials.accessToken) : "";
                        const apiKey = acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey) : "";
                        const clientCode = acc.credentials?.clientId || "";
                        const password = acc.credentials?.password ? decrypt(acc.credentials.password) : (acc.credentials?.apiSecret ? decrypt(acc.credentials.apiSecret) : "");
                        const totpSecret = acc.credentials?.totpSecret ? decrypt(acc.credentials.totpSecret) : "";
                        
                        if (token || (clientCode && password)) {
                            brokerAuth.angelToken = token;
                            brokerAuth.angelApiKey = apiKey;
                            const angel = new AngelOneAdapter({
                                apiKey,
                                clientCode,
                                password,
                                totpSecret,
                                accessToken: token
                            });
                            try {
                                const angelPos = await angel.getPositions();
                                if (Array.isArray(angelPos)) {
                                    const mapped = angelPos.map(mapAngelOnePosition).filter(Boolean);
                                    brokerPositions.push(...mapped);
                                }
                            } catch (e) {
                                // Token might be expired or market closed, ignore
                            }
                        }
                    }
                }
            } catch (err) {
                // Ignore broker account lookup failure
            }

            // 3. Run Position Engine
            const allMatchedPositions = positionEngine.processTrades(trades);
            let openPositions = positionEngine.getOpenPositions(trades);

            // Reconcile with broker positions if available
            if (brokerPositions && brokerPositions.length > 0) {
                openPositions = positionEngine.reconcileWithBrokerPositions(openPositions, brokerPositions);
            }

            // If there are still no open positions (e.g. all squared or empty DB), provide a starter position
            if (openPositions.length === 0 && trades.length === 0) {
                openPositions = [
                    {
                        key: "DEMO|NSE|EQUITY|RELIANCE|INTRADAY",
                        symbol: "RELIANCE",
                        exchange: "NSE",
                        segment: "EQUITY",
                        productType: "INTRADAY",
                        instrumentToken: "NSE_EQ|INE002A01018",
                        openQuantity: 25,
                        netQuantity: 25,
                        averagePrice: 2950.00,
                        realizedPnL: 1250.00,
                        status: "OPEN",
                        side: "BUY"
                    },
                    {
                        key: "DEMO|NSE|EQUITY|TCS|INTRADAY",
                        symbol: "TCS",
                        exchange: "NSE",
                        segment: "EQUITY",
                        productType: "INTRADAY",
                        instrumentToken: "NSE_EQ|INE467B01029",
                        openQuantity: 15,
                        netQuantity: 15,
                        averagePrice: 4120.00,
                        realizedPnL: 640.00,
                        status: "PARTIALLY_SQUARED",
                        side: "BUY"
                    }
                ];
            }

            // 4. Set positions in P&L Engine
            pnlEngine.setPositions(uId, openPositions);

            // 5. Start Market Data Engine for open positions
            await marketDataEngine.start(uId, openPositions, brokerAuth);

            // 6. Broadcast initial calculation snapshot
            const initialSnapshot = pnlEngine.calculate(uId);
            this.broadcast(uId, {
                type: "INITIAL_DATA",
                data: {
                    ...initialSnapshot,
                    allPositions: allMatchedPositions,
                    squaredPositions: positionEngine.getFullySquaredPositions(trades)
                }
            });

        } catch (error) {
            console.error(`[LiveWS] Error refreshing positions for user ${uId}:`, error);
        }
    }

    /**
     * Handle incoming price tick and broadcast live P&L update
     */
    handlePriceUpdate(userId, instrumentKey, ltp) {
        if (!userId) return;
        const uId = String(userId);

        const updatedData = pnlEngine.updatePrice(uId, instrumentKey, ltp);
        if (updatedData) {
            this.broadcast(uId, {
                type: "LIVE_PNL_UPDATE",
                data: updatedData
            });
        }
    }

    /**
     * Handle Stop Loss and Target updates from React UI
     */
    handleUpdateSLTarget(userId, symbol, stopLoss, target) {
        if (!userId || !symbol) return;
        const uId = String(userId);

        pnlEngine.updateRiskSettings(uId, symbol, { stopLoss, target });
        const updatedData = pnlEngine.calculate(uId);

        this.broadcast(uId, {
            type: "LIVE_PNL_UPDATE",
            data: updatedData
        });
    }

    /**
     * Broadcast payload to all open sockets for a user
     */
    broadcast(userId, data) {
        const uId = String(userId);
        const userClients = this.clients.get(uId);
        if (!userClients || userClients.size === 0) return;

        const message = JSON.stringify(data);
        for (const client of userClients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}

const liveWebSocketService = new LiveWebSocketService();
export default liveWebSocketService;