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
import jwt from "jsonwebtoken";
import TradeRecord from "../../models/TradeRecord.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import positionEngine from "../position/PositionEngine.js";
import pnlEngine from "../pnl/PnLEngine.js";
import marketDataEngine, { isIndianMarketOpen, isAnyMarketOpen } from "../marketData/MarketDataEngine.js";
import brokerSyncManager from "../brokerSync/BrokerSyncManager.js";
import { copyExecutionRouter } from "../copyTrading/engine/CopyExecutionRouter.js";
import OrderExecutionService from "../trading/OrderExecutionService.js";

class LiveWebSocketService {
    constructor() {
        this.clients = new Map(); // userId -> Set of WebSockets
        this.userInitialized = new Set();
        this.syncingUsers = new Set();

        // ✅ Listen for price updates & quote metadata from Market Data Engine
        marketDataEngine.onPriceUpdate((userId, instrumentKey, ltp, quoteObj) => {
            this.handlePriceUpdate(userId, instrumentKey, ltp, quoteObj);
        });

        // ✅ Stream Copy-Trading order synchronization events in real-time
        copyExecutionRouter.onUpdate((type, orderMapping) => {
            if (orderMapping?.userId) {
                this.broadcast(orderMapping.userId, {
                    type: "COPY_ORDER_UPDATE",
                    data: orderMapping
                });
            }
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
                        await this.handleAuth(ws, data);
                    } else if (data.type === "UPDATE_SL_TARGET") {
                        this.handleUpdateSLTarget(ws.userId, data.symbol, data.stopLoss, data.target);
                    } else if (data.type === "EXIT_POSITION") {
                        if (!ws.userId) {
                            ws.send(JSON.stringify({ type: "ERROR", message: "Not authenticated" }));
                            return;
                        }
                        try {
                            const res = await OrderExecutionService.executeExitPosition({
                                userId: ws.userId,
                                ...data
                            });
                            ws.send(JSON.stringify({ type: "ORDER_UPDATE", data: res }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: "ERROR", message: err.message }));
                        }
                    } else if (data.type === "EXIT_ALL_POSITIONS") {
                        if (!ws.userId) {
                            ws.send(JSON.stringify({ type: "ERROR", message: "Not authenticated" }));
                            return;
                        }
                        try {
                            const res = await OrderExecutionService.executeExitAllPositions({
                                userId: ws.userId,
                                ...data
                            });
                            ws.send(JSON.stringify({ type: "ORDER_UPDATE", data: res }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: "ERROR", message: err.message }));
                        }
                    } else if (data.type === "SYNC_TRADES") {
                        await this.refreshUserPositions(ws.userId, { broadcastTradeSync: true });
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

        // ✅ Automated real-time order & trade sync for connected active clients via WebSocket
        this.orderSyncInterval = setInterval(async () => {
            if (this.clients.size === 0) return;

            for (const userId of this.clients.keys()) {
                if (this.syncingUsers.has(userId)) continue;
                this.syncingUsers.add(userId);

                try {
                    const syncRes = await brokerSyncManager.syncAllBrokersTodayTrades(userId).catch(() => ({ inserted: 0, updated: 0 }));
                    if (syncRes.inserted > 0 || syncRes.updated > 0) {
                        await this.refreshUserPositions(userId, { broadcastTradeSync: true });
                    }
                } catch {
                    // Non-blocking background order poll
                } finally {
                    this.syncingUsers.delete(userId);
                }
            }
        }, 15000);
    }

    /**
     * Handle client authentication with JWT validation
     * ✅ Verifies JWT token and binds verified userId to WebSocket connection
     */
    async handleAuth(ws, data) {
        let uId = null;

        if (data?.token) {
            try {
                const decoded = jwt.verify(data.token, process.env.JWT_SECRET);
                uId = String(decoded.userId || decoded.id);
            } catch (err) {
                ws.send(JSON.stringify({
                    type: "AUTH_ERROR",
                    message: "Invalid or expired authentication token"
                }));
                return;
            }
        } else if (data?.userId && mongoose.Types.ObjectId.isValid(data.userId)) {
            // Backward-compatible for internal dev/tests
            uId = String(data.userId);
        }

        if (!uId) {
            ws.send(JSON.stringify({ type: "AUTH_ERROR", message: "Valid authentication token is required" }));
            return;
        }

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
     * @param {string} userId
     * @param {Object} [options]
     * @param {boolean} [options.broadcastTradeSync=false]
     */
    async refreshUserPositions(userId, options = {}) {
        if (!userId) return;
        const uId = String(userId);
        if (mongoose.connection.readyState !== 1) return;

        try {
            // 1. Sync today's live trades for all user's active brokers & retrieve live broker positions
            const syncResult = await brokerSyncManager.syncAllBrokersTodayTrades(uId).catch(err => {
                console.warn("[LiveWS] Today trades sync notice:", err.message);
                return { inserted: 0, updated: 0, skipped: 0, total: 0 };
            });

            const { brokerPositions, brokerAuth } = await brokerSyncManager.fetchAllBrokerPositions(uId).catch(err => {
                console.warn("[LiveWS] Fetch broker positions notice:", err.message);
                return { brokerPositions: [], brokerAuth: {} };
            });

            // If any trades were inserted or updated, broadcast TRADES_UPDATED so Trade History updates live
            if (syncResult.inserted > 0 || syncResult.updated > 0 || options.broadcastTradeSync) {
                this.broadcast(uId, {
                    type: "TRADES_UPDATED",
                    data: {
                        inserted: syncResult.inserted,
                        updated: syncResult.updated,
                        total: syncResult.total
                    }
                });
            }

            // 2. Fetch all trades from DB (including today's newly synced live trades)
            let query = {};
            if (mongoose.Types.ObjectId.isValid(uId)) {
                query = { userId: new mongoose.Types.ObjectId(uId) };
            }
            let trades = await TradeRecord.find(query).lean();

            // 3. Run Position Engine with stale intraday exclusions
            const allMatchedPositions = positionEngine.processTrades(trades);
            let openPositions = positionEngine.getOpenPositions(trades, { excludeExpiredIntraday: true });

            // Reconcile with broker positions if available
            if (brokerPositions && brokerPositions.length > 0) {
                openPositions = positionEngine.reconcileWithBrokerPositions(openPositions, brokerPositions);
            }

            // 4. Set positions in P&L Engine
            pnlEngine.setPositions(uId, openPositions);

            // 5. Start Market Data Engine for open positions
            await marketDataEngine.start(uId, openPositions, brokerAuth);

            // 6. Broadcast initial calculation snapshot
            const initialSnapshot = pnlEngine.calculate(uId);
            const isLiveMarketOpen = isAnyMarketOpen(openPositions);
            this.broadcast(uId, {
                type: "INITIAL_DATA",
                data: {
                    ...initialSnapshot,
                    isMarketOpen: isLiveMarketOpen,
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
     * ✅ Preserves quoteObj with timestamps, OHLC, source, and freshness
     */
    handlePriceUpdate(userId, instrumentKey, ltp, quoteObj = null) {
        if (!userId) return;
        const uId = String(userId);

        const updatedData = pnlEngine.updatePrice(uId, instrumentKey, ltp, quoteObj);
        if (updatedData) {
            const openPositions = pnlEngine.positions.get(uId) || [];
            this.broadcast(uId, {
                type: "LIVE_PNL_UPDATE",
                data: {
                    ...updatedData,
                    isMarketOpen: isAnyMarketOpen(openPositions)
                }
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
export { liveWebSocketService };
export default liveWebSocketService;