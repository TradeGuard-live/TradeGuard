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

import upstoxInstrumentService from "../marketData/upstoxInstrumentService.js";

const EPSILON = 0.00000001;

function normalizeSide(side) {
    const s = String(side || "").toUpperCase().trim();
    if (s === "BUY" || s === "B") return "BUY";
    if (s === "SELL" || s === "S") return "SELL";
    return s;
}

function normalizeProduct(prod = "") {
    const p = String(prod || "").toUpperCase().trim();
    if (p === "MIS" || p === "INTRADAY" || p === "BO" || p === "CO") return "INTRADAY";
    if (p === "CNC" || p === "DELIVERY") return "DELIVERY";
    if (p === "NRML" || p === "CARRYFORWARD" || p === "MARGIN" || p === "MTF") return "CARRYFORWARD";
    return p || "INTRADAY";
}

function normalizeSymbol(symbol = "") {
    let s = String(symbol || "").toUpperCase().trim();
    // Strip broker exchange prefixes like NSE_EQ|, BSE_EQ|, NSE:, BSE:
    s = s.replace(/^(NSE_EQ|BSE_EQ|NSE|BSE)[|:]/i, "");
    // Strip common broker exchange series suffixes (-EQ, .NSE, .BSE, -BE, -BL)
    s = s.replace(/(-EQ|\.NSE|\.BSE|-BE|-BL)$/i, "");
    // Normalize spaces within symbol names (e.g. "TATA STEEL" -> "TATASTEEL")
    s = s.replace(/\s+/g, "");
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
    const segment = String(trade.segment || "EQUITY").toUpperCase();
    const symbol = normalizeSymbol(trade.symbol || trade.trading_symbol || trade.scrip_name || "");
    const productType = normalizeProduct(trade.productType || trade.productCode || trade.product);
    // In Indian markets, cash equities (EQUITY) settle Demat shares fungibly across NSE and BSE within an account.
    // Derivatives (F&O, COMMODITY, CURRENCY) remain strictly exchange-specific.
    const isEquity = segment === "EQUITY" || (!segment.includes("FO") && !segment.includes("FUT") && !segment.includes("OPT") && !segment.includes("COMM") && !segment.includes("CURR"));
    const exchange = isEquity ? "EQ" : String(trade.exchange || "NSE").toUpperCase();
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

        const activePositionsMap = new Map();
        const completedPositions = [];

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
            // ✅ Resolve canonical instrument key using Upstox instrument service
            const instrumentToken = trade.instrumentToken ||
                                    trade.instrument_token ||
                                    trade.instrument_key ||
                                    trade.brokerResponse?.instrument_token ||
                                    trade.brokerResponse?.instrument_key ||
                                    upstoxInstrumentService.resolveInstrumentKey({ symbol, exchange, segment }) ||
                                    `${exchange}_EQ|${symbol}`;

            if (instrumentToken && instrumentToken.includes("|")) {
                upstoxInstrumentService.registerInstrument(exchange, symbol, instrumentToken);
            }

            if (!activePositionsMap.has(key)) {
                activePositionsMap.set(key, {
                    key,
                    brokerAccountId: trade.brokerAccountId || null,
                    broker: trade.broker || null,
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

            const position = activePositionsMap.get(key);
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

            // Enhanced Position Metrics
            const totalBuyQty = position.totalBuyQuantity;
            const totalSellQty = position.totalSellQuantity;
            position.avgBuyPrice = totalBuyQty > 0 ? Math.round((position.totalBuyValue / totalBuyQty) * 100) / 100 : 0;
            position.avgSellPrice = totalSellQty > 0 ? Math.round((position.totalSellValue / totalSellQty) * 100) / 100 : 0;
            position.totalTurnover = Math.round((position.totalBuyValue + position.totalSellValue) * 100) / 100;
            position.openValue = Math.round(position.openQuantity * position.averagePrice * 100) / 100;

            // Breakeven price calculation (including ~0.15% roundtrip tax & charges estimate)
            if (position.openQuantity > EPSILON && position.averagePrice > 0) {
                const chargeBuffer = 0.0015;
                if (position.netQuantity > 0) {
                    position.breakEvenPrice = Math.round(position.averagePrice * (1 + chargeBuffer) * 100) / 100;
                } else {
                    position.breakEvenPrice = Math.round(position.averagePrice * (1 - chargeBuffer) * 100) / 100;
                }
            } else {
                position.breakEvenPrice = 0;
            }

            // Win/Loss statistics on squared round-trip lots
            const winLots = position.squaredLots.filter(l => l.realizedPnL > 0);
            const lossLots = position.squaredLots.filter(l => l.realizedPnL < 0);
            position.winTradesCount = winLots.length;
            position.lossTradesCount = lossLots.length;
            position.totalSquaredTrades = position.squaredLots.length;
            position.winRate = position.squaredLots.length > 0
                ? Math.round((winLots.length / position.squaredLots.length) * 100)
                : 0;

            // Determine Position Status & Lifecycle
            if (position.openQuantity <= EPSILON) {
                position.status = "FULLY_SQUARED";
                position.side = "FLAT";
                position.openQuantity = 0;
                position.netQuantity = 0;
                position.averagePrice = 0;
                position.openLots = [];
                position.realizedPnL = Math.round((position.realizedPnL + Number.EPSILON) * 100) / 100;
                position.closeDate = tradeDate;

                // Archive this completed cycle
                completedPositions.push({ ...position });

                // Remove from active positions so future trades for this symbol start a fresh cycle
                activePositionsMap.delete(key);
            } else if (position.squaredLots.length > 0) {
                position.status = "PARTIALLY_SQUARED";
                position.side = position.netQuantity > 0 ? "BUY" : "SELL";
                position.realizedPnL = Math.round((position.realizedPnL + Number.EPSILON) * 100) / 100;
            } else {
                position.status = "OPEN";
                position.side = position.netQuantity > 0 ? "BUY" : "SELL";
                position.realizedPnL = 0;
            }
        }

        return [...Array.from(activePositionsMap.values()), ...completedPositions];
    }

    /**
     * Filters for active open positions only (OPEN or PARTIALLY_SQUARED with openQuantity > 0).
     * @param {Array} trades 
     * @returns {Array} openPositions
     */
    getOpenPositions(trades = []) {
        const all = this.processTrades(trades);
        return all.filter(p => p.openQuantity > EPSILON && p.status !== "FULLY_SQUARED");
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
     * Reconciles matched trade positions with Upstox / Angel One / Dhan / Kotak Neo positions.
     * When a broker reports netQuantity === 0 or position is closed, it squares the position
     * and filters it out so it never lingers in open positions.
     * 
     * @param {Array} computedPositions 
     * @param {Array} brokerPositions (from broker API)
     * @returns {Array} reconciledOpenPositions
     */
    reconcileWithBrokerPositions(computedPositions, brokerPositions = []) {
        if (!Array.isArray(brokerPositions) || brokerPositions.length === 0) {
            return computedPositions;
        }

        const reconciled = [...computedPositions];
        const computedMap = new Map();
        reconciled.forEach(p => {
            computedMap.set(p.symbol, p);
            computedMap.set(normalizeSymbol(p.symbol), p);
        });

        for (const bp of brokerPositions) {
            const rawSym = String(bp.trading_symbol || bp.tradingsymbol || bp.symbol || bp.trdSym || bp.securityId || "").toUpperCase();
            const cleanSym = normalizeSymbol(rawSym);
            const existing = computedMap.get(cleanSym) || computedMap.get(rawSym);

            const brokerToken = bp.instrumentToken || bp.instrument_token || bp.instrument_key || bp.brokerResponse?.instrument_token || bp.brokerResponse?.instrument_key;
            const brokerPrice = Number(bp.lastPrice ?? bp.last_price ?? bp.brokerResponse?.last_price ?? 0);
            const avgPrice = Number(bp.averagePrice ?? bp.average_price ?? bp.buy_price ?? bp.brokerResponse?.average_price ?? bp.brokerResponse?.buy_price ?? 0);
            const brokerQty = Number(bp.netQuantity ?? bp.quantity ?? bp.net_quantity ?? bp.netQty ?? bp.qty ?? 0);
            const isBrokerClosed = brokerQty === 0 || bp.status === "CLOSED" || bp.status === "FULLY_SQUARED";

            if (existing) {
                // Enrich with exact broker instrument token & live price
                if (brokerToken) {
                    existing.instrumentToken = brokerToken;
                    upstoxInstrumentService.registerInstrument(existing.exchange || "NSE", existing.symbol, brokerToken);
                }
                if (bp.securityId) {
                    existing.securityId = String(bp.securityId);
                }
                if (bp.broker) {
                    existing.broker = bp.broker;
                }
                if (bp.brokerAccountId) {
                    existing.brokerAccountId = bp.brokerAccountId;
                }
                if (brokerPrice > 0) {
                    existing.lastBrokerPrice = brokerPrice;
                    existing.lastPrice = brokerPrice;
                }
                if ((!existing.averagePrice || existing.averagePrice <= 0) && avgPrice > 0) {
                    existing.averagePrice = avgPrice;
                }

                if (isBrokerClosed) {
                    existing.openQuantity = 0;
                    existing.netQuantity = 0;
                    existing.brokerQuantity = 0;
                    existing.status = "FULLY_SQUARED";
                    const realized = Number(bp.realizedPnL ?? bp.realised_profit ?? bp.realised ?? bp.pnl);
                    if (!Number.isNaN(realized) && realized !== 0) {
                        existing.realizedPnL = Math.round((realized + Number.EPSILON) * 100) / 100;
                    }
                } else {
                    existing.brokerQuantity = brokerQty;
                    existing.openQuantity = Math.abs(brokerQty);
                    existing.netQuantity = brokerQty;
                    existing.side = brokerQty > 0 ? "BUY" : "SELL";
                    if (existing.squaredLots && existing.squaredLots.length > 0) {
                        existing.status = "PARTIALLY_SQUARED";
                    } else {
                        existing.status = "OPEN";
                        existing.realizedPnL = 0;
                    }
                }
            } else if (!isBrokerClosed && brokerQty !== 0) {
                // Broker has a position that wasn't in trade records (e.g. carry-forward/pre-existing)
                const qty = brokerQty;
                const sym = cleanSym || rawSym || "UNKNOWN";
                const ex = String(bp.exchange || "NSE").toUpperCase();
                const side = qty > 0 ? "BUY" : "SELL";
                const resolvedToken = brokerToken || upstoxInstrumentService.resolveInstrumentKey({ symbol: sym, exchange: ex }) || `${ex}_EQ|${sym}`;
                upstoxInstrumentService.registerInstrument(ex, sym, resolvedToken);

                const effectiveAvgPrice = avgPrice > 0 ? avgPrice : (brokerPrice > 0 ? brokerPrice : 0);

                reconciled.push({
                    key: `BROKER|${resolvedToken}`,
                    brokerAccountId: bp.brokerAccountId || null,
                    broker: bp.broker || bp.brokerName || null,
                    symbol: sym,
                    exchange: ex,
                    segment: bp.segment || "EQUITY",
                    productType: bp.productType || bp.productCode || bp.product || "INTRADAY",
                    instrumentToken: resolvedToken,
                    securityId: bp.securityId ? String(bp.securityId) : undefined,
                    totalBuyQuantity: qty > 0 ? Math.abs(qty) : 0,
                    totalSellQuantity: qty < 0 ? Math.abs(qty) : 0,
                    totalBuyValue: effectiveAvgPrice * Math.abs(qty),
                    totalSellValue: 0,
                    openQuantity: Math.abs(qty),
                    netQuantity: qty,
                    averagePrice: effectiveAvgPrice,
                    realizedPnL: 0,
                    status: "OPEN",
                    side,
                    openLots: [{
                        tradeId: "BROKER_SYNC",
                        side: qty > 0 ? "LONG" : "SHORT",
                        price: effectiveAvgPrice,
                        initialQuantity: Math.abs(qty),
                        remainingQuantity: Math.abs(qty),
                        tradeDate: new Date()
                    }],
                    squaredLots: [],
                    lastTradeDate: new Date(),
                    lastBrokerPrice: brokerPrice,
                    lastPrice: brokerPrice
                });
            }
        }

        // Drop any fully squared or zero-quantity positions so they never linger in open positions
        return reconciled.filter(p => p.openQuantity > EPSILON && p.status !== "FULLY_SQUARED" && p.status !== "CLOSED");
    }
}

export default new PositionEngine();
