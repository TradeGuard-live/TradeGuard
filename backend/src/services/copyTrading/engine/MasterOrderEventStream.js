/**
 * MasterOrderEventStream.js
 * 
 * Manages streaming connectivity and low-latency polling for the Master Broker account.
 * Listens for order placement, execution, modification, and cancellation events,
 * converts them into CanonicalOrderEvents, and forwards them to CopyExecutionRouter.
 */

import { copyExecutionRouter } from "./CopyExecutionRouter.js";
import { copyTradingAuditService } from "./CopyTradingAuditService.js";
import CanonicalOrderEvent from "../models/CanonicalOrderEvent.js";
import TradeRecord from "../../../models/TradeRecord.js";
import CopyOrderMapping from "../../../models/CopyOrderMapping.js";
import CopyConfig from "../../../models/CopyConfig.js";

export class MasterOrderEventStream {
    constructor() {
        this.activeStreams = new Map(); // userId -> { adapter, callback, isConnected, lastEventAt, pollTimer, seenOrderIds, seenTradeIds }
    }

    /**
     * Starts listening to order events for a user's configured master account
     * 
     * @param {Object} params
     * @param {string} params.userId
     * @param {Object} params.masterAdapter - IBrokerAdapter instance for master account
     * @returns {Promise<{ success: boolean, message?: string }>}
     */
    async startStream({ userId, masterAdapter }) {
        if (!userId || !masterAdapter) {
            throw new Error("userId and masterAdapter are required to start master event stream");
        }

        // Stop existing stream if any
        this.stopStream(userId);

        const seenOrderIds = new Set();
        const seenTradeIds = new Set();

        const callback = async (rawEvent) => {
            const streamInfo = this.activeStreams.get(userId);
            if (streamInfo) {
                streamInfo.lastEventAt = Date.now();
            }

            try {
                const canonical = rawEvent instanceof CanonicalOrderEvent
                    ? rawEvent
                    : new CanonicalOrderEvent({
                        ...rawEvent,
                        broker: masterAdapter.getBroker(),
                        accountId: masterAdapter.getAccountId()
                    });

                await copyExecutionRouter.handleMasterEvent({
                    userId,
                    masterEvent: canonical
                });

                // Immediately notify Live Market WebSocket and trigger broker sync so Trade History updates live
                try {
                    const { liveWebSocketService } = await import("../../Websocket/LiveWebSocketSevice.js");
                    liveWebSocketService.broadcast(userId, {
                        type: "ORDER_DETECTED",
                        data: canonical
                    });
                    liveWebSocketService.refreshUserPositions(userId, { broadcastTradeSync: true }).catch(() => {});
                } catch {
                    // best-effort live stream notification
                }
            } catch (err) {
                console.error("[MasterOrderEventStream] Ingestion error:", err.message);
                await copyTradingAuditService.log({
                    userId,
                    eventType: "DISCREPANCY",
                    severity: "ERROR",
                    message: `Master event stream processing error: ${err.message}`,
                    details: { rawEvent }
                });
            }
        };

        // Hook adapter's native event stream if supported (e.g. Mock, Upstox/Zerodha WebSocket)
        masterAdapter.subscribeOrderStream(callback);

        // Seed initial orders & trades to avoid re-triggering ancient historical orders
        try {
            const initialOrders = await masterAdapter.getOrders();
            if (Array.isArray(initialOrders)) {
                for (const o of initialOrders) {
                    const id = o.orderId || o.order_id || o.dhanOrderId;
                    if (id) seenOrderIds.add(String(id));
                }
            }
            const initialTrades = await masterAdapter.getTrades();
            if (Array.isArray(initialTrades)) {
                for (const t of initialTrades) {
                    const id = t.tradeId || t.trade_id || t.dhanTradeId || t.orderId;
                    if (id) seenTradeIds.add(String(id));
                }
            }
        } catch (seedErr) {
            console.warn(`[MasterOrderEventStream] Seeding notice for broker ${masterAdapter.getBroker()}:`, seedErr.message);
        }

        // Periodic low-latency order/trade poller (every 1.5s) to capture trades placed directly on broker apps
        const pollTimer = setInterval(async () => {
            try {
                // 1. Check orders
                const orders = await masterAdapter.getOrders();
                if (Array.isArray(orders)) {
                    for (const ord of orders) {
                        const ordId = String(ord.orderId || ord.order_id || ord.dhanOrderId || "");
                        if (ordId && !seenOrderIds.has(ordId)) {
                            seenOrderIds.add(ordId);
                            const canonical = new CanonicalOrderEvent({
                                broker: masterAdapter.getBroker(),
                                accountId: masterAdapter.getAccountId(),
                                orderId: ordId,
                                symbol: ord.symbol || ord.tradingSymbol || ord.tradingsymbol || ord.securityId,
                                exchange: ord.exchange || ord.exchangeSegment?.split("_")?.[0] || "NSE",
                                segment: ord.segment || (ord.exchangeSegment?.includes("FNO") ? "FUTURES" : "EQUITY"),
                                transactionType: String(ord.transactionType || ord.transaction_type || ord.side || "BUY").toUpperCase().startsWith("S") ? "SELL" : "BUY",
                                orderType: ord.orderType || ord.order_type || "MARKET",
                                productCode: ord.productCode || ord.product || ord.productType || "INTRADAY",
                                quantity: Number(ord.quantity || ord.orderQty || 1),
                                filledQuantity: Number(ord.filledQuantity || ord.tradedQuantity || 0),
                                price: Number(ord.price || ord.orderPrice || 0),
                                triggerPrice: Number(ord.triggerPrice || 0),
                                status: ord.status || ord.orderStatus || "ACKNOWLEDGED",
                                version: 1,
                                eventTimestamp: Date.now()
                            });

                            await callback(canonical);
                        }
                    }
                }

                // 2. Check trades
                const trades = await masterAdapter.getTrades();
                if (Array.isArray(trades)) {
                    for (const trd of trades) {
                        const trdId = String(trd.tradeId || trd.trade_id || trd.dhanTradeId || trd.orderId || "");
                        if (trdId && !seenTradeIds.has(trdId)) {
                            seenTradeIds.add(trdId);
                            const orderIdRef = String(trd.orderId || trd.order_id || trdId);
                            if (!seenOrderIds.has(orderIdRef)) {
                                seenOrderIds.add(orderIdRef);
                                const canonical = new CanonicalOrderEvent({
                                    broker: masterAdapter.getBroker(),
                                    accountId: masterAdapter.getAccountId(),
                                    orderId: orderIdRef,
                                    symbol: trd.symbol || trd.tradingSymbol || trd.tradingsymbol || trd.securityId,
                                    exchange: trd.exchange || "NSE",
                                    segment: trd.segment || "EQUITY",
                                    transactionType: String(trd.transactionType || trd.transaction_type || trd.side || "BUY").toUpperCase().startsWith("S") ? "SELL" : "BUY",
                                    orderType: "MARKET",
                                    productCode: trd.productCode || trd.product || trd.productType || "INTRADAY",
                                    quantity: Number(trd.quantity || trd.tradedQuantity || 1),
                                    filledQuantity: Number(trd.quantity || trd.tradedQuantity || 1),
                                    price: Number(trd.price || trd.tradedPrice || 0),
                                    status: "FILLED",
                                    version: 1,
                                    eventTimestamp: Date.now()
                                });

                                await callback(canonical);
                            }
                        }
                    }
                }
            } catch (pollErr) {
                const isAuth = pollErr.status === 401 || pollErr.status === 403 || /401|403|unauthorized|expired|invalid.*token/i.test(pollErr.message);
                if (isAuth) {
                    console.warn(`[MasterOrderEventStream] Master broker ${masterAdapter.getBroker()} 401/403 for user ${userId}. Stopping stream.`);
                    await this.stop(userId);
                    return;
                }
            }
        }, 1500);

        this.activeStreams.set(userId, {
            adapter: masterAdapter,
            callback,
            isConnected: true,
            startedAt: Date.now(),
            lastEventAt: null,
            pollTimer,
            seenOrderIds,
            seenTradeIds
        });

        await copyTradingAuditService.log({
            userId,
            eventType: "SYSTEM_HEALTH",
            severity: "INFO",
            message: `Started Master Order Event Stream for broker ${masterAdapter.getBroker()}`
        });

        return { success: true };
    }

