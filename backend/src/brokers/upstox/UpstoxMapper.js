// ======================================================
// MAP UPSTOX SEGMENT
// ======================================================

const mapUpstoxSegment = (segment) => {
    if (!segment) return undefined;

    const segmentMap = {
        EQ: "EQUITY",
        "F&O": "FUTURES",
        FO: "FUTURES",
        OP: "OPTIONS",
        CUR: "CURRENCY",
        CD: "COMMODITY",
    };

    const normalized = String(segment).toUpperCase();

    return segmentMap[normalized] || undefined;
};


// ======================================================
// MAP UPSTOX PRODUCT
// ======================================================

const mapUpstoxProduct = (product) => {
    if (!product) return undefined;

    const productMap = {
        I: "INTRADAY",
        D: "DELIVERY",
        CO: "COVER_ORDER",
        MTF: "MTF",
    };

    const normalized = String(product).toUpperCase();

    return productMap[normalized] || undefined;
};


// ======================================================
// MAP ORDER TYPE
// ======================================================

const mapUpstoxOrderType = (orderType) => {
    if (!orderType) return "MARKET";

    const normalized = String(orderType).toUpperCase();

    const validOrderTypes = [
        "MARKET",
        "LIMIT",
        "SL",
        "SL-M",
    ];

    return validOrderTypes.includes(normalized)
        ? normalized
        : "MARKET";
};


// ======================================================
// MAP INSTRUMENT SEGMENT
//
// Prefer explicit instrument type because a generic
// FO segment cannot distinguish futures from options.
// ======================================================

const mapUpstoxInstrumentSegment = (trade) => {
    const instrumentType = String(
        trade.instrument_type ||
        trade.instrumentType ||
        trade.instrument_type_name ||
        ""
    ).toUpperCase();

    if (
        [
            "CE",
            "PE",
            "OPTIDX",
            "OPTSTK",
            "OPTIONS",
            "OPTION",
        ].includes(instrumentType)
    ) {
        return "OPTIONS";
    }

    if (
        [
            "FUT",
            "FUTIDX",
            "FUTSTK",
            "FUTURES",
            "FUTURE",
        ].includes(instrumentType)
    ) {
        return "FUTURES";
    }

    const mappedSegment = mapUpstoxSegment(trade.segment);

    const symbol = String(
        trade.trading_symbol ||
        trade.symbol ||
        trade.scrip_name ||
        ""
    ).toUpperCase();

    // A generic F&O segment may represent an option.
    // Check common option suffixes in the symbol.
    if (
        mappedSegment === "FUTURES" &&
        /\b(CE|PE)\b/.test(symbol)
    ) {
        return "OPTIONS";
    }

    return mappedSegment;
};


// ======================================================
// MAP TRADE
//
// Supports:
// 1. Historical Trades API
// 2. Get Trades For Day API
// ======================================================

const mapUpstoxTrade = (trade) => {
    if (!trade) {
        throw new Error("Upstox trade data is required");
    }

    if (
        trade.trade_id === undefined ||
        trade.trade_id === null ||
        String(trade.trade_id).trim() === ""
    ) {
        throw new Error("Upstox trade does not contain trade ID");
    }

    const rawTransactionType = trade.transaction_type;

    const transactionType = rawTransactionType
        ? String(rawTransactionType).toUpperCase()
        : undefined;

    const rawPrice =
        trade.price ??
        trade.average_price ??
        trade.averagePrice;

    const executedPrice =
        rawPrice !== undefined && rawPrice !== null
            ? Number(rawPrice)
            : 0;

    return {
        // Unique execution/trade ID
        tradeId: String(trade.trade_id),

        // Historical API may not provide order_id.
        // Current-day API may provide it. Fallback to ORD-<trade_id>.
        orderId:
            trade.order_id !== undefined &&
            trade.order_id !== null &&
            String(trade.order_id).trim() !== ""
                ? String(trade.order_id)
                : `ORD-${trade.trade_id}`,

        broker: "UPSTOX",

        // Historical API:
        // symbol / scrip_name
        //
        // Current-day API:
        // trading_symbol
        symbol:
            trade.trading_symbol ||
            trade.symbol ||
            trade.scrip_name ||
            null,

        // ✅ Preserve canonical exchange and instrument token for accurate quote mapping
        exchange: String(trade.exchange || "NSE").toUpperCase(),
        instrumentToken: trade.instrument_token || trade.instrumentToken || trade.instrument_key || null,

        transactionType,

        quantity: Number(trade.quantity || 0),

        // Keep the TradeGuard field used by the trade model
        // and analytics.
        executedPrice,

        status: "COMPLETE",

        orderType: mapUpstoxOrderType(
            trade.order_type || trade.orderType
        ),

        segment: mapUpstoxInstrumentSegment(trade),

        productCode: mapUpstoxProduct(trade.product),

        tradeTime: trade.trade_date
            ? new Date(trade.trade_date)
            : trade.exchange_timestamp
            ? new Date(trade.exchange_timestamp)
            : trade.timestamp
            ? new Date(trade.timestamp)
            : null,

        // Preserve the original broker payload for debugging
        // and future field mapping.
        brokerResponse: trade,
    };
};

