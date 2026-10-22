/**
 * DhanMapper.js
 * Maps DhanHQ API response structures to standard TradeGuard trade schemas.
 */

export const mapDhanSegment = (exchangeSegment, instrument, drvOptionType) => {
    const seg = String(exchangeSegment || "").toUpperCase();
    const inst = String(instrument || "").toUpperCase();
    const optType = String(drvOptionType || "").toUpperCase();

    if (optType === "CALL" || optType === "PUT" || optType === "CE" || optType === "PE") {
        return "OPTIONS";
    }

    if (seg.includes("FNO") || seg.includes("DERIV")) {
        if (inst.includes("OPT") || optType.length > 0 && optType !== "NA") {
            return "OPTIONS";
        }
        return "FUTURES";
    }

    if (seg.includes("COMM") || seg.includes("MCX")) {
        return "COMMODITY";
    }

    if (seg.includes("CURR") || seg.includes("FX")) {
        return "CURRENCY";
    }

    return "EQUITY";
};

export const mapDhanProduct = (productType) => {
    if (!productType) return "INTRADAY";

    const prod = String(productType).toUpperCase().trim();
    const productMap = {
        CNC: "DELIVERY",
        INTRADAY: "INTRADAY",
        INTRA: "INTRADAY",
        MARGIN: "MTF",
        MTF: "MTF",
        CO: "COVER_ORDER",
        BO: "BRACKET_ORDER"
    };

    return productMap[prod] || "INTRADAY";
};

export const mapDhanOrderType = (orderType) => {
    if (!orderType) return "MARKET";

    const norm = String(orderType).toUpperCase().trim();
    if (["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET", "SL", "SL-M"].includes(norm)) {
        if (norm === "STOP_LOSS") return "SL";
        if (norm === "STOP_LOSS_MARKET") return "SL-M";
        return norm;
    }
    return "MARKET";
};

export const mapDhanTrade = (trade) => {
    if (!trade) {
        throw new Error("Dhan trade data is required");
    }

    const tradeId = String(
        (trade.exchangeTradeId && trade.exchangeTradeId !== "0" && trade.exchangeTradeId !== 0)
            ? trade.exchangeTradeId
            : (trade.tradeId || (trade.orderId ? `TRD-${trade.orderId}` : `DHAN-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`))
    );

    const orderId = String(
        trade.orderId ||
        trade.exchangeOrderId ||
        `ORD-${tradeId}`
    );

    const rawTransactionType = trade.transactionType || trade.type || trade.side;
    const transactionType = rawTransactionType
        ? String(rawTransactionType).toUpperCase()
        : "BUY";

    const executedPrice = Number(
        trade.tradedPrice ??
        trade.price ??
        trade.avgPrice ??
        0
    );

    const quantity = Number(
        trade.tradedQuantity ??
        trade.quantity ??
        0
    );

    const symbol =
        trade.tradingSymbol ||
        trade.customSymbol ||
        (trade.securityId ? `SEC-${trade.securityId}` : "UNKNOWN");

    let tradeTime = null;
    const rawTime = trade.exchangeTime || trade.createTime || trade.updateTime || trade.timestamp;
    if (rawTime && rawTime !== "NA") {
        tradeTime = new Date(rawTime);
        if (isNaN(tradeTime.getTime())) {
            tradeTime = new Date();
        }
    } else {
        tradeTime = new Date();
    }

    return {
        tradeId,
        orderId,
        broker: "DHAN",
        symbol,
        transactionType,
        quantity,
        executedPrice,
        status: "COMPLETE",
        orderType: mapDhanOrderType(trade.orderType),
        segment: mapDhanSegment(trade.exchangeSegment, trade.instrument, trade.drvOptionType),
        productCode: mapDhanProduct(trade.productType),
        exchange: String(trade.exchangeSegment || "NSE").split("_")[0],
        tradeTime,
        brokerResponse: trade
    };
};

export const mapDhanPosition = (pos) => {
    if (!pos) return null;

    const symbol = pos.tradingSymbol || pos.customSymbol || `SEC-${pos.securityId}`;
    const netQty = Number(pos.netQty || 0);
    const buyQty = Number(pos.buyQty || pos.dayBuyQty || 0);
    const sellQty = Number(pos.sellQty || pos.daySellQty || 0);
    const buyAvg = Number(pos.buyAvg || pos.costPrice || 0);
    const sellAvg = Number(pos.sellAvg || 0);
    const realizedPnL = Number(pos.realizedProfit || 0);
    const unrealizedPnL = Number(pos.unrealizedProfit || 0);

    return {
        key: `DHAN|${pos.exchangeSegment || "NSE_EQ"}|${symbol}|${pos.productType || "CNC"}`,
        broker: "DHAN",
        symbol,
        exchange: String(pos.exchangeSegment || "NSE").split("_")[0],
        segment: mapDhanSegment(pos.exchangeSegment, null, pos.drvOptionType),
        productType: mapDhanProduct(pos.productType),
        instrumentToken: pos.securityId ? `${pos.exchangeSegment || "NSE_EQ"}|${pos.securityId}` : symbol,
        netQuantity: netQty,
        openQuantity: Math.abs(netQty),
        averagePrice: netQty >= 0 ? buyAvg : sellAvg,
        realizedPnL,
        unrealizedPnL,
        status: netQty === 0 ? "CLOSED" : (buyQty > 0 && sellQty > 0 ? "PARTIALLY_SQUARED" : "OPEN"),
        side: netQty >= 0 ? "BUY" : "SELL",
        brokerResponse: pos
    };
};
