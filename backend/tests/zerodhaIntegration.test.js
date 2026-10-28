import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import ZerodhaAdapter from "../src/brokers/zerodha/ZerodhaAdapter.js";
import { 
    mapZerodhaPosition, 
    mapZerodhaHolding, 
    mapZerodhaTrade, 
    mapZerodhaSegment, 
    mapZerodhaProduct, 
    mapZerodhaOrderType 
} from "../src/brokers/zerodha/ZerodhaMapper.js";
import brokerConfig, { calculateBrokerageForLeg } from "../src/services/brokers/brokerConfig.js";
import BrokerAccount from "../src/models/BrokerAccount.js";

// ✅ 1. Zerodha Kite Connect Checksum Generation & Login URL
test("Zerodha 1: SHA256 checksum generation matches official documentation formula", () => {
    const apiKey = "abcdef1234567890";
    const requestToken = "xyz987654321";
    const apiSecret = "secret998877";

    const computedChecksum = ZerodhaAdapter.generateChecksum({ apiKey, requestToken, apiSecret });
    const expectedChecksum = crypto.createHash("sha256").update(apiKey + requestToken + apiSecret).digest("hex");

    assert.equal(computedChecksum, expectedChecksum, "Zerodha checksum must match SHA256(apiKey + requestToken + apiSecret)");
    assert.equal(typeof computedChecksum, "string");
    assert.equal(computedChecksum.length, 64, "SHA-256 output must be 64 characters hex");

    // Login URL check
    const loginUrl = ZerodhaAdapter.getLoginUrl({ apiKey });
    assert.equal(loginUrl, "https://kite.zerodha.com/connect/login?v=3&api_key=abcdef1234567890");

    // Login URL with redirect params
    const loginUrlWithParams = ZerodhaAdapter.getLoginUrl({ apiKey, redirectParams: "account=main" });
    assert.ok(loginUrlWithParams.includes("redirect_params=account%3Dmain"));

    // Validation checks
    assert.throws(() => ZerodhaAdapter.generateChecksum({ apiKey: "", requestToken, apiSecret }), /required/);
    assert.throws(() => ZerodhaAdapter.generateChecksum({ apiKey, requestToken: "", apiSecret }), /required/);
    assert.throws(() => ZerodhaAdapter.generateChecksum({ apiKey, requestToken, apiSecret: "" }), /required/);
});

// ✅ 2. Zerodha Brokerage and Statutory Tariff Calculation
test("Zerodha 2: Equity delivery (₹0), intraday, futures, options & DP charge calculations", () => {
    // Equity Delivery: ₹0 (Free equity delivery investments)
    const delSmall = calculateBrokerageForLeg({
        broker: "ZERODHA",
        productType: "EQUITY_DELIVERY",
        turnover: 10000
    });
    assert.equal(delSmall.brokerage, 0, "Zerodha delivery on ₹10,000 turnover must be ₹0 (Free)");

    const delLarge = calculateBrokerageForLeg({
        broker: "ZERODHA",
        productType: "EQUITY_DELIVERY",
        turnover: 5000000
    });
    assert.equal(delLarge.brokerage, 0, "Zerodha delivery on large turnover must remain ₹0");

    // Equity Intraday: Lower of ₹20 or 0.03% of turnover
    const intraSmall = calculateBrokerageForLeg({
        broker: "ZERODHA",
        productType: "EQUITY_INTRADAY",
        turnover: 20000 // 0.03% of ₹20,000 = ₹6
    });
    assert.equal(intraSmall.brokerage, 6, "Zerodha intraday on ₹20,000 turnover must be ₹6 (0.03%)");

    const intraCap = calculateBrokerageForLeg({
        broker: "ZERODHA",
        productType: "EQUITY_INTRADAY",
        turnover: 100000 // 0.03% of ₹1,00,000 = ₹30, capped at ₹20
    });
    assert.equal(intraCap.brokerage, 20, "Zerodha intraday on ₹1L turnover must be capped at ₹20");

    // Equity Futures: Lower of ₹20 or 0.03% of turnover
    const futSmall = calculateBrokerageForLeg({
        broker: "ZERODHA",
        productType: "EQUITY_FUTURES",
        turnover: 30000 // 0.03% of ₹30,000 = ₹9
    });
    assert.equal(futSmall.brokerage, 9, "Zerodha futures on ₹30,000 turnover must be ₹9 (0.03%)");

    const futCap = calculateBrokerageForLeg({
        broker: "ZERODHA",
        productType: "EQUITY_FUTURES",
        turnover: 200000 // 0.03% of ₹2L = ₹60, capped at ₹20
    });
    assert.equal(futCap.brokerage, 20, "Zerodha futures on large turnover must be capped at ₹20");

    // Equity Options: Flat ₹20 per executed order
    const opt = calculateBrokerageForLeg({
        broker: "ZERODHA",
        productType: "EQUITY_OPTIONS",
        turnover: 15000
    });
    assert.equal(opt.brokerage, 20, "Zerodha options must be flat ₹20 per executed order");

    // DP Charges verification
    const zerodhaConfig = brokerConfig.brokers.ZERODHA;
    assert.ok(zerodhaConfig, "Zerodha broker config must exist");
    assert.equal(zerodhaConfig.plans.STANDARD.dpCharges.sell, 13.50, "Zerodha DP charge must be ₹13.50");
    assert.equal(zerodhaConfig.plans.STANDARD.dpCharges.gstApplicable, true, "GST must be applicable on Zerodha DP charge");
});

