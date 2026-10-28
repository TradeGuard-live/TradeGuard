/**
 * GrowwMapper.js
 * ✅ Maps Groww API v1 response structures to standard TradeGuard position and trade schemas.
 */

export const mapGrowwSegment = (segment, tradingSymbol = "") => {
    const seg = String(segment || "").toUpperCase().trim();
    const sym = String(tradingSymbol || "").toUpperCase().trim();

    if (seg === "FNO" || seg.includes("DERIV")) {
        // Detect Options vs Futures by symbol suffix (e.g., NIFTY24OCT25000CE or PE)
        if (sym.endsWith("CE") || sym.endsWith("PE") || sym.includes("CALL") || sym.includes("PUT")) {
            return "OPTIONS";
        }
        return "FUTURES";
    }

    if (seg === "COMMODITY" || seg.includes("MCX")) {
        return "COMMODITY";
    }

    if (seg === "CURRENCY") {
        return "CURRENCY";
    }

    return "EQUITY";
};

export const mapGrowwProduct = (productType) => {
    if (!productType) return "INTRADAY";

    const prod = String(productType).toUpperCase().trim();
    const productMap = {
        CNC: "DELIVERY",
        MIS: "INTRADAY",
        INTRADAY: "INTRADAY",
        NRML: "INTRADAY",
        NORMAL: "INTRADAY",
        MARGIN: "MTF",
        MTF: "MTF"
    };

    return productMap[prod] || "INTRADAY";
};

export const mapGrowwOrderType = (orderType) => {
    if (!orderType) return "MARKET";

    const norm = String(orderType).toUpperCase().trim();
    if (["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET", "SL", "SL-M"].includes(norm)) {
        if (norm === "STOP_LOSS") return "SL";
        if (norm === "STOP_LOSS_MARKET") return "SL-M";
        return norm;
    }
    return "MARKET";
};

/**
 * ✅ Maps Groww open position object to TradeGuard's position schema
 * @param {Object} pos - Groww position object from /v1/positions/user
 * @returns {Object} Normalized position object
 */
export const mapGrowwPosition = (pos) => {
    if (!pos) return null;

    const symbol = pos.trading_symbol || "UNKNOWN";
    const exchange = pos.exchange || "NSE";
    const quantity = Number(pos.quantity ?? (Number(pos.credit_quantity || 0) - Number(pos.debit_quantity || 0)));
    const averagePrice = Number(pos.net_price ?? pos.average_price ?? 0);
    const product = mapGrowwProduct(pos.product);
    const segment = mapGrowwSegment(pos.segment, symbol);

    return {
        broker: "GROWW",
        symbol,
        exchange,
        isin: pos.symbol_isin || null,
        product,
        segment,
        quantity,
        averagePrice,
        buyQty: Number(pos.credit_quantity || 0),
        buyAvgPrice: Number(pos.credit_price || 0),
        sellQty: Number(pos.debit_quantity || 0),
        sellAvgPrice: Number(pos.debit_price || 0),
        realizedPnL: Number(pos.realised_pnl || 0),
        unrealizedPnL: 0,
        currentPrice: averagePrice,
        raw: pos
    };
};

/**
 * ✅ Maps Groww executed order / trade book item to TradeGuard TradeRecord format
 * @param {Object} order - Groww order object from /v1/order/list or /v1/order/trades
 * @returns {Object} Normalized TradeRecord object
 */
export const mapGrowwTrade = (order) => {
    if (!order) {
        throw new Error("Groww order data is required");
    }

    const tradeId = String(
        order.groww_order_id ||
        order.order_reference_id ||
        `GROWW-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    );

    const orderId = String(
        order.groww_order_id ||
        order.order_reference_id ||
        `ORD-${tradeId}`
    );

    const rawTransactionType = order.transaction_type || order.side || order.type;
    const transactionType = rawTransactionType
        ? String(rawTransactionType).toUpperCase()
        : "BUY";

    const executedPrice = Number(
        order.average_fill_price ??
        order.price ??
        0
    );

    const quantity = Number(
        order.filled_quantity ??
        order.quantity ??
        0
    );

    const symbol = order.trading_symbol || "UNKNOWN";
    const exchange = String(order.exchange || "NSE").toUpperCase();
    const segment = mapGrowwSegment(order.segment, symbol);
    const productType = mapGrowwProduct(order.product);
    const orderType = mapGrowwOrderType(order.order_type);

    let executedAt = new Date();
    if (order.exchange_time) {
        executedAt = new Date(order.exchange_time);
    } else if (order.created_at) {
        executedAt = new Date(order.created_at);
    } else if (order.trade_date) {
        executedAt = new Date(order.trade_date);
    }

    let status = "EXECUTED";
    const rawStatus = String(order.order_status || "").toUpperCase();
    if (rawStatus === "OPEN" || rawStatus === "PENDING") {
        status = "OPEN";
    } else if (rawStatus === "CANCELLED") {
        status = "CANCELLED";
    } else if (rawStatus === "REJECTED" || rawStatus === "FAILURE") {
        status = "REJECTED";
    }

    return {
        tradeId,
        orderId,
        symbol,
        exchange,
        segment,
        transactionType,
        productType,
        orderType,
        quantity,
        price: executedPrice,
        status,
        executedAt,
        broker: "GROWW",
        remarks: order.remark || "Groww Trade API v1 Execution"
    };
};
