import upstoxInstrumentService from "../../services/marketData/upstoxInstrumentService.js";

// ======================================================
// MAP UPSTOX SEGMENT
// ======================================================

const mapUpstoxSegment = (segment) => {
    if (!segment) return undefined;

    const segmentMap = {
        EQ: "EQUITY",
        EQUITY: "EQUITY",
        NSE_EQ: "EQUITY",
        BSE_EQ: "EQUITY",
        "F&O": "FUTURES",
        FO: "FUTURES",
        NSE_FO: "FUTURES",
        BFO: "FUTURES",
        OP: "OPTIONS",
        OPTIONS: "OPTIONS",
        CUR: "CURRENCY",
        CURRENCY: "CURRENCY",
        NSE_CUR: "CURRENCY",
        BSE_CUR: "CURRENCY",
        CDS: "CURRENCY",
        BCD: "CURRENCY",
        CD: "COMMODITY",
        COMMODITY: "COMMODITY",
        MCX: "COMMODITY",
        MCX_FO: "COMMODITY",
        MCX_EQ: "COMMODITY",
    };

    const normalized = String(segment).toUpperCase().trim();

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
// Uses authoritative instrument metadata:
// Supports: EQUITY, FUTURES, OPTIONS, CURRENCY, COMMODITY.
// Does NOT default to EQUITY; rejects ambiguous instruments.
// ======================================================

const mapUpstoxInstrumentSegment = (trade) => {
    if (!trade) return null;

    // 1. Authoritative instrument type
    const instrumentType = String(
        trade.instrument_type ||
        trade.instrumentType ||
        trade.instrument_type_name ||
        ""
    ).toUpperCase().trim();

    if (["CE", "PE", "OPTIDX", "OPTSTK", "OPTFUT", "OPTCUR", "OPTIONS", "OPTION"].includes(instrumentType)) {
        return "OPTIONS";
    }

    if (["FUT", "FUTIDX", "FUTSTK", "FUTCOM", "FUTCUR", "FUTURES", "FUTURE"].includes(instrumentType)) {
        return "FUTURES";
    }

    if (["EQ", "EQUITY"].includes(instrumentType)) {
        return "EQUITY";
    }

    if (["CUR", "CURRENCY"].includes(instrumentType)) {
        return "CURRENCY";
    }

    if (["COM", "COMMODITY"].includes(instrumentType)) {
        return "COMMODITY";
    }

    // 2. Authoritative segment / exchange / token identifiers
    const exchange = String(trade.exchange || "").toUpperCase().trim();
    const token = String(trade.instrument_token || trade.instrumentToken || trade.instrument_key || trade.instrumentKey || "").trim();

    if (exchange === "MCX" || token.startsWith("MCX_")) {
        return "COMMODITY";
    }

    if (exchange === "CDS" || exchange === "BCD" || token.startsWith("NSE_CUR|") || token.startsWith("BSE_CUR|")) {
        return "CURRENCY";
    }

    if (token.startsWith("NSE_EQ|") || token.startsWith("BSE_EQ|")) {
        return "EQUITY";
    }

    const mappedSegment = mapUpstoxSegment(trade.segment);
    if (mappedSegment === "COMMODITY" || mappedSegment === "CURRENCY") {
        return mappedSegment;
    }
    if (mappedSegment === "EQUITY") {
        return "EQUITY";
    }

    // 3. Derivatives exchange (NFO/BFO) or token (NSE_FO|/BFO|)
    const isDerivative = exchange === "NFO" || exchange === "BFO" || token.includes("_FO|") || mappedSegment === "FUTURES" || mappedSegment === "OPTIONS";

    const symbol = String(
        trade.trading_symbol ||
        trade.tradingsymbol ||
        trade.symbol ||
        trade.scrip_name ||
        ""
    ).toUpperCase().trim();

    // Check symbol structure for options (CE/PE) or futures (FUT)
    if (/(CE|PE)$/i.test(symbol) || /-CE-|-PE-|OPT/i.test(symbol)) {
        return "OPTIONS";
    }
    if (/FUT$/i.test(symbol) || /-FUT-/i.test(symbol)) {
        return "FUTURES";
    }

    if (isDerivative) {
        return "FUTURES";
    }

    if (exchange === "NSE" || exchange === "BSE") {
        if (symbol && !isDerivative) {
            return "EQUITY";
        }
    }

    // Reject ambiguous or unresolvable instruments
    return null;
};


const parseUpstoxTimestamp = (tradeOrTimestamp) => {
    if (!tradeOrTimestamp) return null;

    let raw = null;
    if (typeof tradeOrTimestamp === "object" && !(tradeOrTimestamp instanceof Date)) {
        // Exchange execution timestamps take priority over order timestamps
        raw = tradeOrTimestamp.exchange_timestamp ||
              tradeOrTimestamp.trade_timestamp ||
              tradeOrTimestamp.execution_timestamp ||
              tradeOrTimestamp.fill_timestamp ||
              tradeOrTimestamp.trade_date ||
              tradeOrTimestamp.timestamp ||
              tradeOrTimestamp.order_timestamp;
    } else {
        raw = tradeOrTimestamp;
    }

    if (!raw) return null;

    if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw;
    }

    if (typeof raw === "number") {
        if (!Number.isFinite(raw) || raw <= 0) return null;
        const ms = raw < 10000000000 ? Math.round(raw * 1000) : Math.round(raw);
        return new Date(ms);
    }

    const str = String(raw).trim();
    if (!str) return null;

    // Check if string is purely numeric digits (epoch ms or seconds)
    if (/^\d+$/.test(str)) {
        const num = Number(str);
        if (!Number.isFinite(num) || num <= 0) return null;
        const ms = num < 10000000000 ? Math.round(num * 1000) : Math.round(num);
        return new Date(ms);
    }

    // Upstox standard IST format: "YYYY-MM-DD HH:mm:ss" without explicit offset
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
        const d = new Date(str.replace(" ", "T") + "+05:30");
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
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

        tradeTime: parseUpstoxTimestamp(trade),

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
    if (!symbol) return null; // Reject ambiguous positions without symbol

    const exchange = String(pos.exchange || "NSE").toUpperCase();
    const segment = mapUpstoxInstrumentSegment(pos) || (pos.segment ? mapUpstoxSegment(pos.segment) : null);
    if (!segment) {
        // Reject ambiguous instruments where segment cannot be determined
        return null;
    }

    const productType = mapUpstoxProduct(pos.product) || "INTRADAY";

    // ✅ Resolve canonical instrument key safely without inventing arbitrary keys
    const rawToken = pos.instrument_token || pos.instrumentToken || pos.instrument_key || pos.instrumentKey;
    const instrumentToken = rawToken && String(rawToken).includes("|")
        ? String(rawToken).replace(":", "|").trim()
        : (upstoxInstrumentService.resolveInstrumentKey({
            symbol,
            exchange,
            segment,
            instrumentToken: rawToken,
            brokerResponse: pos
        }) || (rawToken ? String(rawToken).trim() : null));

    const qty = Number(pos.quantity || 0);

    const avgPrice = Number(pos.average_price ?? pos.buy_price ?? pos.day_buy_price ?? 0);
    const lastPrice = Number(pos.last_price || 0);
    const closePrice = Number(pos.close_price || 0);

    return {
        // ✅ Normalized Upstox position representation
        broker: "UPSTOX",
        symbol,
        exchange,
        segment,
        productType,
        instrumentToken,
        instrument_token: instrumentToken,
        instrument_key: instrumentToken,
        quantity: qty,
        netQuantity: qty,
        averagePrice: avgPrice,
        average_price: avgPrice,
        buy_price: avgPrice,
        lastPrice,
        last_price: lastPrice,
        closePrice,
        close_price: closePrice,
        realizedPnL: Number(pos.realised || 0),
        realised: Number(pos.realised || 0),
        unrealizedPnL: Number(pos.unrealised || 0),
        unrealised: Number(pos.unrealised || 0),
        pnl: Number(pos.pnl || 0),
        product: pos.product || productType,
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
    parseUpstoxTimestamp,
};