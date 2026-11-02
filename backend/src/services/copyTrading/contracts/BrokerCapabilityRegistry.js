/**
 * BrokerCapabilityRegistry.js
 * 
 * Central registry declaring the exact operational capabilities for each supported broker.
 * The Copy Policy & Risk engines query this registry to prevent attempting unsupported operations.
 */

export const BROKER_CAPABILITIES = {
    MOCK: {
        broker: "MOCK",
        supportsStreamingOrders: true,
        supportsOrderPlacement: true,
        supportsOrderModification: true,
        supportsOrderCancellation: true,
        supportsMarketOrders: true,
        supportsLimitOrders: true,
        supportsStopLoss: true,
        supportsStopLossMarket: true,
        supportsFAndO: true,
        supportsAMO: true,
        supportedProducts: ["INTRADAY", "DELIVERY", "NORMAL", "MIS", "CNC", "NRML"],
        supportedSegments: ["EQUITY", "FUTURES", "OPTIONS"],
        supportedOrderTypes: ["MARKET", "LIMIT", "SL", "SL-M"],
        hasIdempotencyKey: true,
        rateLimitPerSecond: 100,
        description: "Deterministic in-memory mock broker for testing and simulation"
    },
    UPSTOX: {
        broker: "UPSTOX",
        supportsStreamingOrders: true,
        supportsOrderPlacement: true,
        supportsOrderModification: true,
        supportsOrderCancellation: true,
        supportsMarketOrders: true,
        supportsLimitOrders: true,
        supportsStopLoss: true,
        supportsStopLossMarket: true,
        supportsFAndO: true,
        supportsAMO: true,
        supportedProducts: ["INTRADAY", "DELIVERY", "NORMAL", "MIS", "CNC", "NRML"],
        supportedSegments: ["EQUITY", "FUTURES", "OPTIONS"],
        supportedOrderTypes: ["MARKET", "LIMIT", "SL", "SL-M"],
        hasIdempotencyKey: false,
        rateLimitPerSecond: 10,
        description: "Official Upstox API v2 integration"
    },
    ZERODHA: {
        broker: "ZERODHA",
        supportsStreamingOrders: true,
        supportsOrderPlacement: true,
        supportsOrderModification: true,
        supportsOrderCancellation: true,
        supportsMarketOrders: true,
        supportsLimitOrders: true,
        supportsStopLoss: true,
        supportsStopLossMarket: true,
        supportsFAndO: true,
        supportsAMO: true,
        supportedProducts: ["INTRADAY", "DELIVERY", "NORMAL", "MIS", "CNC", "NRML"],
        supportedSegments: ["EQUITY", "FUTURES", "OPTIONS"],
        supportedOrderTypes: ["MARKET", "LIMIT", "SL", "SL-M"],
        hasIdempotencyKey: true, // Zerodha supports tag param
        rateLimitPerSecond: 10,
        description: "Official Zerodha Kite Connect v3 integration"
    },
    KOTAK_NEO: {
        broker: "KOTAK_NEO",
        supportsStreamingOrders: false,
        supportsOrderPlacement: true,
        supportsOrderModification: true,
        supportsOrderCancellation: true,
        supportsMarketOrders: true,
        supportsLimitOrders: true,
        supportsStopLoss: true,
        supportsStopLossMarket: true,
        supportsFAndO: true,
        supportsAMO: true,
        supportedProducts: ["INTRADAY", "DELIVERY", "NORMAL", "MIS", "CNC", "NRML"],
        supportedSegments: ["EQUITY", "FUTURES", "OPTIONS"],
        supportedOrderTypes: ["MARKET", "LIMIT", "SL", "SL-M"],
        hasIdempotencyKey: false,
        rateLimitPerSecond: 5,
        description: "Kotak Neo Quick Order API integration"
    },
    GROWW: {
        broker: "GROWW",
        supportsStreamingOrders: false,
        supportsOrderPlacement: false, // Groww public API currently supports data/portfolio read & reconciliation
        supportsOrderModification: false,
        supportsOrderCancellation: false,
        supportsMarketOrders: false,
        supportsLimitOrders: false,
        supportsStopLoss: false,
        supportsStopLossMarket: false,
        supportsFAndO: false,
        supportsAMO: false,
        supportedProducts: ["DELIVERY", "INTRADAY"],
        supportedSegments: ["EQUITY"],
        supportedOrderTypes: ["MARKET"],
        hasIdempotencyKey: false,
        rateLimitPerSecond: 5,
        description: "Groww API integration (Portfolio & trade reconciliation only)"
    },
    DHAN: {
        broker: "DHAN",
        supportsStreamingOrders: true,
        supportsOrderPlacement: true,
        supportsOrderModification: true,
        supportsOrderCancellation: true,
        supportsMarketOrders: true,
        supportsLimitOrders: true,
        supportsStopLoss: true,
        supportsStopLossMarket: true,
        supportsFAndO: true,
        supportsAMO: true,
        supportedProducts: ["INTRADAY", "DELIVERY", "CNC", "NORMAL"],
        supportedSegments: ["EQUITY", "FUTURES", "OPTIONS"],
        supportedOrderTypes: ["MARKET", "LIMIT", "SL", "SL-M"],
        hasIdempotencyKey: true,
        rateLimitPerSecond: 10,
        description: "Official DhanHQ API v2 integration"
    },
    ANGEL_ONE: {
        broker: "ANGEL_ONE",
        supportsStreamingOrders: false,
        supportsOrderPlacement: false,
        supportsOrderModification: false,
        supportsOrderCancellation: false,
        supportsMarketOrders: false,
        supportsLimitOrders: false,
        supportsStopLoss: false,
        supportsStopLossMarket: false,
        supportsFAndO: false,
        supportsAMO: false,
        supportedProducts: ["INTRADAY", "DELIVERY"],
        supportedSegments: ["EQUITY"],
        supportedOrderTypes: ["MARKET"],
        hasIdempotencyKey: false,
        rateLimitPerSecond: 5,
        description: "Angel One API integration (Reconciliation only)"
    }
};

/**
 * Retrieves capabilities for a given broker identifier
 * @param {string} broker
 * @returns {Object}
 */
export function getBrokerCapabilities(broker) {
    const key = String(broker || "").toUpperCase().trim();
    return BROKER_CAPABILITIES[key] || {
        broker: key,
        supportsStreamingOrders: false,
        supportsOrderPlacement: false,
        supportsOrderModification: false,
        supportsOrderCancellation: false,
        supportsMarketOrders: false,
        supportsLimitOrders: false,
        supportsStopLoss: false,
        supportsStopLossMarket: false,
        supportsFAndO: false,
        supportsAMO: false,
        supportedProducts: [],
        supportedSegments: [],
        supportedOrderTypes: [],
        hasIdempotencyKey: false,
        rateLimitPerSecond: 1,
        description: "Unknown broker"
    };
}

export default {
    BROKER_CAPABILITIES,
    getBrokerCapabilities
};
