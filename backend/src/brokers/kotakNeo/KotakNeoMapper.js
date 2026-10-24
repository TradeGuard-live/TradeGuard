/**
 * KotakNeoMapper.js
 * Maps Kotak Neo response structures to standard TradeGuard trade & position schemas.
 */

export const mapKotakNeoSegment = (exchangeSegment = "", symbol = "") => {
    const es = String(exchangeSegment || "").toLowerCase().trim();
    const sym = String(symbol || "").toUpperCase().trim();

    if (sym.endsWith("CE") || sym.endsWith("PE") || sym.includes("-CE-") || sym.includes("-PE-") || sym.includes("OPT")) {
        return "OPTIONS";
    }

    if (es.includes("fo") || es.includes("cds") || sym.endsWith("FUT") || sym.includes("-FUT-")) {
        if (es.includes("opt") || sym.includes("OPT") || sym.endsWith("CE") || sym.endsWith("PE")) {
            return "OPTIONS";
        }
        return "FUTURES";
    }

    return "EQUITY";
};

export const mapKotakNeoExchange = (exchangeSegment = "") => {
    const es = String(exchangeSegment || "").toLowerCase().trim();
    if (es.startsWith("bse")) return "BSE";
    if (es.startsWith("mcx")) return "MCX";
    if (es.startsWith("cde") || es.startsWith("cds")) return "CDS";
    return "NSE";
};

export const mapKotakNeoProduct = (productCode = "") => {
    const prod = String(productCode || "").toUpperCase().trim();
    const map = {
        CNC: "DELIVERY",
        DELIVERY: "DELIVERY",
        MIS: "INTRADAY",
        INTRADAY: "INTRADAY",
        NRML: "CARRYFORWARD",
        CARRYFORWARD: "CARRYFORWARD",
        MTF: "MARGIN",
        MARGIN: "MARGIN",
        BO: "BRACKET_ORDER",
        CO: "COVER_ORDER"
    };
    return map[prod] || "INTRADAY";
};

export const mapKotakNeoOrderType = (priceType = "") => {
    const pt = String(priceType || "").toUpperCase().trim();
    if (pt === "SL-M" || pt === "SLM") return "SL-M";
    if (pt === "SL") return "SL";
    if (pt === "L" || pt === "LIMIT") return "LIMIT";
    return "MARKET";
};

export const parseKotakNeoDate = (item = {}) => {
    const raw = item.flDtTm || item.ordDtTm || item.hsUpTm || item.tradeTime || item.timestamp;
    if (!raw) return new Date();

    const str = String(raw).trim();
    // Could be "20-Jul-2025 20:21:42", "2022/06/21 15:11:02", or ISO string
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        return parsed;
    }

    return new Date();
};

/**
 * Maps a single executed order or trade item from Kotak Neo into a standard TradeGuard trade object.
 */
export const mapKotakNeoTrade = (trade = {}) => {
    if (!trade) {
        throw new Error("Kotak Neo trade data is required");
    }

    const orderId = String(trade.nOrdNo || trade.orderNo || trade.on || "");
    const tradeId = String(
        trade.trdId ||
        trade.tradeId ||
        trade.fillId ||
        (orderId ? `KOTAK-${orderId}` : `KN-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`)
    );

    const rawTx = trade.trnsTp || trade.tt || trade.transactionType || trade.side;
    const isBuy = String(rawTx || "B").toUpperCase().startsWith("B");
    const transactionType = isBuy ? "BUY" : "SELL";

    const executedPrice = Number(
        trade.avgPrc ??
        trade.flPrc ??
        trade.prc ??
        trade.price ??
        trade.averagePrice ??
        0
    );

    const quantity = Number(
        trade.qty ??
        trade.flQty ??
        trade.qt ??
        trade.quantity ??
        trade.filledQuantity ??
        0
    );

    const symbol = String(
        trade.trdSym ||
        trade.ts ||
        trade.symbol ||
        trade.sym ||
        "UNKNOWN"
    ).toUpperCase();

    const exSeg = String(trade.exSeg || trade.es || "").toLowerCase();
    const exchange = mapKotakNeoExchange(exSeg);
    const segment = mapKotakNeoSegment(exSeg, symbol);
    const orderType = mapKotakNeoOrderType(trade.prcTp || trade.pt);
    const productCode = mapKotakNeoProduct(trade.prod || trade.pc);
    const tradeTime = parseKotakNeoDate(trade);

    return {
        tradeId,
        orderId: orderId || null,
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
        broker: "KOTAK_NEO",
        brokerResponse: trade
    };
};

/**
 * Maps a Kotak Neo position item into TradeGuard's position schema.
 */
export const mapKotakNeoPosition = (pos = {}) => {
    if (!pos) return null;

    const netQty = Number(pos.qty || pos.netQty || 0);
    const buyQty = Number(pos.flBuyQty || pos.buyQty || 0);
    const sellQty = Number(pos.flSellQty || pos.sellQty || 0);
    const buyAmt = Number(pos.buyAmt || 0);
    const sellAmt = Number(pos.sellAmt || 0);

    const buyAvg = buyQty > 0 ? (buyAmt / buyQty) : 0;
    const sellAvg = sellQty > 0 ? (sellAmt / sellQty) : 0;
    const ltp = Number(pos.ltp || pos.stkPrc || 0);

    const symbol = String(pos.trdSym || pos.sym || "").toUpperCase();
    const exSeg = String(pos.exSeg || "nse_cm").toLowerCase();
    const exchange = mapKotakNeoExchange(exSeg);

    // Calculate PnL if not directly provided
    let pnl = Number(pos.pnl || 0);
    if (!pnl && ltp > 0) {
        if (netQty > 0) {
            pnl = (ltp - buyAvg) * netQty;
        } else if (netQty < 0) {
            pnl = (sellAvg - ltp) * Math.abs(netQty);
        } else {
            pnl = sellAmt - buyAmt;
        }
    }

    return {
        broker: "KOTAK_NEO",
        symbol,
        instrumentToken: String(pos.tok || pos.instrumentToken || symbol),
        exchange,
        product: mapKotakNeoProduct(pos.prod),
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

export default {
    mapKotakNeoSegment,
    mapKotakNeoExchange,
    mapKotakNeoProduct,
    mapKotakNeoOrderType,
    mapKotakNeoTrade,
    mapKotakNeoPosition
};
