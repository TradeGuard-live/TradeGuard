/**
 * CanonicalOrderEvent.js
 * 
 * Normalized representation of order lifecycle events across all brokers.
 * Master and Follower events are converted into this model to decouple the
 * core copy trading engine from vendor-specific payloads.
 */

export class CanonicalOrderEvent {
    constructor({
        broker,
        accountId,
        orderId,
        clientOrderId = null,
        exchange = "NSE",
        segment = "EQUITY",
        symbol,
        instrumentToken = null,
        transactionType, // "BUY" | "SELL"
        orderType = "MARKET", // "MARKET" | "LIMIT" | "SL" | "SL-M"
        productCode = "INTRADAY", // "INTRADAY" | "DELIVERY" | "NORMAL"
        quantity,
        filledQuantity = 0,
        remainingQuantity = null,
        price = 0,
        triggerPrice = 0,
        averagePrice = 0,
        status = "PENDING", // PENDING, SUBMITTED, ACKNOWLEDGED, PARTIALLY_FILLED, FILLED, REJECTED, CANCELLED
        rejectionReason = null,
        eventTimestamp = Date.now(),
        receivedAt = Date.now(),
        version = 1,
        raw = null
    } = {}) {
        if (!broker) throw new Error("CanonicalOrderEvent requires broker");
        if (!accountId) throw new Error("CanonicalOrderEvent requires accountId");
        if (!orderId) throw new Error("CanonicalOrderEvent requires orderId");
        if (!symbol) throw new Error("CanonicalOrderEvent requires symbol");
        if (!transactionType) throw new Error("CanonicalOrderEvent requires transactionType");
        if (quantity == null || quantity <= 0) throw new Error("CanonicalOrderEvent requires positive quantity");

        this.broker = String(broker).toUpperCase();
        this.accountId = String(accountId);
        this.orderId = String(orderId);
        this.clientOrderId = clientOrderId ? String(clientOrderId) : null;
        this.exchange = String(exchange).toUpperCase();
        this.segment = String(segment).toUpperCase();
        this.symbol = String(symbol).toUpperCase().trim();
        this.instrumentToken = instrumentToken ? String(instrumentToken) : null;
        this.transactionType = String(transactionType).toUpperCase();
        this.orderType = String(orderType).toUpperCase();
        this.productCode = String(productCode).toUpperCase();
        
        this.quantity = Number(quantity);
        this.filledQuantity = Number(filledQuantity || 0);
        this.remainingQuantity = remainingQuantity != null 
            ? Number(remainingQuantity) 
            : Math.max(0, this.quantity - this.filledQuantity);
        
        this.price = Number(price || 0);
        this.triggerPrice = Number(triggerPrice || 0);
        this.averagePrice = Number(averagePrice || 0);
        
        this.status = String(status).toUpperCase();
        this.rejectionReason = rejectionReason ? String(rejectionReason) : null;
        
        this.eventTimestamp = Number(eventTimestamp);
        this.receivedAt = Number(receivedAt);
        this.version = Number(version || 1);
        this.raw = raw;
    }

    /**
     * Checks if this event represents an active open order (eligible for modification or cancellation)
     * @returns {boolean}
     */
    isOpen() {
        return ["PENDING", "SUBMITTED", "ACKNOWLEDGED", "PARTIALLY_FILLED"].includes(this.status);
    }

    /**
     * Checks if order has reached a final terminal state
     * @returns {boolean}
     */
    isTerminal() {
        return ["FILLED", "REJECTED", "CANCELLED", "FAILED"].includes(this.status);
    }

    /**
     * Creates a unique versioned event fingerprint
     * @returns {string}
     */
    getFingerprint() {
        return `${this.broker}:${this.accountId}:${this.orderId}:v${this.version}:${this.status}:${this.filledQuantity}`;
    }
}

export default CanonicalOrderEvent;
