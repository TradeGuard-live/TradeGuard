/**
 * MockBrokerAdapter.js
 * 
 * Deterministic in-memory mock broker adapter for TradeGuard Copy-Trading.
 * Implements IBrokerAdapter contract with configurable fault injection:
 * - Immediate or delayed acceptance
 * - Programmatic rejections
 * - Partial fills and complete fills
 * - Order modifications and remaining quantity recalculation
 * - Cancellations and cancellation-fill race simulations
 * - Network timeouts and unknown submission outcomes
 * - Duplicate events and out-of-order emission
 * - Rate limiting and authentication expiry simulation
 */

import { EventEmitter } from "events";
import IBrokerAdapter from "../contracts/BrokerAdapterContract.js";
import { getBrokerCapabilities } from "../contracts/BrokerCapabilityRegistry.js";
import CanonicalOrderEvent from "../models/CanonicalOrderEvent.js";

export class MockBrokerAdapter extends IBrokerAdapter {
    constructor({ accountId = "MOCK_ACC_01", initialLatencyMs = 2 } = {}) {
        super();
        this.accountId = accountId;
        this.latencyMs = initialLatencyMs;
        this.orders = new Map(); // orderId -> OrderObject
        this.trades = [];
        this.eventEmitter = new EventEmitter();
        this.orderSeq = 1;
        this.tradeSeq = 1;

        // Fault injection hooks
        this.faults = {
            rejectNext: false,
            rejectReason: "Mock rejection: insufficient margin",
            timeoutNext: false,
            unknownOutcomeNext: false,
            authExpired: false,
            rateLimitExceeded: false,
            emitDuplicate: false,
            emitOutOfOrder: false,
            partialFillRatio: 0, // 0 = no partial fill (fill 100%), 0.5 = fill 50%
            fillDelayMs: 5
        };
    }

    getBroker() {
        return "MOCK";
    }

    getAccountId() {
        return this.accountId;
    }

    getCapabilities() {
        return getBrokerCapabilities("MOCK");
    }

    /**
     * Configure programmatic faults for testing
     * @param {Object} options
     */
    setFaults(options = {}) {
        this.faults = { ...this.faults, ...options };
    }

    /**
     * Reset all faults to healthy defaults
     */
    clearFaults() {
        this.faults = {
            rejectNext: false,
            rejectReason: null,
            timeoutNext: false,
            unknownOutcomeNext: false,
            authExpired: false,
            rateLimitExceeded: false,
            emitDuplicate: false,
            emitOutOfOrder: false,
            partialFillRatio: 0,
            fillDelayMs: 5
        };
    }

    async checkConnection() {
        if (this.faults.authExpired) {
            return { isConnected: false, message: "Mock auth token expired" };
        }
        return { isConnected: true };
    }

    async _simulateLatency() {
        if (this.latencyMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
        }
    }

    /**
     * Places a new order
     */
    async placeOrder(params) {
        await this._simulateLatency();

        if (this.faults.authExpired) {
            const err = new Error("Mock: Session expired (401)");
            err.status = 401;
            throw err;
        }

        if (this.faults.rateLimitExceeded) {
            const err = new Error("Mock: Rate limit exceeded (429)");
            err.status = 429;
            throw err;
        }

        if (this.faults.timeoutNext) {
            this.faults.timeoutNext = false;
            const err = new Error("Mock: Request timeout (ECONNABORTED)");
            err.code = "ECONNABORTED";
            throw err;
        }

        const orderId = `MOCK-ORD-${this.orderSeq++}`;
        const qty = Number(params.quantity);
        const price = Number(params.price || 0);

        if (this.faults.rejectNext) {
            this.faults.rejectNext = false;
            const reason = this.faults.rejectReason || "Order rejected by broker risk limits";
            const rejectedOrder = {
                orderId,
                status: "REJECTED",
                symbol: params.symbol,
                quantity: qty,
                filledQuantity: 0,
                price,
                rejectionReason: reason,
                createdAt: Date.now()
            };
            this.orders.set(orderId, rejectedOrder);
            this._emitEvent(rejectedOrder, "REJECTED", reason);
            return {
                success: false,
                orderId,
                status: "REJECTED",
                message: reason
            };
        }

        if (this.faults.unknownOutcomeNext) {
            this.faults.unknownOutcomeNext = false;
            // Order is placed in background on the broker, but client call threw a network disconnect
            const openOrder = {
                orderId,
                status: "ACKNOWLEDGED",
                symbol: params.symbol,
                exchange: params.exchange || "NSE",
                segment: params.segment || "EQUITY",
                transactionType: params.transactionType,
                orderType: params.orderType || "MARKET",
                productCode: params.productCode || "INTRADAY",
                quantity: qty,
                filledQuantity: 0,
                remainingQuantity: qty,
                price,
                triggerPrice: Number(params.triggerPrice || 0),
                createdAt: Date.now(),
                version: 1
            };
            this.orders.set(orderId, openOrder);
            const err = new Error("Mock: Connection reset during order acknowledgment (UNKNOWN outcome)");
            err.isUnknownOutcome = true;
            throw err;
        }

        const order = {
            orderId,
            status: "ACKNOWLEDGED",
            symbol: params.symbol,
            exchange: params.exchange || "NSE",
            segment: params.segment || "EQUITY",
            transactionType: params.transactionType,
            orderType: params.orderType || "MARKET",
            productCode: params.productCode || "INTRADAY",
            quantity: qty,
            filledQuantity: 0,
            remainingQuantity: qty,
            price,
            triggerPrice: Number(params.triggerPrice || 0),
            averagePrice: 0,
            createdAt: Date.now(),
            version: 1
        };
        this.orders.set(orderId, order);

        // Emit ACKNOWLEDGED event
        this._emitEvent(order, "ACKNOWLEDGED");

        // Schedule fill simulation
        const fillDelay = this.faults.fillDelayMs || 5;
        setTimeout(() => {
            this._processFills(orderId);
        }, fillDelay);

        return {
            success: true,
            orderId,
            status: "ACKNOWLEDGED"
        };
    }