    /**
     * Immediately processes a new trade detected via trade synchronization
     * @param {Object} params
     * @param {string} params.userId
     * @param {string} params.brokerAccountId
     * @param {Object} params.trade - TradeRecord document or trade object
     */
    async notifyNewMasterTrade({ userId, brokerAccountId, trade }) {
        try {
            const canonical = new CanonicalOrderEvent({
                broker: trade.broker,
                accountId: String(brokerAccountId),
                orderId: trade.orderId || trade.tradeId || `TRD-${Date.now()}`,
                symbol: trade.symbol,
                exchange: trade.exchange || "NSE",
                segment: trade.segment || "EQUITY",
                transactionType: trade.transactionType || "BUY",
                orderType: trade.orderType || "MARKET",
                productCode: trade.productCode || "INTRADAY",
                quantity: Number(trade.quantity || 1),
                filledQuantity: Number(trade.quantity || 1),
                price: Number(trade.executedPrice || trade.price || 0),
                status: "FILLED",
                version: 1,
                eventTimestamp: new Date(trade.tradeTime || Date.now()).getTime()
            });

            const res = await copyExecutionRouter.handleMasterEvent({
                userId,
                masterEvent: canonical
            });

            try {
                const { liveWebSocketService } = await import("../../Websocket/LiveWebSocketSevice.js");
                liveWebSocketService.broadcast(userId, {
                    type: "TRADES_UPDATED",
                    data: { trade }
                });
                liveWebSocketService.refreshUserPositions(userId).catch(() => {});
            } catch {
                // best-effort
            }

            return res;
        } catch (err) {
            console.error("[MasterOrderEventStream] notifyNewMasterTrade error:", err.message);
        }
    }

