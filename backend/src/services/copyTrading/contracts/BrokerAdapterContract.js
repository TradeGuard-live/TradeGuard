/**
 * BrokerAdapterContract.js
 * 
 * Formal interface definition for broker adapters used by TradeGuard's Copy Trading Engine.
 * All broker adapters (Upstox, Zerodha, Kotak Neo, Groww, Dhan, Angel One, Mock) adhere to this contract.
 */

export class IBrokerAdapter {
    /**
     * Broker identifier (e.g. "MOCK", "UPSTOX", "ZERODHA")
     * @returns {string}
     */
    getBroker() {
        throw new Error("getBroker() must be implemented");
    }

    /**
     * Account identifier or client ID
     * @returns {string}
     */
    getAccountId() {
        throw new Error("getAccountId() must be implemented");
    }

    /**
     * Returns broker capabilities declared in BrokerCapabilityRegistry
     * @returns {Object}
     */
    getCapabilities() {
        throw new Error("getCapabilities() must be implemented");
    }

    /**
     * Validates active connection and session credentials
     * @returns {Promise<{ isConnected: boolean, message?: string }>}
     */
    async checkConnection() {
        throw new Error("checkConnection() must be implemented");
    }

    /**
     * Places a new order on the broker
     * @param {Object} params
     * @param {string} params.symbol - Trading symbol (e.g. "RELIANCE")
     * @param {string} params.exchange - Exchange (e.g. "NSE", "BSE")
     * @param {string} params.segment - "EQUITY" | "FUTURES" | "OPTIONS"
     * @param {string} params.transactionType - "BUY" | "SELL"
     * @param {string} params.orderType - "MARKET" | "LIMIT" | "SL" | "SL-M"
     * @param {string} params.productCode - "INTRADAY" | "DELIVERY" | "NORMAL"
     * @param {number} params.quantity - Number of shares or lots
     * @param {number} [params.price=0] - Limit price
     * @param {number} [params.triggerPrice=0] - Stop loss trigger price
     * @param {string} [params.tag] - Internal idempotency / audit tag
     * @returns {Promise<{ success: boolean, orderId: string, status: string, message?: string, raw?: any }>}
     */
    async placeOrder(params) {
        throw new Error("placeOrder() must be implemented");
    }

    /**
     * Modifies an existing open/pending order
     * @param {Object} params
     * @param {string} params.orderId - Broker order ID
     * @param {number} params.quantity - New quantity
     * @param {number} [params.price] - New limit price
     * @param {number} [params.triggerPrice] - New trigger price
     * @param {string} [params.orderType] - New order type
     * @returns {Promise<{ success: boolean, orderId: string, status: string, message?: string, raw?: any }>}
     */
    async modifyOrder(params) {
        throw new Error("modifyOrder() must be implemented");
    }

    /**
     * Cancels an existing open order
     * @param {Object} params
     * @param {string} params.orderId - Broker order ID
     * @returns {Promise<{ success: boolean, orderId: string, status: string, message?: string, raw?: any }>}
     */
    async cancelOrder(params) {
        throw new Error("cancelOrder() must be implemented");
    }

    /**
     * Fetches details of a specific order
     * @param {string} orderId
     * @returns {Promise<Object|null>}
     */
    async getOrder(orderId) {
        throw new Error("getOrder() must be implemented");
    }

    /**
     * Fetches list of all orders for the current day
     * @returns {Promise<Array>}
     */
    async getOrders() {
        throw new Error("getOrders() must be implemented");
    }

    /**
     * Fetches executed trades for the day
     * @returns {Promise<Array>}
     */
    async getTrades() {
        throw new Error("getTrades() must be implemented");
    }

    /**
     * Subscribes to real-time order lifecycle events
     * @param {Function} callback - (canonicalOrderEvent) => void
     * @returns {void}
     */
    subscribeOrderStream(callback) {
        throw new Error("subscribeOrderStream() must be implemented");
    }

    /**
     * Unsubscribes from real-time order lifecycle events
     * @returns {void}
     */
    unsubscribeOrderStream() {
        throw new Error("unsubscribeOrderStream() must be implemented");
    }
}
export default IBrokerAdapter;
