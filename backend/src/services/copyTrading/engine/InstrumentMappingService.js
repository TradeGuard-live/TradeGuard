/**
 * InstrumentMappingService.js
 * 
 * Maps instruments, symbols, and contract specifications across brokers.
 * Normalizes exchange formats (NSE, BSE, NFO, BFO, MCX) and provides
 * standard contract lot sizes for Indian derivative contracts.
 */

// Known standard lot sizes for Indian F&O contracts
export const DERIVATIVE_LOT_SIZES = {
    NIFTY: 25,
    BANKNIFTY: 15,
    FINNIFTY: 25,
    MIDCPNIFTY: 50,
    RELIANCE: 250,
    TCS: 175,
    HDFCBANK: 550,
    INFY: 400,
    ICICIBANK: 700,
    SBIN: 750,
    TATAMOTORS: 575
};

export class InstrumentMappingService {
    constructor() {
        this.tokenRegistries = new Map(); // "BROKER:SYMBOL" -> token
    }

    /**
     * Resolves the lot size for a given symbol and segment
     * @param {string} symbol
     * @param {string} segment - "EQUITY" | "FUTURES" | "OPTIONS"
     * @returns {number} Lot size (1 for Equity, contract size for F&O)
     */
    getLotSize(symbol, segment = "EQUITY") {
        const seg = String(segment || "EQUITY").toUpperCase();
        if (seg === "EQUITY") return 1;

        const sym = String(symbol || "").toUpperCase().trim();
        // Extract underlying symbol (e.g. "NIFTY26OCT24500CE" -> "NIFTY")
        for (const [underlying, lot] of Object.entries(DERIVATIVE_LOT_SIZES)) {
            if (sym.startsWith(underlying)) {
                return lot;
            }
        }
        return 1;
    }

    /**
     * Normalizes exchange and segment identifier across brokers
     * @param {string} exchange
     * @param {string} segment
     * @param {string} targetBroker
     * @returns {{ exchange: string, segment: string }}
     */
    normalizeExchange(exchange, segment, targetBroker) {
        const ex = String(exchange || "NSE").toUpperCase();
        const seg = String(segment || "EQUITY").toUpperCase();

        if (targetBroker === "ZERODHA") {
            if (seg === "FUTURES" || seg === "OPTIONS") {
                return { exchange: ex === "BSE" ? "BFO" : "NFO", segment: seg };
            }
            return { exchange: ex, segment: seg };
        }

        if (targetBroker === "UPSTOX") {
            return { exchange: ex, segment: seg };
        }

        return { exchange: ex, segment: seg };
    }

    /**
     * Maps product code across brokers
     * @param {string} productCode - "INTRADAY", "DELIVERY", "NORMAL"
     * @param {string} targetBroker - "UPSTOX", "ZERODHA", "KOTAK_NEO", "MOCK"
     * @returns {string} Broker-specific product code
     */
    mapProductCode(productCode, targetBroker) {
        const p = String(productCode || "INTRADAY").toUpperCase();

        if (targetBroker === "ZERODHA") {
            if (p === "DELIVERY" || p === "CNC") return "CNC";
            if (p === "NORMAL" || p === "NRML") return "NRML";
            return "MIS"; // Default intraday
        }

        if (targetBroker === "UPSTOX") {
            if (p === "DELIVERY" || p === "D" || p === "CNC") return "D";
            return "I"; // Intraday
        }

        if (targetBroker === "KOTAK_NEO") {
            if (p === "DELIVERY" || p === "CNC") return "CNC";
            if (p === "NORMAL" || p === "NRML") return "NRML";
            return "MIS";
        }

        return p;
    }
}

export const instrumentMappingService = new InstrumentMappingService();
export default instrumentMappingService;
