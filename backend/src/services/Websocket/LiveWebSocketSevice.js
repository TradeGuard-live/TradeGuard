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
import marketDataEngine, { isIndianMarketOpen } from "../marketData/MarketDataEngine.js";
import UpstoxAdapter from "../../brokers/upstox/UpstoxAdaptor.js";
import { mapUpstoxPosition } from "../../brokers/upstox/UpstoxMapper.js";
import DhanAdapter from "../../brokers/dhan/DhanAdapter.js";
import { mapDhanPosition } from "../../brokers/dhan/DhanMapper.js";
import AngelOneAdapter from "../../brokers/angelOne/AngelOneAdapter.js";
import { mapAngelOnePosition } from "../../brokers/angelOne/AngelOneMapper.js";
import GrowwAdapter from "../../brokers/groww/GrowwAdapter.js";
import { mapGrowwPosition } from "../../brokers/groww/GrowwMapper.js";
import ZerodhaAdapter from "../../brokers/zerodha/ZerodhaAdapter.js";
import { mapZerodhaPosition } from "../../brokers/zerodha/ZerodhaMapper.js";
import { decrypt, encrypt } from "../../utils/encryption.js";

class LiveWebSocketService {
    constructor() {
        this.clients = new Map(); // userId -> Set of WebSockets
        this.userInitialized = new Set();

        // ✅ Listen for price updates & quote metadata from Market Data Engine
        marketDataEngine.onPriceUpdate((userId, instrumentKey, ltp, quoteObj) => {
            this.handlePriceUpdate(userId, instrumentKey, ltp, quoteObj);
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

            // User trades loaded

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
                                if (Array.isArray(upstoxPos)) {
                                    // ✅ Map positions with canonical Upstox mapper
                                    const mapped = upstoxPos.map(mapUpstoxPosition).filter(Boolean);
                                    brokerPositions.push(...mapped);
                                }
                                acc.isConnected = true;
                                await acc.save().catch(() => {});
                            } catch (e) {
                                if (e.status === 401 || e.errorCode === "UDAPI100050" || String(e.message || "").includes("UDAPI100050")) {
                                    acc.isConnected = false;
                                    await acc.save().catch(() => {});
                                }
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
                                if (e.status === 401 || e.status === 403) {
                                    acc.isConnected = false;
                                    await acc.save().catch(() => {});
                                }
                            }
                        }
                    } else if (acc.broker === "ANGEL_ONE") {
                        const token = acc.credentials?.accessToken ? decrypt(acc.credentials.accessToken) : "";
                        const apiKey = acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey) : "";
                        const clientCode = acc.credentials?.clientId || "";
                        const password = acc.credentials?.password ? decrypt(acc.credentials.password) : (acc.credentials?.apiSecret ? decrypt(acc.credentials.apiSecret) : "");
                        const totpSecret = acc.credentials?.totpSecret ? decrypt(acc.credentials.totpSecret) : "";
                        
