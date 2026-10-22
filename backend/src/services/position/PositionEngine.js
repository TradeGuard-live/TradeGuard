/**
 * PositionEngine.js
 * 
 * Implements the Position Engine as specified:
 * - Broker Orders / Trades -> Position Engine
 * - Buy/Sell FIFO Matching
 * - Open quantity tracking
 * - Partial square-off tracking
 * - Fully squared-off tracking
 * - Open Positions separation for Market Data & P&L Engine
 */

const EPSILON = 0.00000001;

function normalizeSide(side) {
    const s = String(side || "").toUpperCase();
    if (s === "BUY" || s === "B") return "BUY";
    if (s === "SELL" || s === "S") return "SELL";
    return s;
}

function parseNumber(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

function getTradeDate(trade) {
    const d = trade.tradeTime || trade.executedAt || trade.trade_date || trade.createdAt || trade.updatedAt;
    const parsed = d ? new Date(d) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getTradeKey(trade) {
    const brokerAccountId = String(trade.brokerAccountId || "");
    const exchange = String(trade.exchange || "NSE").toUpperCase();
    const segment = String(trade.segment || "EQUITY").toUpperCase();
    const symbol = String(trade.symbol || trade.trading_symbol || trade.scrip_name || "").toUpperCase();
    const productType = String(trade.productType || trade.productCode || trade.product || "INTRADAY").toUpperCase();
    return `${brokerAccountId}|${exchange}|${segment}|${symbol}|${productType}`;
}

export class PositionEngine {
    constructor() {
        this.userPositions = new Map(); // userId -> positions
    }

    /**
     * Matches raw executions in FIFO order and returns all positions with their open/squared status.
     * @param {Array} trades 
     * @returns {Array} positions
     */
    processTrades(trades = []) {
        if (!Array.isArray(trades)) return [];

        // Sort trades chronologically
        const sortedTrades = [...trades].filter(t => {
            const qty = parseNumber(t.quantity);
            const price = parseNumber(t.executedPrice ?? t.brokerResponse?.price ?? t.price);
            return qty > 0 && price >= 0;
        }).sort((a, b) => getTradeDate(a).getTime() - getTradeDate(b).getTime());

        const positionsMap = new Map();

        for (const trade of sortedTrades) {
            const key = getTradeKey(trade);
            const side = normalizeSide(trade.transactionType || trade.transaction_type);
            const quantity = parseNumber(trade.quantity);
            const price = parseNumber(trade.executedPrice ?? trade.brokerResponse?.price ?? trade.price);
            const tradeDate = getTradeDate(trade);
            const tradeId = String(trade.tradeId || trade.trade_id || trade._id || "");
            const symbol = String(trade.symbol || trade.trading_symbol || trade.scrip_name || "").toUpperCase();
            const exchange = String(trade.exchange || "NSE").toUpperCase();
            const segment = String(trade.segment || "EQUITY").toUpperCase();
            const productType = String(trade.productType || trade.productCode || trade.product || "INTRADAY").toUpperCase();
            const instrumentToken = trade.instrumentToken || trade.brokerResponse?.instrument_token || `${exchange}_EQ|${symbol}`;

            if (!positionsMap.has(key)) {
                positionsMap.set(key, {
                    key,
                    brokerAccountId: trade.brokerAccountId || null,
                    symbol,
                    exchange,
                    segment,
                    productType,
                    instrumentToken,
                    totalBuyQuantity: 0,
                    totalSellQuantity: 0,
                    totalBuyValue: 0,
                    totalSellValue: 0,
                    openQuantity: 0,
                    netQuantity: 0,
                    averagePrice: 0,
                    realizedPnL: 0,
                    status: "OPEN", // "OPEN", "PARTIALLY_SQUARED", "FULLY_SQUARED"
                    openLots: [],
                    squaredLots: [],
                    lastTradeDate: tradeDate
                });
            }

            const position = positionsMap.get(key);
            position.lastTradeDate = tradeDate;

            if (side === "BUY") {
                position.totalBuyQuantity += quantity;
                position.totalBuyValue += price * quantity;
            } else {
                position.totalSellQuantity += quantity;
                position.totalSellValue += price * quantity;
            }

            let remainingQuantity = quantity;
            const closingSide = side === "BUY" ? "SHORT" : "LONG";

            // Match against opposing open lots in FIFO queue
            while (
                remainingQuantity > EPSILON &&
                position.openLots.length > 0 &&
                position.openLots[0].side === closingSide
            ) {
                const lot = position.openLots[0];
                const matchedQuantity = Math.min(remainingQuantity, lot.remainingQuantity);

                // Calculate realized P&L for this matched lot
                let lotRealizedPnL = 0;
                if (lot.side === "LONG") {
                    // Closed a long lot by selling
                    lotRealizedPnL = (price - lot.price) * matchedQuantity;
                } else {
                    // Closed a short lot by buying
                    lotRealizedPnL = (lot.price - price) * matchedQuantity;
                }

                position.realizedPnL += lotRealizedPnL;

                // Record squared lot details
                position.squaredLots.push({
                    lotId: lot.tradeId,
                    exitTradeId: tradeId,
                    side: lot.side,
                    entryPrice: lot.price,
                    exitPrice: price,
                    quantity: matchedQuantity,
                    realizedPnL: Math.round((lotRealizedPnL + Number.EPSILON) * 100) / 100,
                    entryDate: lot.tradeDate,
                    exitDate: tradeDate
                });

                lot.remainingQuantity -= matchedQuantity;
                remainingQuantity -= matchedQuantity;

                if (lot.remainingQuantity <= EPSILON) {
                    position.openLots.shift(); // fully squared this lot
                }
            }

            // Any remaining quantity opens a new lot in this trade's direction
            if (remainingQuantity > EPSILON) {
                position.openLots.push({
                    tradeId,
                    side: side === "BUY" ? "LONG" : "SHORT",
                    price,
                    initialQuantity: remainingQuantity,
                    remainingQuantity,
                    tradeDate
                });
            }

            // Recalculate net quantity & average entry price of open lots
            const netQty = position.openLots.reduce((acc, lot) => {
                return acc + (lot.side === "LONG" ? lot.remainingQuantity : -lot.remainingQuantity);
            }, 0);

            const openQty = position.openLots.reduce((acc, lot) => acc + lot.remainingQuantity, 0);

            const weightedOpenValue = position.openLots.reduce((acc, lot) => {
                return acc + lot.price * lot.remainingQuantity;
            }, 0);

            position.netQuantity = Math.round((netQty + Number.EPSILON) * 10000) / 10000;
            position.openQuantity = Math.round((openQty + Number.EPSILON) * 10000) / 10000;
            position.averagePrice = openQty > EPSILON
                ? Math.round(((weightedOpenValue / openQty) + Number.EPSILON) * 100) / 100
                : 0;

            // Determine Position Status
            if (position.openQuantity <= EPSILON) {
                position.status = "FULLY_SQUARED";
                position.side = "FLAT";
            } else if (position.squaredLots.length > 0) {
                position.status = "PARTIALLY_SQUARED";
                position.side = position.netQuantity > 0 ? "BUY" : "SELL";
            } else {
                position.status = "OPEN";
                position.side = position.netQuantity > 0 ? "BUY" : "SELL";
            }
        }

        return Array.from(positionsMap.values());
    }

    /**
     * Filters for active open positions only (OPEN or PARTIALLY_SQUARED with openQuantity > 0).
     * @param {Array} trades 
     * @returns {Array} openPositions
     */
    getOpenPositions(trades = []) {
        const all = this.processTrades(trades);
        return all.filter(p => p.openQuantity > EPSILON);
    }

    /**
     * Filters for fully squared positions (historical closed round-trips).
     * @param {Array} trades 
     * @returns {Array} fullySquaredPositions
     */
    getFullySquaredPositions(trades = []) {
        const all = this.processTrades(trades);
        return all.filter(p => p.status === "FULLY_SQUARED");
    }

    /**
     * Reconciles matched trade positions with Upstox /portfolio/short-term-positions if present.
     * @param {Array} computedPositions 
     * @param {Array} brokerPositions (from Upstox API)
     * @returns {Array} reconciledPositions
     */
    reconcileWithBrokerPositions(computedPositions, brokerPositions = []) {
        if (!Array.isArray(brokerPositions) || brokerPositions.length === 0) {
            return computedPositions;
        }

        const reconciled = [...computedPositions];
        const computedMap = new Map();
        reconciled.forEach(p => computedMap.set(p.symbol, p));

        for (const bp of brokerPositions) {
            const sym = String(bp.trading_symbol || bp.symbol || "").toUpperCase();
            const existing = computedMap.get(sym);

            if (existing) {
                // Enrich with exact broker instrument token & live price
                if (bp.instrument_token) existing.instrumentToken = bp.instrument_token;
                if (bp.last_price) existing.lastBrokerPrice = Number(bp.last_price);
                if (bp.quantity !== undefined && Number(bp.quantity) !== 0) {
                    existing.brokerQuantity = Number(bp.quantity);
                }
            } else {
                // Broker has a position that wasn't in trade records (e.g. carry-forward/pre-existing)
                const qty = Number(bp.quantity || 0);
                if (qty !== 0) {
                    const side = qty > 0 ? "BUY" : "SELL";
                    reconciled.push({
                        key: `BROKER|${bp.instrument_token || sym}`,
                        brokerAccountId: null,
                        symbol: sym,
                        exchange: bp.exchange || "NSE",
                        segment: bp.segment || "EQUITY",
                        productType: bp.product || "INTRADAY",
                        instrumentToken: bp.instrument_token || `NSE_EQ|${sym}`,
                        totalBuyQuantity: qty > 0 ? Math.abs(qty) : 0,
                        totalSellQuantity: qty < 0 ? Math.abs(qty) : 0,
                        totalBuyValue: 0,
                        totalSellValue: 0,
                        openQuantity: Math.abs(qty),
                        netQuantity: qty,
                        averagePrice: Number(bp.average_price || bp.buy_price || bp.sell_price || 0),
                        realizedPnL: Number(bp.realised || bp.realized_pnl || 0),
                        status: "OPEN",
                        side,
                        openLots: [{
                            tradeId: "BROKER_SYNC",
                            side: qty > 0 ? "LONG" : "SHORT",
                            price: Number(bp.average_price || 0),
                            initialQuantity: Math.abs(qty),
                            remainingQuantity: Math.abs(qty),
                            tradeDate: new Date()
                        }],
                        squaredLots: [],
                        lastTradeDate: new Date(),
                        lastBrokerPrice: Number(bp.last_price || 0)
                    });
                }
            }
        }

        return reconciled;
    }
}

export default new PositionEngine();
