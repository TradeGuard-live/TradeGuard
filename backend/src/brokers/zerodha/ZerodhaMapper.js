/**
 * ZerodhaMapper.js
 * ✅ Maps Zerodha Kite Connect v3 responses to standard TradeGuard position and trade schemas.
 * Official Documentation: https://kite.trade/docs/connect/v3/
 */

/**
 * ✅ Identifies market segment based on exchange and trading symbol
 * @param {string} exchange - e.g. NSE, BSE, NFO, BFO, MCX, CDS
 * @param {string} tradingSymbol - e.g. SBIN, NIFTY25FEB24400CE
 * @returns {"EQUITY" | "OPTIONS" | "FUTURES" | "COMMODITY" | "CURRENCY"}
 */
export const mapZerodhaSegment = (exchange = "", tradingSymbol = "") => {
    const ex = String(exchange || "").toUpperCase().trim();
    const sym = String(tradingSymbol || "").toUpperCase().trim();

    if (ex === "NFO" || ex === "BFO") {
        if (sym.endsWith("CE") || sym.endsWith("PE") || sym.includes("CALL") || sym.includes("PUT")) {
            return "OPTIONS";
        }
        return "FUTURES";
    }

    if (ex === "MCX" || ex.includes("COMMODITY")) {
        return "COMMODITY";
    }

    if (ex === "CDS" || ex === "BCD" || ex.includes("CURRENCY")) {
        return "CURRENCY";
    }

    return "EQUITY";
};

/**
 * ✅ Maps Zerodha margin product types to TradeGuard standard products
 * Kite products: CNC (Cash & Carry), MIS (Intraday), NRML (Normal F&O), MTF (Margin Trading)
 * @param {string} product
 * @returns {"DELIVERY" | "INTRADAY" | "MTF"}
 */
export const mapZerodhaProduct = (product = "") => {
    if (!product) return "INTRADAY";

    const prod = String(product).toUpperCase().trim();
    const productMap = {
        CNC: "DELIVERY",
        MIS: "INTRADAY",
        NRML: "INTRADAY",
        MTF: "MTF",
        BO: "INTRADAY",
        CO: "INTRADAY"
    };

    return productMap[prod] || "INTRADAY";
};

/**
 * ✅ Maps Zerodha order types to TradeGuard standard order types
 * Kite order types: MARKET, LIMIT, SL (Stoploss limit), SL-M (Stoploss market)
 * @param {string} orderType
 * @returns {"MARKET" | "LIMIT" | "SL" | "SL-M"}
 */
export const mapZerodhaOrderType = (orderType = "") => {
    if (!orderType) return "MARKET";

    const norm = String(orderType).toUpperCase().trim();
    if (["LIMIT", "MARKET", "SL", "SL-M"].includes(norm)) {
        return norm;
    }
    if (norm === "STOP_LOSS") return "SL";
    if (norm === "STOP_LOSS_MARKET") return "SL-M";
    return "MARKET";
};

/**
 * ✅ Maps Zerodha net position payload item to TradeGuard position schema
 * @param {Object} pos - Net position item from GET /portfolio/positions
 * @returns {Object} Normalized position object
 */
export const mapZerodhaPosition = (pos) => {
    if (!pos) return null;

    const symbol = pos.tradingsymbol || "UNKNOWN";
    const exchange = pos.exchange || "NSE";
    const quantity = Number(pos.quantity ?? 0);
    const averagePrice = Number(pos.average_price ?? 0);
    const lastPrice = Number(pos.last_price ?? averagePrice);
    const product = mapZerodhaProduct(pos.product);
    const segment = mapZerodhaSegment(exchange, symbol);

    return {
        broker: "ZERODHA",
        symbol,
        exchange,
        instrumentToken: pos.instrument_token || null,
        product,
        segment,
        quantity,
        averagePrice,
        lastPrice,
        closePrice: Number(pos.close_price ?? 0),
        pnl: Number(pos.pnl ?? 0),
        m2m: Number(pos.m2m ?? 0),
        realizedPnL: Number(pos.realised ?? 0),
        unrealizedPnL: Number(pos.unrealised ?? 0),
        buyQty: Number(pos.buy_quantity ?? 0),
        buyAvgPrice: Number(pos.buy_price ?? 0),
        sellQty: Number(pos.sell_quantity ?? 0),
        sellAvgPrice: Number(pos.sell_price ?? 0),
        currentPrice: lastPrice,
        raw: pos
    };
};

/**
 * ✅ Maps Zerodha Demat holding item to TradeGuard holding schema
 * @param {Object} holding - Holding item from GET /portfolio/holdings
 * @returns {Object} Normalized holding object
 */
export const mapZerodhaHolding = (holding) => {
    if (!holding) return null;

    const symbol = holding.tradingsymbol || "UNKNOWN";
    const exchange = holding.exchange || "NSE";
    const quantity = Number(holding.quantity ?? holding.realised_quantity ?? 0);
    const averagePrice = Number(holding.average_price ?? 0);
    const lastPrice = Number(holding.last_price ?? averagePrice);

    return {
        broker: "ZERODHA",
        symbol,
        exchange,
        isin: holding.isin || null,
        instrumentToken: holding.instrument_token || null,
        product: "DELIVERY",
        segment: "EQUITY",
        quantity,
        averagePrice,
        lastPrice,
        closePrice: Number(holding.close_price ?? 0),
        pnl: Number(holding.pnl ?? 0),
        currentPrice: lastPrice,
        raw: holding
    };
};

/**
 * ✅ Maps Zerodha executed trade or completed order into TradeGuard TradeRecord format
 * @param {Object} tradeOrOrder - Trade item from /trades or Order item from /orders
 * @returns {Object} Normalized TradeRecord object
 */
export const mapZerodhaTrade = (tradeOrOrder) => {
    if (!tradeOrOrder) {
        throw new Error("Zerodha trade data is required");
    }

    const tradeId = tradeOrOrder.trade_id || 
        tradeOrOrder.order_id || 
        `ZERODHA-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const symbol = tradeOrOrder.tradingsymbol || "UNKNOWN";
    const exchange = tradeOrOrder.exchange || "NSE";
    const segment = mapZerodhaSegment(exchange, symbol);
    const product = mapZerodhaProduct(tradeOrOrder.product);
    const orderType = mapZerodhaOrderType(tradeOrOrder.order_type);
    const transactionType = String(tradeOrOrder.transaction_type || "BUY").toUpperCase();

    const quantity = Number(
        tradeOrOrder.filled ?? 
        tradeOrOrder.filled_quantity ?? 
        tradeOrOrder.quantity ?? 
        0
    );

    const price = Number(
        tradeOrOrder.average_price ?? 
        tradeOrOrder.price ?? 
        0
    );

    const executedAt = tradeOrOrder.fill_timestamp || 
        tradeOrOrder.exchange_timestamp || 
        tradeOrOrder.order_timestamp || 
        new Date().toISOString();

    return {
        tradeId: String(tradeId),
        orderId: tradeOrOrder.order_id ? String(tradeOrOrder.order_id) : undefined,
        broker: "ZERODHA",
        symbol,
        exchange,
        segment,
        product,
        orderType,
        transactionType,
        quantity,
        price,
        status: tradeOrOrder.status || "COMPLETE",
        orderTimestamp: executedAt,
        executedAt: new Date(executedAt),
        raw: tradeOrOrder
    };
};
