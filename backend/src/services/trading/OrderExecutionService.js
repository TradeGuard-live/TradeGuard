/**
 * OrderExecutionService.js
 * 
 * Central order execution orchestrator handling single position exits
 * and bulk square-off across all supported Indian brokers (Upstox, Zerodha,
 * Dhan, Kotak Neo, Angel One, Groww, and simulation/mock).
 */

import mongoose from "mongoose";
import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";
import positionEngine from "../position/PositionEngine.js";
import pnlEngine from "../pnl/PnLEngine.js";
import BrokerAdapterFactory from "../copyTrading/adapters/BrokerAdapterFactory.js";
import { liveWebSocketService } from "../Websocket/LiveWebSocketSevice.js";

export class OrderExecutionService {
    /**
     * Finds active open position for a user matching symbol or position key
     * @param {string} userId
     * @param {Object} query - { symbol, positionKey, exchange }
     * @returns {Promise<Object|null>}
     */
    static async findOpenPosition(userId, { symbol, positionKey, exchange, broker, brokerAccountId } = {}) {
        const uId = String(userId);
        
        // 1. Check in-memory PnLEngine first for instantaneous state
        const pnlCalc = pnlEngine.calculate(uId);
        if (pnlCalc?.positions && Array.isArray(pnlCalc.positions)) {
            const found = pnlCalc.positions.find(p => {
                if (broker && p.broker && p.broker.toUpperCase() !== String(broker).toUpperCase()) return false;
                if (brokerAccountId && p.brokerAccountId && String(p.brokerAccountId) !== String(brokerAccountId)) return false;
                if (positionKey && (p.key === positionKey || p.id === positionKey)) return true;
                if (symbol && (p.symbol === symbol || p.symbol?.toUpperCase() === symbol.toUpperCase())) {
                    if (exchange && p.exchange?.toUpperCase() !== exchange.toUpperCase()) return false;
                    return true;
                }
                return false;
            });
            if (found && found.openQuantity > 0) return found;
        }

        // 2. Fallback: Query TradeRecord database and run PositionEngine
        if (mongoose.connection.readyState === 1) {
            let dbQuery = {};
            if (mongoose.Types.ObjectId.isValid(uId)) {
                dbQuery.userId = new mongoose.Types.ObjectId(uId);
            }
            if (brokerAccountId && mongoose.Types.ObjectId.isValid(brokerAccountId)) {
                dbQuery.brokerAccountId = new mongoose.Types.ObjectId(brokerAccountId);
            }
            if (broker) {
                dbQuery.broker = String(broker).toUpperCase();
            }
            const trades = await TradeRecord.find(dbQuery).lean();
            const openPositions = positionEngine.getOpenPositions(trades);

            return openPositions.find(p => {
                if (positionKey && (p.key === positionKey || p.id === positionKey)) return true;
                if (symbol && (p.symbol === symbol || p.symbol?.toUpperCase() === symbol.toUpperCase())) {
                    if (exchange && p.exchange?.toUpperCase() !== exchange.toUpperCase()) return false;
                    return true;
                }
                return false;
            }) || null;
        }

        return null;
    }

    /**
     * Resolves appropriate broker account for a position
     * @param {string} userId 
     * @param {Object} pos 
     * @param {string} [requestedAccountId]
     * @param {string} [requestedBroker]
     * @returns {Promise<Object>} BrokerAccount document or mock placeholder
     */
    static async resolveBrokerAccount(userId, pos, requestedAccountId = null, requestedBroker = null) {
        if (mongoose.connection.readyState !== 1) {
            return {
                _id: `MOCK_${userId}`,
                broker: requestedBroker || pos?.broker || "MOCK",
                isConnected: true
            };
        }

        const targetBroker = requestedBroker || pos?.broker;

        // A. If specific account ID requested and valid
        if (requestedAccountId && mongoose.Types.ObjectId.isValid(requestedAccountId)) {
            const acc = await BrokerAccount.findOne({ _id: requestedAccountId, userId });
            if (acc) return acc;
        }

        // B. If position has a stored brokerAccountId
        if (pos?.brokerAccountId && mongoose.Types.ObjectId.isValid(pos.brokerAccountId)) {
            const acc = await BrokerAccount.findOne({ _id: pos.brokerAccountId, userId });
            if (acc) return acc;
        }

        // C. Match by broker name if known (Strict: if position is UPSTOX, never route to DHAN)
        if (targetBroker) {
            const brokerName = String(targetBroker).toUpperCase().trim();
            const acc = await BrokerAccount.findOne({ userId, broker: brokerName, isConnected: true }) ||
                        await BrokerAccount.findOne({ userId, broker: brokerName });
            if (acc) return acc;
            throw new Error(`No connected broker account found for broker: ${brokerName}`);
        }

        // D. Pick any connected broker account for this user (only when broker was unassigned)
        const anyConnected = await BrokerAccount.findOne({ userId, isConnected: true });
        if (anyConnected) return anyConnected;

        // E. Pick any broker account registered for this user
        const anyAccount = await BrokerAccount.findOne({ userId });
        if (anyAccount) return anyAccount;

        // F. Simulation / fallback account
        return {
            _id: `MOCK_${userId}`,
            broker: "MOCK",
            isConnected: true
        };
    }