    _processFills(orderId) {
        const order = this.orders.get(orderId);
        if (!order || order.status !== "ACKNOWLEDGED") return;

        const partialRatio = this.faults.partialFillRatio;
        if (partialRatio > 0 && partialRatio < 1) {
            const filledQty = Math.floor(order.quantity * partialRatio) || 1;
            order.filledQuantity = filledQty;
            order.remainingQuantity = order.quantity - filledQty;
            order.status = "PARTIALLY_FILLED";
            order.averagePrice = order.price > 0 ? order.price : 100.0;
            order.version += 1;

            this._emitEvent(order, "PARTIALLY_FILLED");

            // Create executed trade
            this.trades.push({
                tradeId: `MOCK-TRD-${this.tradeSeq++}`,
                orderId: order.orderId,
                symbol: order.symbol,
                quantity: filledQty,
                price: order.averagePrice,
                tradeTime: new Date()
            });
        } else {
            order.filledQuantity = order.quantity;
            order.remainingQuantity = 0;
            order.status = "FILLED";
            order.averagePrice = order.price > 0 ? order.price : 100.0;
            order.version += 1;

            this._emitEvent(order, "FILLED");

            this.trades.push({
                tradeId: `MOCK-TRD-${this.tradeSeq++}`,
                orderId: order.orderId,
                symbol: order.symbol,
                quantity: order.quantity,
                price: order.averagePrice,
                tradeTime: new Date()
            });
        }
    }

    /**
     * Modifies an existing open order
     */
    async modifyOrder(params) {
        await this._simulateLatency();
        const order = this.orders.get(params.orderId);

        if (!order) {
            throw new Error(`Order ${params.orderId} not found for modification`);
        }

        if (order.status === "FILLED" || order.status === "CANCELLED" || order.status === "REJECTED") {
            const err = new Error(`Cannot modify order ${params.orderId} in terminal state ${order.status}`);
            err.code = "ORDER_TERMINAL";
            throw err;
        }

        const newQty = Number(params.quantity);
        if (newQty < order.filledQuantity) {
            throw new Error(`Modified quantity (${newQty}) cannot be less than already filled quantity (${order.filledQuantity})`);
        }

        order.quantity = newQty;
        order.remainingQuantity = newQty - order.filledQuantity;
        if (params.price !== undefined) order.price = Number(params.price);
        if (params.triggerPrice !== undefined) order.triggerPrice = Number(params.triggerPrice);
        if (params.orderType) order.orderType = params.orderType;
        order.version += 1;

        this._emitEvent(order, "ACKNOWLEDGED");

        return {
            success: true,
            orderId: order.orderId,
            status: "ACKNOWLEDGED"
        };
    }

    /**
     * Cancels an open order
     */
    async cancelOrder(params) {
        await this._simulateLatency();
        const order = this.orders.get(params.orderId);

        if (!order) {
            throw new Error(`Order ${params.orderId} not found for cancellation`);
        }

        if (order.status === "FILLED") {
            const err = new Error(`Order ${params.orderId} has already been filled`);
            err.code = "ORDER_ALREADY_FILLED";
            throw err;
        }

        if (order.status === "CANCELLED") {
            return { success: true, orderId: order.orderId, status: "CANCELLED" };
        }

        order.status = "CANCELLED";
        order.remainingQuantity = 0;
        order.version += 1;

        this._emitEvent(order, "CANCELLED");

        return {
            success: true,
            orderId: order.orderId,
            status: "CANCELLED"
        };
    }

    async getOrder(orderId) {
        return this.orders.get(orderId) || null;
    }

    async getOrders() {
        return Array.from(this.orders.values());
    }

    async getTrades() {
        return this.trades;
    }

    subscribeOrderStream(callback) {
        this.eventEmitter.on("orderEvent", callback);
    }

    unsubscribeOrderStream(callback) {
        if (callback) {
            this.eventEmitter.off("orderEvent", callback);
        } else {
            this.eventEmitter.removeAllListeners("orderEvent");
        }
    }

    _emitEvent(order, status, rejectionReason = null) {
        const canonical = new CanonicalOrderEvent({
            broker: "MOCK",
            accountId: this.accountId,
            orderId: order.orderId,
            symbol: order.symbol,
            exchange: order.exchange || "NSE",
            segment: order.segment || "EQUITY",
            transactionType: order.transactionType || "BUY",
            orderType: order.orderType || "MARKET",
            productCode: order.productCode || "INTRADAY",
            quantity: order.quantity,
            filledQuantity: order.filledQuantity || 0,
            remainingQuantity: order.remainingQuantity != null ? order.remainingQuantity : order.quantity,
            price: order.price || 0,
            triggerPrice: order.triggerPrice || 0,
            averagePrice: order.averagePrice || 0,
            status: status || order.status,
            rejectionReason,
            version: order.version || 1,
            eventTimestamp: Date.now()
        });

        if (this.faults.emitOutOfOrder) {
            // Delay first event to simulate out-of-order delivery
            setTimeout(() => {
                this.eventEmitter.emit("orderEvent", canonical);
            }, 10);
            return;
        }

        this.eventEmitter.emit("orderEvent", canonical);

        if (this.faults.emitDuplicate) {
            // Immediately re-emit identical event to test deduplication
            this.eventEmitter.emit("orderEvent", canonical);
        }
    }
}

export default MockBrokerAdapter;