// ======================================================
// MAP POSITION (Upstox /portfolio/short-term-positions)
// ======================================================
const mapUpstoxPosition = (pos) => {
    if (!pos) return null;

    const symbol = pos.trading_symbol || pos.tradingsymbol || pos.symbol || null;
    const exchange = String(pos.exchange || "NSE").toUpperCase();
    const segment = mapUpstoxInstrumentSegment(pos) || (pos.segment ? mapUpstoxSegment(pos.segment) : "EQUITY");
    const productType = mapUpstoxProduct(pos.product) || "INTRADAY";
    const instrumentToken = pos.instrument_token || `${exchange}_EQ|${symbol}`;
    const qty = Number(pos.quantity || 0);

    return {
        // ✅ Normalized Upstox position representation
        symbol,
        exchange,
        segment,
        productType,
        instrumentToken,
        quantity: qty,
        netQuantity: qty,
        averagePrice: Number(pos.average_price || pos.buy_price || 0),
        lastPrice: Number(pos.last_price || 0),
        closePrice: Number(pos.close_price || 0),
        realizedPnL: Number(pos.realised || 0),
        unrealizedPnL: Number(pos.unrealised || 0),
        pnl: Number(pos.pnl || 0),
        brokerResponse: pos
    };
};


// ======================================================
// MAP ORDER
// Used by Portfolio WebSocket
// ======================================================

const mapUpstoxOrder = (order) => {
    if (!order) {
        throw new Error("Upstox order data is required");
    }

    const rawTransactionType = order.transaction_type;

    return {
        broker: "UPSTOX",

        orderId:
            order.order_id !== undefined &&
            order.order_id !== null
                ? String(order.order_id)
                : null,

        symbol:
            order.trading_symbol ||
            order.symbol ||
            null,

        transactionType: rawTransactionType
            ? String(rawTransactionType).toUpperCase()
            : undefined,

        quantity: Number(order.quantity || 0),

        executedPrice: Number(
            order.average_price ??
            order.price ??
            0
        ),

        orderType: mapUpstoxOrderType(
            order.order_type || order.orderType
        ),

        status: mapUpstoxOrderStatus(order.status),

        brokerResponse: order,
    };
};


// ======================================================
// MAP ORDER STATUS
// ======================================================

const mapUpstoxOrderStatus = (status) => {
    if (!status) {
        return undefined;
    }

    const statusMap = {
        complete: "COMPLETE",
        completed: "COMPLETE",
        cancelled: "CANCELLED",
        rejected: "REJECTED",
        pending: "PENDING",
        open: "PENDING",
        "trigger pending": "PENDING",
        "modify pending": "TRANSIT",
        "cancel pending": "TRANSIT",
    };

    const normalized = String(status).toLowerCase();

    return statusMap[normalized] || "PENDING";
};


// ======================================================
// EXPORTS
// ======================================================

export {
    mapUpstoxTrade,
    mapUpstoxPosition,
    mapUpstoxOrder,
    mapUpstoxOrderStatus,
    mapUpstoxSegment,
    mapUpstoxProduct,
    mapUpstoxOrderType,
    mapUpstoxInstrumentSegment,
};