                        if (token) {
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
                                const angelPos = await angel.getPositions({ noAutoLogin: true });
                                if (Array.isArray(angelPos)) {
                                    const mapped = angelPos.map(mapAngelOnePosition).filter(Boolean);
                                    brokerPositions.push(...mapped);
                                }
                            } catch (e) {
                                if (e.status === 401 || e.errorCode === "AG8001" || e.errorCode === "AB8050") {
                                    acc.isConnected = false;
                                    await acc.save().catch(() => {});
                                }
                            }
                        }
                    } else if (acc.broker === "GROWW" && (acc.credentials?.accessToken || (acc.credentials?.apiKey && acc.credentials?.apiSecret))) {
                        // ✅ Groww live position reconciliation
                        let token = acc.credentials?.accessToken ? decrypt(acc.credentials.accessToken) : "";
                        const apiKey = acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey) : "";
                        const apiSecret = acc.credentials?.apiSecret ? decrypt(acc.credentials.apiSecret) : "";

                        // If access token is expired or missing, auto-exchange
                        const isTokenExpired = acc.credentials?.tokenExpiresAt && new Date(acc.credentials.tokenExpiresAt) < new Date();
                        if ((!token || isTokenExpired) && apiKey && apiSecret) {
                            try {
                                const tokenRes = await GrowwAdapter.generateAccessToken({ apiKey, apiSecret });
                                token = tokenRes.accessToken;
                                acc.credentials.accessToken = encrypt(token);
                                acc.credentials.tokenExpiresAt = tokenRes.expiresAt;
                                acc.isConnected = true;
                                await acc.save().catch(() => {});
                            } catch (gErr) {
                                console.warn("[LiveWS] Groww auto token exchange failed:", gErr.message);
                            }
                        }

                        if (token) {
                            brokerAuth.growwToken = token;
                            const groww = new GrowwAdapter({
                                clientId: acc.credentials?.clientId,
                                accessToken: token,
                                apiKey,
                                apiSecret
                            });
                            try {
                                const growwPos = await groww.getPositions();
                                if (Array.isArray(growwPos)) {
                                    // ✅ Map positions with canonical Groww mapper
                                    const mapped = growwPos.map(mapGrowwPosition).filter(Boolean);
                                    brokerPositions.push(...mapped);
                                }
                                acc.isConnected = true;
                                await acc.save().catch(() => {});
                            } catch (e) {
                                if (e.status === 401 || e.status === 403) {
                                    acc.isConnected = false;
                                    await acc.save().catch(() => {});
                                }
                            }
                        }
                    } else if (acc.broker === "ZERODHA" && (acc.credentials?.accessToken || (acc.credentials?.apiKey && acc.credentials?.apiSecret))) {
                        // ✅ Zerodha Kite Connect live position reconciliation
                        let token = acc.credentials?.accessToken ? decrypt(acc.credentials.accessToken) : "";
                        const apiKey = acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey) : "";
                        const apiSecret = acc.credentials?.apiSecret ? decrypt(acc.credentials.apiSecret) : "";
                        const requestToken = acc.credentials?.totpSecret ? decrypt(acc.credentials.totpSecret) : "";

                        // If access token is expired or missing, auto-exchange
                        const isTokenExpired = acc.credentials?.tokenExpiresAt && new Date(acc.credentials.tokenExpiresAt) < new Date();
                        if ((!token || isTokenExpired) && apiKey && apiSecret && requestToken) {
                            try {
                                const tokenRes = await ZerodhaAdapter.generateAccessToken({ apiKey, apiSecret, requestToken });
                                token = tokenRes.accessToken;
                                acc.credentials.accessToken = encrypt(token);
                                const tomorrow6AM = new Date();
                                tomorrow6AM.setDate(tomorrow6AM.getDate() + 1);
                                tomorrow6AM.setHours(6, 0, 0, 0);
                                acc.credentials.tokenExpiresAt = tomorrow6AM;
                                acc.isConnected = true;
                                await acc.save().catch(() => {});
                            } catch (zErr) {
                                console.warn("[LiveWS] Zerodha auto token exchange failed:", zErr.message);
                            }
                        }

                        if (token && apiKey) {
                            brokerAuth.zerodhaToken = token;
                            brokerAuth.zerodhaApiKey = apiKey;
                            const zerodha = new ZerodhaAdapter({
                                apiKey,
                                accessToken: token,
                                apiSecret,
                                clientId: acc.credentials?.clientId
                            });
                            try {
                                const posRes = await zerodha.getPositions();
                                if (Array.isArray(posRes.net)) {
                                    // ✅ Map positions with canonical Zerodha mapper
                                    const mapped = posRes.net.map(mapZerodhaPosition).filter(Boolean);
                                    brokerPositions.push(...mapped);
                                }
                                acc.isConnected = true;
                                await acc.save().catch(() => {});
                            } catch (e) {
                                if (e.status === 401 || e.status === 403) {
                                    acc.isConnected = false;
                                    await acc.save().catch(() => {});
                                }
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
                    isMarketOpen: isIndianMarketOpen(),
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
            this.broadcast(uId, {
                type: "LIVE_PNL_UPDATE",
                data: {
                    ...updatedData,
                    isMarketOpen: isIndianMarketOpen()
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
export default liveWebSocketService;