// ✅ 3. Zerodha Net Position Mapping
test("Zerodha 3: Position mapping correctly converts Kite net position payload to TradeGuard format", () => {
    const rawNetPos = {
        tradingsymbol: "LEADMINI17DECFUT",
        exchange: "MCX",
        instrument_token: 53496327,
        product: "NRML",
        quantity: 1,
        overnight_quantity: 0,
        multiplier: 1000,
        average_price: 161.05,
        close_price: 0,
        last_price: 165.50,
        value: -161050,
        pnl: 4450,
        m2m: 4450,
        unrealised: 4450,
        realised: 0,
        buy_quantity: 1,
        buy_price: 161.05,
        buy_value: 161050,
        sell_quantity: 0,
        sell_price: 0,
        sell_value: 0
    };

    const mapped = mapZerodhaPosition(rawNetPos);

    assert.equal(mapped.broker, "ZERODHA");
    assert.equal(mapped.symbol, "LEADMINI17DECFUT");
    assert.equal(mapped.exchange, "MCX");
    assert.equal(mapped.instrumentToken, 53496327);
    assert.equal(mapped.product, "INTRADAY");
    assert.equal(mapped.segment, "COMMODITY");
    assert.equal(mapped.quantity, 1);
    assert.equal(mapped.averagePrice, 161.05);
    assert.equal(mapped.lastPrice, 165.50);
    assert.equal(mapped.pnl, 4450);
    assert.equal(mapped.m2m, 4450);
    assert.equal(mapped.realizedPnL, 0);
    assert.equal(mapped.unrealizedPnL, 4450);
    assert.equal(mapped.buyQty, 1);
    assert.equal(mapped.buyAvgPrice, 161.05);
    assert.equal(mapped.sellQty, 0);

    // Option position mapping
    const rawOptPos = {
        tradingsymbol: "NIFTY25FEB24000CE",
        exchange: "NFO",
        instrument_token: 10189826,
        product: "MIS",
        quantity: 50,
        average_price: 125.50,
        last_price: 140.00,
        pnl: 725,
        realised: 0,
        unrealised: 725
    };

    const mappedOpt = mapZerodhaPosition(rawOptPos);
    assert.equal(mappedOpt.segment, "OPTIONS");
    assert.equal(mappedOpt.product, "INTRADAY");
    assert.equal(mappedOpt.quantity, 50);
    assert.equal(mappedOpt.currentPrice, 140);
});

// ✅ 4. Zerodha Demat Holding Mapping
test("Zerodha 4: Holding mapping converts Zerodha Demat holdings to TradeGuard format", () => {
    const rawHolding = {
        tradingsymbol: "SBIN",
        exchange: "BSE",
        instrument_token: 128028676,
        isin: "INE062A01020",
        product: "CNC",
        quantity: 16,
        average_price: 801.78,
        last_price: 762.45,
        close_price: 766.40,
        pnl: -629.30
    };

    const mapped = mapZerodhaHolding(rawHolding);

    assert.equal(mapped.broker, "ZERODHA");
    assert.equal(mapped.symbol, "SBIN");
    assert.equal(mapped.exchange, "BSE");
    assert.equal(mapped.isin, "INE062A01020");
    assert.equal(mapped.product, "DELIVERY");
    assert.equal(mapped.segment, "EQUITY");
    assert.equal(mapped.quantity, 16);
    assert.equal(mapped.averagePrice, 801.78);
    assert.equal(mapped.lastPrice, 762.45);
    assert.equal(mapped.pnl, -629.30);
});

