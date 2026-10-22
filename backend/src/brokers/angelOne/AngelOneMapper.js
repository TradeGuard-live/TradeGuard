/**
 * AngelOneMapper.js
 * Maps Angel One SmartAPI response models to standard TradeGuard trade & position schemas.
 */

export const mapAngelOneSegment = (exchange = "", productType = "", symbol = "") => {
    const ex = String(exchange || "").toUpperCase();
    const sym = String(symbol || "").toUpperCase();

    if (sym.endsWith("CE") || sym.endsWith("PE") || sym.includes("-CE-") || sym.includes("-PE-") || sym.includes("OPT")) {
        return "OPTIONS";
    }

    if (ex === "NFO" || ex === "MCX" || ex === "CDS" || ex === "BFO" || sym.endsWith("FUT") || sym.includes("-FUT-")) {
        return "FUTURES";
    }

    return "EQUITY";
};

export const mapAngelOneProduct = (productType = "") => {
    const prod = String(productType || "").toUpperCase().trim();
    const productMap = {
        DELIVERY: "DELIVERY",
        CNC: "DELIVERY",
        INTRADAY: "INTRADAY",
        MIS: "INTRADAY",
        MARGIN: "MARGIN",
        CARRYFORWARD: "CARRYFORWARD",
        NRML: "CARRYFORWARD",
        BO: "BRACKET_ORDER",
        CO: "COVER_ORDER"
    };

    return productMap[prod] || "INTRADAY";
};

export const mapAngelOneOrderType = (orderType = "") => {
    const ot = String(orderType || "").toUpperCase().trim();
    if (ot.includes("STOPLOSS_MARKET") || ot === "SL-M") {
        return "SL-M";
    }
    if (ot.includes("STOPLOSS") || ot === "SL") {
        return "SL";
    }
    if (ot.includes("LIMIT")) {
        return "LIMIT";
    }
    return "MARKET";
};

export const parseAngelOneDate = (trade) => {
    const rawTime = trade.filltime || trade.tradetime || trade.updatetime || trade.orderstatusupdatetime;
    if (!rawTime) return new Date();

    const str = String(rawTime).trim();
    // Format could be "YYYY-MM-DD HH:mm:ss" or "DD-MMM-YYYY HH:mm:ss"
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        return parsed;
    }

    return new Date();
};

export const mapAngelOneTrade = (trade) => {
    if (!trade) {
        throw new Error("Angel One trade data is required");
    }

    const tradeId = String(
        trade.tradeid || 
        trade.fillid || 
        (trade.orderid ? `TRD-${trade.orderid}` : `AO-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`)
    );

    const orderId = String(
        trade.orderid || 
        trade.exchangeorderid || 
        `ORD-${tradeId}`
    );

    const rawTx = trade.transactiontype || trade.side || trade.type;
    const transactionType = String(rawTx || "BUY").toUpperCase().trim();

    const executedPrice = Number(
        trade.fillprice ?? 
        trade.averageprice ?? 
        trade.price ?? 
        trade.tradedprice ?? 
        0
    );

    const quantity = Number(
        trade.fillsize ?? 
        trade.quantity ?? 
        trade.filledshares ?? 
        trade.tradevolume ?? 
        0
    );

    const symbol = String(
        trade.tradingsymbol || 
        trade.symbol || 
        (trade.symboltoken ? `TOKEN-${trade.symboltoken}` : "UNKNOWN")
    ).toUpperCase();

    const exchange = String(trade.exchange || "NSE").toUpperCase();
    const segment = mapAngelOneSegment(exchange, trade.producttype, symbol);
    const orderType = mapAngelOneOrderType(trade.ordertype);
    const productCode = mapAngelOneProduct(trade.producttype);
    const tradeTime = parseAngelOneDate(trade);

    return {
        tradeId,
        orderId,
        symbol,
        exchange,
        segment,
        transactionType,
        quantity,
        executedPrice,
        orderType,
        status: "COMPLETE",
        productCode,
        tradeTime,
        brokerResponse: trade
    };
};

export const mapAngelOnePosition = (pos) => {
    if (!pos) return null;

    const netQty = Number(pos.netqty || pos.quantity || 0);
    const buyQty = Number(pos.buyqty || 0);
    const sellQty = Number(pos.sellqty || 0);
    const buyAvg = Number(pos.buyavgprice || pos.averageprice || 0);
    const sellAvg = Number(pos.sellavgprice || 0);
    const ltp = Number(pos.ltp || 0);
    const pnl = Number(pos.pnl || pos.realised || 0);

    const symbol = String(pos.tradingsymbol || pos.symbol || "").toUpperCase();
    const token = String(pos.symboltoken || "");
    const exchange = String(pos.exchange || "NSE").toUpperCase();

    return {
        broker: "ANGEL_ONE",
        symbol,
        instrumentToken: token,
        exchange,
        product: mapAngelOneProduct(pos.producttype),
        quantity: netQty,
        buyQuantity: buyQty,
        sellQuantity: sellQty,
        averagePrice: netQty > 0 ? buyAvg : (netQty < 0 ? sellAvg : buyAvg),
        buyAveragePrice: buyAvg,
        sellAveragePrice: sellAvg,
        lastPrice: ltp,
        pnl,
        raw: pos
    };
};

export const mapAngelOneHolding = (holding) => {
    if (!holding) return null;

    return {
        broker: "ANGEL_ONE",
        symbol: String(holding.tradingsymbol || holding.symbol || "").toUpperCase(),
        isin: holding.isin || "",
        exchange: String(holding.exchange || "NSE").toUpperCase(),
        quantity: Number(holding.quantity || holding.totalqty || 0),
        authorisedQuantity: Number(holding.authorisedquantity || 0),
        averagePrice: Number(holding.averageprice || 0),
        lastPrice: Number(holding.ltp || 0),
        pnl: Number(holding.profitandloss || holding.pnl || 0),
        closePrice: Number(holding.close || 0)
    };
};

export default {
    mapAngelOneSegment,
    mapAngelOneProduct,
    mapAngelOneOrderType,
    mapAngelOneTrade,
    mapAngelOnePosition,
    mapAngelOneHolding
};