    /**
     * Catches up and copies all uncopied trades executed on the master account today
     * @param {string} userId
     * @returns {Promise<{ copiedCount: number, results: Array }>}
     */
    async catchUpTodayTrades(userId) {
        const copyConfig = await CopyConfig.findOne({
            userId,
            isEnabled: true,
            emergencyStop: false
        });

        if (!copyConfig || !copyConfig.masterAccountId) {
            return { copiedCount: 0, reason: "No active master account configured" };
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Find today's trades on the master account in TradeRecord
        const todayTrades = await TradeRecord.find({
            userId,
            brokerAccountId: copyConfig.masterAccountId,
            status: { $nin: ["CANCELLED", "REJECTED", "FAILED"] },
            $or: [
                { createdAt: { $gte: startOfDay } },
                { tradeTime: { $gte: startOfDay } }
            ]
        }).sort({ tradeTime: 1, createdAt: 1 });

        const results = [];
        for (const trade of todayTrades) {
            const possibleIds = [trade.orderId, trade.tradeId].filter(Boolean);
            const existingMapping = await CopyOrderMapping.findOne({
                userId,
                masterOrderId: { $in: possibleIds }
            });

            if (!existingMapping) {
                // Replicate to followers
                const res = await this.notifyNewMasterTrade({
                    userId,
                    brokerAccountId: copyConfig.masterAccountId,
                    trade
                });
                results.push({ 
                    tradeId: trade.tradeId || trade.orderId, 
                    symbol: trade.symbol, 
                    result: res 
                });
            }
        }

        return { copiedCount: results.length, results };
    }

    /**
     * Stops listening to master order events for a user
     * @param {string} userId
     */
    stopStream(userId) {
        const streamInfo = this.activeStreams.get(userId);
        if (streamInfo) {
            if (streamInfo.pollTimer) {
                clearInterval(streamInfo.pollTimer);
            }
            try {
                streamInfo.adapter.unsubscribeOrderStream(streamInfo.callback);
            } catch (e) {
                // Ignore unsubscribe error
            }
            this.activeStreams.delete(userId);
        }
    }

    /**
     * Retrieves health status for a user's master stream
     * @param {string} userId
     * @returns {{ isConnected: boolean, startedAt?: number, lastEventAt?: number }}
     */
    getStreamStatus(userId) {
        const streamInfo = this.activeStreams.get(userId);
        if (!streamInfo) {
            return { isConnected: false };
        }
        return {
            isConnected: streamInfo.isConnected,
            startedAt: streamInfo.startedAt,
            lastEventAt: streamInfo.lastEventAt
        };
    }
}

export const masterOrderEventStream = new MasterOrderEventStream();
export default masterOrderEventStream;