// ✅ 5. Zerodha Trade and Order Mapping
test("Zerodha 5: Trade mapping normalizes executed trades into TradeRecord schema", () => {
    // 1. From /trades response
    const rawTrade = {
        trade_id: "10000000",
        order_id: "200000000000000",
        exchange: "MCX",
        tradingsymbol: "GOLDPETAL21JUNFUT",
        instrument_token: 58424839,
        product: "NRML",
        average_price: 4852,
        quantity: 1,
        transaction_type: "BUY",
        fill_timestamp: "2021-05-31 16:00:36"
    };

    const mappedTrade = mapZerodhaTrade(rawTrade);

    assert.equal(mappedTrade.broker, "ZERODHA");
    assert.equal(mappedTrade.tradeId, "10000000");
    assert.equal(mappedTrade.orderId, "200000000000000");
    assert.equal(mappedTrade.symbol, "GOLDPETAL21JUNFUT");
    assert.equal(mappedTrade.exchange, "MCX");
    assert.equal(mappedTrade.segment, "COMMODITY");
    assert.equal(mappedTrade.transactionType, "BUY");
    assert.equal(mappedTrade.product, "INTRADAY");
    assert.equal(mappedTrade.quantity, 1);
    assert.equal(mappedTrade.price, 4852);
    assert.ok(mappedTrade.executedAt instanceof Date);

    // 2. From /orders response (completed order)
    const rawOrder = {
        order_id: "1953341975595868160",
        exchange_order_id: "1300000038792287",
        status: "COMPLETE",
        order_timestamp: "2025-08-07 11:56:33",
        exchange: "NSE",
        tradingsymbol: "TATASTEEL",
        order_type: "LIMIT",
        transaction_type: "BUY",
        product: "CNC",
        quantity: 1,
        filled_quantity: 1,
        average_price: 156.70
    };

    const mappedOrder = mapZerodhaTrade(rawOrder);
    assert.equal(mappedOrder.broker, "ZERODHA");
    assert.equal(mappedOrder.tradeId, "1953341975595868160");
    assert.equal(mappedOrder.symbol, "TATASTEEL");
    assert.equal(mappedOrder.segment, "EQUITY");
    assert.equal(mappedOrder.product, "DELIVERY");
    assert.equal(mappedOrder.orderType, "LIMIT");
    assert.equal(mappedOrder.price, 156.70);
});

// ✅ 6. Zerodha Segment and Product Helpers
test("Zerodha 6: Segment and Product parsing rules", () => {
    assert.equal(mapZerodhaSegment("NSE", "RELIANCE"), "EQUITY");
    assert.equal(mapZerodhaSegment("BSE", "INFY"), "EQUITY");
    assert.equal(mapZerodhaSegment("NFO", "NIFTY25FEBFUT"), "FUTURES");
    assert.equal(mapZerodhaSegment("NFO", "NIFTY25FEB24400CE"), "OPTIONS");
    assert.equal(mapZerodhaSegment("BFO", "SENSEX25FEB80000PE"), "OPTIONS");
    assert.equal(mapZerodhaSegment("MCX", "CRUDEOIL25FEBFUT"), "COMMODITY");
    assert.equal(mapZerodhaSegment("CDS", "USDINR25FEBFUT"), "CURRENCY");

    assert.equal(mapZerodhaProduct("CNC"), "DELIVERY");
    assert.equal(mapZerodhaProduct("MIS"), "INTRADAY");
    assert.equal(mapZerodhaProduct("NRML"), "INTRADAY");
    assert.equal(mapZerodhaProduct("MTF"), "MTF");
    assert.equal(mapZerodhaProduct("BO"), "INTRADAY");
    assert.equal(mapZerodhaProduct("CO"), "INTRADAY");

    assert.equal(mapZerodhaOrderType("LIMIT"), "LIMIT");
    assert.equal(mapZerodhaOrderType("MARKET"), "MARKET");
    assert.equal(mapZerodhaOrderType("SL"), "SL");
    assert.equal(mapZerodhaOrderType("SL-M"), "SL-M");
});

// ✅ 7. BrokerAccount Schema accepts ZERODHA
test("Zerodha 7: BrokerAccount schema allows ZERODHA broker type", () => {
    const enumValues = BrokerAccount.schema.path("broker").enumValues;
    assert.ok(enumValues.includes("ZERODHA"), "BrokerAccount schema enum must include ZERODHA");
});