    /**
     * Executes exit for a single position
     * 
     * @param {Object} params
     * @param {string} params.userId
     * @param {string} [params.positionKey]
     * @param {string} params.symbol
     * @param {string} [params.exchange]
     * @param {string} [params.segment]
     * @param {string} [params.productType]
     * @param {string} [params.broker]
     * @param {string} [params.brokerAccountId]
     * @param {string} [params.securityId]
     * @param {string} [params.instrumentToken]
     * @param {string} [params.orderType] - "MARKET", "LIMIT", "SL", "SL-M"
     * @param {number} [params.quantity] - Quantity to exit (defaults to openQuantity)
     * @param {number} [params.price] - Limit price (required for LIMIT / SL)
     * @param {number} [params.triggerPrice] - Trigger price (required for SL / SL-M)
     * @returns {Promise<Object>} Execution result
     */
    static async executeExitPosition({
        userId,
        positionKey,
        symbol,
        exchange,
        segment,
        productType,
        broker,
        brokerAccountId,
        securityId,
        instrumentToken,
        orderType = "MARKET",
        quantity = null,
        price = 0,
        triggerPrice = 0
    }) {
        if (!userId) {
            throw new Error("userId is required to exit position");
        }
        if (!symbol && !positionKey) {
            throw new Error("symbol or positionKey is required to exit position");
        }

        // 1. Locate open position
        const pos = await this.findOpenPosition(userId, { symbol, positionKey, exchange, broker, brokerAccountId });
        if (!pos || !pos.openQuantity || pos.openQuantity <= 0) {
            throw new Error(`No active open position found for ${symbol || positionKey}`);
        }

        const normOrderType = String(orderType || "MARKET").toUpperCase();
        if (!["MARKET", "LIMIT", "SL", "SL-M", "STOPLOSS_LIMIT", "STOPLOSS_MARKET"].includes(normOrderType)) {
            throw new Error(`Unsupported order type: ${orderType}. Allowed: MARKET, LIMIT, SL, SL-M`);
        }

        const numPrice = Number(price || 0);
        const numTriggerPrice = Number(triggerPrice || 0);

        if ((normOrderType === "LIMIT" || normOrderType === "SL" || normOrderType === "STOPLOSS_LIMIT") && numPrice <= 0) {
            throw new Error(`A valid limit price greater than 0 is required for ${normOrderType} order`);
        }

        if ((normOrderType === "SL" || normOrderType === "SL-M" || normOrderType.includes("STOPLOSS")) && numTriggerPrice <= 0) {
            throw new Error(`A valid trigger price greater than 0 is required for ${normOrderType} order`);
        }

        // 2. Determine exit quantity (supports full or partial exit)
        const totalOpenQty = Math.abs(pos.openQuantity);
        const exitQty = (quantity && Number(quantity) > 0)
            ? Math.min(Number(quantity), totalOpenQty)
            : totalOpenQty;

        if (exitQty <= 0) {
            throw new Error("Exit quantity must be greater than 0");
        }

        // 3. Determine opposing exit transaction side:
        //    If position is LONG (netQuantity > 0 or side === 'BUY'), exit side is SELL.
        //    If position is SHORT (netQuantity < 0 or side === 'SELL'), exit side is BUY.
        const isLong = pos.side === "BUY" || (pos.netQuantity !== undefined ? pos.netQuantity > 0 : true);
        const exitTransactionType = isLong ? "SELL" : "BUY";

        // 4. Resolve broker account and adapter
        const account = await this.resolveBrokerAccount(userId, pos, brokerAccountId || pos?.brokerAccountId, broker || pos?.broker);
        const accountId = String(account._id);
        const brokerName = account.broker || broker || pos.broker || "UPSTOX";

        const adapter = await BrokerAdapterFactory.getAdapter(accountId, brokerName);

        // 5. Send exit order to broker adapter
        const orderParams = {
            symbol: pos.symbol,
            tradingsymbol: pos.symbol,
            exchange: pos.exchange || exchange || "NSE",
            segment: pos.segment || segment || "EQUITY",
            productCode: pos.productType || productType || "INTRADAY",
            productType: pos.productType || productType || "INTRADAY",
            transactionType: exitTransactionType,
            orderType: normOrderType === "SL" ? "STOPLOSS_LIMIT" : normOrderType === "SL-M" ? "STOPLOSS_MARKET" : normOrderType,
            quantity: exitQty,
            price: numPrice > 0 ? numPrice : (pos.ltp || pos.averagePrice || 0),
            triggerPrice: numTriggerPrice,
            instrumentToken: pos.instrumentToken || instrumentToken,
            symbolToken: pos.instrumentToken || instrumentToken,
            securityId: pos.securityId || securityId,
            tag: "TG-EXIT"
        };

        const brokerResult = await adapter.placeOrder(orderParams);
        const orderId = String(brokerResult.orderId || `ORD-${Date.now()}`);

        // 6. Record matching TradeRecord in database to immediately reflect execution
        const executedPrice = numPrice > 0 ? numPrice : (pos.ltp || pos.averagePrice || 0);
        let createdTrade = null;

        if (mongoose.connection.readyState === 1) {
            try {
                const tradeId = `EXT-${orderId}-${Date.now().toString().slice(-4)}`;
                const validBrokerAccountId = mongoose.Types.ObjectId.isValid(accountId)
                    ? new mongoose.Types.ObjectId(accountId)
                    : new mongoose.Types.ObjectId();

                createdTrade = await TradeRecord.create({
                    userId: new mongoose.Types.ObjectId(String(userId)),
                    brokerAccountId: validBrokerAccountId,
                    broker: adapter.getBroker ? adapter.getBroker() : brokerName,
                    tradeId,
                    orderId,
                    symbol: pos.symbol,
                    exchange: pos.exchange || "NSE",
                    segment: pos.segment || "EQUITY",
                    productCode: pos.productType || "INTRADAY",
                    productType: pos.productType || "INTRADAY",
                    instrumentToken: pos.instrumentToken || null,
                    transactionType: exitTransactionType,
                    orderType: normOrderType,
                    quantity: exitQty,
                    executedPrice,
                    status: "COMPLETE",
                    tradeTime: new Date()
                });
            } catch (dbErr) {
                console.warn("[OrderExecutionService] Failed to record exit TradeRecord:", dbErr.message);
            }
        }

        // 7. Refresh user positions and broadcast WebSocket update
        try {
            await liveWebSocketService.refreshUserPositions(userId, { broadcastTradeSync: true });
        } catch (wsErr) {
            console.warn("[OrderExecutionService] Live WebSocket refresh error:", wsErr.message);
        }

        return {
            success: true,
            message: `Successfully placed ${normOrderType} exit order for ${exitQty} ${pos.symbol} via ${brokerName}`,
            orderId,
            symbol: pos.symbol,
            exitSide: exitTransactionType,
            quantity: exitQty,
            orderType: normOrderType,
            price: executedPrice,
            broker: brokerName,
            trade: createdTrade,
            rawBrokerResponse: brokerResult.raw
        };
    }

    /**
     * Squares off / exits all active open positions for a user
     * 
     * @param {Object} params
     * @param {string} params.userId
     * @param {string} [params.orderType] - "MARKET" or "LIMIT" (default: "MARKET")
     * @param {Array} [params.positions] - Optional explicit list of positions
     * @returns {Promise<Object>} Aggregate summary
     */
    static async executeExitAllPositions({
        userId,
        orderType = "MARKET",
        positions = null
    }) {
        if (!userId) {
            throw new Error("userId is required to exit all positions");
        }

        const uId = String(userId);

        // 1. Resolve open positions
        let targetPositions = Array.isArray(positions) && positions.length > 0 ? positions : null;

        if (!targetPositions) {
            let dbQuery = {};
            if (mongoose.Types.ObjectId.isValid(uId)) {
                dbQuery.userId = new mongoose.Types.ObjectId(uId);
            }
            const trades = await TradeRecord.find(dbQuery).lean();
            targetPositions = positionEngine.getOpenPositions(trades);
        }

        if (!targetPositions || targetPositions.length === 0) {
            return {
                success: true,
                message: "No open positions to exit",
                total: 0,
                exitedCount: 0,
                failedCount: 0,
                results: []
            };
        }

        const results = [];
        let exitedCount = 0;
        let failedCount = 0;

        // 2. Loop through each open position and exit it
        for (const pos of targetPositions) {
            try {
                const exitRes = await this.executeExitPosition({
                    userId,
                    positionKey: pos.key || pos.id,
                    symbol: pos.symbol,
                    exchange: pos.exchange,
                    segment: pos.segment,
                    productType: pos.productType,
                    broker: pos.broker,
                    brokerAccountId: pos.brokerAccountId,
                    securityId: pos.securityId,
                    instrumentToken: pos.instrumentToken,
                    orderType,
                    quantity: Math.abs(pos.openQuantity),
                    price: pos.ltp || pos.averagePrice || 0
                });

                results.push({
                    symbol: pos.symbol,
                    success: true,
                    orderId: exitRes.orderId,
                    quantity: pos.openQuantity,
                    message: exitRes.message
                });
                exitedCount += 1;
            } catch (err) {
                console.error(`[OrderExecutionService] Failed to exit position ${pos.symbol}:`, err.message);
                results.push({
                    symbol: pos.symbol,
                    success: false,
                    error: err.message
                });
                failedCount += 1;
            }
        }

        // 3. Final WebSocket refresh & broadcast
        try {
            await liveWebSocketService.refreshUserPositions(userId, { broadcastTradeSync: true });
        } catch {
            // non-fatal
        }

        return {
            success: failedCount === 0,
            message: `Square off complete: ${exitedCount} exited successfully, ${failedCount} failed`,
            total: targetPositions.length,
            exitedCount,
            failedCount,
            results
        };
    }
}

export default OrderExecutionService;
