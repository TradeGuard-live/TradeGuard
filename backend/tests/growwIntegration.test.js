import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import GrowwAdapter from "../src/brokers/groww/GrowwAdapter.js";
import { mapGrowwPosition, mapGrowwTrade, mapGrowwSegment, mapGrowwProduct, mapGrowwOrderType } from "../src/brokers/groww/GrowwMapper.js";
import brokerConfig, { calculateBrokerageForLeg } from "../src/services/brokers/brokerConfig.js";
import BrokerAccount from "../src/models/BrokerAccount.js";

// ✅ 1. Groww Checksum Generation: SHA256(secret + timestamp)
test("Groww 1: SHA256 checksum generation matches official documentation formula", () => {
    const testSecret = "my_groww_secret_key_12345";
    const testTimestamp = "1730000000";

    const computedChecksum = GrowwAdapter.generateChecksum(testSecret, testTimestamp);
    const expectedChecksum = crypto.createHash("sha256").update(testSecret + testTimestamp).digest("hex");

    assert.equal(computedChecksum, expectedChecksum, "Groww checksum must match SHA256(secret + timestamp)");
    assert.equal(typeof computedChecksum, "string");
    assert.equal(computedChecksum.length, 64, "SHA-256 output must be 64 characters hex");

    // Missing secret or timestamp should throw
    assert.throws(() => GrowwAdapter.generateChecksum("", testTimestamp), /required/);
    assert.throws(() => GrowwAdapter.generateChecksum(testSecret, ""), /required/);
});

// ✅ 2. Groww Brokerage and Statutory Tariff Calculation
test("Groww 2: Equity delivery, intraday, futures, options & DP charge calculations", () => {
    // Delivery: Lower of ₹20 or 0.05% of turnover
    const delSmall = calculateBrokerageForLeg({
        broker: "GROWW",
        productType: "EQUITY_DELIVERY",
        turnover: 10000 // 0.05% of ₹10,000 = ₹5
    });
    assert.equal(delSmall.brokerage, 5, "Groww delivery on ₹10,000 turnover must be ₹5 (0.05%)");

    const delCap = calculateBrokerageForLeg({
        broker: "GROWW",
        productType: "EQUITY_DELIVERY",
        turnover: 100000 // 0.05% of ₹1,00,000 = ₹50, capped at ₹20
    });
    assert.equal(delCap.brokerage, 20, "Groww delivery on ₹1L turnover must be capped at ₹20");

    // Intraday: Lower of ₹20 or 0.05% of turnover
    const intraSmall = calculateBrokerageForLeg({
        broker: "GROWW",
        productType: "EQUITY_INTRADAY",
        turnover: 20000 // 0.05% of ₹20,000 = ₹10
    });
    assert.equal(intraSmall.brokerage, 10, "Groww intraday on ₹20,000 turnover must be ₹10 (0.05%)");

    const intraCap = calculateBrokerageForLeg({
        broker: "GROWW",
        productType: "EQUITY_INTRADAY",
        turnover: 80000 // 0.05% of ₹80,000 = ₹40, capped at ₹20
    });
    assert.equal(intraCap.brokerage, 20, "Groww intraday on ₹80,000 turnover must be capped at ₹20");

    // Equity Futures: Flat ₹20 per executed order
    const fut = calculateBrokerageForLeg({
        broker: "GROWW",
        productType: "EQUITY_FUTURES",
        turnover: 500000
    });
    assert.equal(fut.brokerage, 20, "Groww futures must be flat ₹20 per executed order");

    // Equity Options: Flat ₹20 per executed order
    const opt = calculateBrokerageForLeg({
        broker: "GROWW",
        productType: "EQUITY_OPTIONS",
        turnover: 15000
    });
    assert.equal(opt.brokerage, 20, "Groww options must be flat ₹20 per executed order");

    // Verify DP charges in brokerConfig
    const growwConfig = brokerConfig.brokers.GROWW;
    assert.ok(growwConfig, "Groww broker config must exist");
    assert.equal(growwConfig.plans.STANDARD.dpCharges.sell, 13.50, "Groww DP charge must be ₹13.50");
    assert.equal(growwConfig.plans.STANDARD.dpCharges.gstApplicable, true, "GST must be applicable on Groww DP charge");
});

// ✅ 3. Groww Position Mapping from Official API Response Schema
test("Groww 3: Position mapping correctly converts Groww payload to TradeGuard format", () => {
    const rawGrowwPos = {
        trading_symbol: "RELIANCE",
        credit_quantity: 10,
        credit_price: 1250,
        debit_quantity: 5,
        debit_price: 1200,
        carry_forward_credit_quantity: 8,
        carry_forward_credit_price: 1230,
        carry_forward_debit_quantity: 3,
        carry_forward_debit_price: 1180,
        exchange: "NSE",
        symbol_isin: "INE002A01018",
        quantity: 15,
        product: "CNC",
        segment: "CASH",
        net_carry_forward_quantity: 10,
        net_price: 1240,
        net_carry_forward_price: 1220,
        realised_pnl: 250
    };

    const mapped = mapGrowwPosition(rawGrowwPos);

    assert.equal(mapped.broker, "GROWW");
    assert.equal(mapped.symbol, "RELIANCE");
    assert.equal(mapped.exchange, "NSE");
    assert.equal(mapped.isin, "INE002A01018");
    assert.equal(mapped.product, "DELIVERY");
    assert.equal(mapped.segment, "EQUITY");
    assert.equal(mapped.quantity, 15);
    assert.equal(mapped.averagePrice, 1240);
    assert.equal(mapped.buyQty, 10);
    assert.equal(mapped.buyAvgPrice, 1250);
    assert.equal(mapped.sellQty, 5);
    assert.equal(mapped.sellAvgPrice, 1200);
    assert.equal(mapped.realizedPnL, 250);

    // FNO option position mapping
    const rawFnoPos = {
        trading_symbol: "NIFTY24OCT25000CE",
        quantity: 50,
        net_price: 120,
        product: "MIS",
        segment: "FNO",
        exchange: "NSE",
        realised_pnl: 500
    };

    const mappedFno = mapGrowwPosition(rawFnoPos);
    assert.equal(mappedFno.segment, "OPTIONS");
    assert.equal(mappedFno.product, "INTRADAY");
    assert.equal(mappedFno.quantity, 50);
});

// ✅ 4. Groww Trade Mapping from Order History Schema
test("Groww 4: Trade mapping normalizes executed orders into TradeRecord schema", () => {
    const rawOrder = {
        groww_order_id: "GMK39038RDT490CCVRO",
        trading_symbol: "WIPRO",
        order_status: "FILLED",
        remark: "Order placed successfully",
        quantity: 100,
        price: 2500,
        trigger_price: 2450,
        filled_quantity: 100,
        remaining_quantity: 0,
        average_fill_price: 2498.50,
        deliverable_quantity: 100,
        validity: "DAY",
        exchange: "NSE",
        order_type: "LIMIT",
        transaction_type: "BUY",
        segment: "CASH",
        product: "CNC",
        exchange_time: "2024-10-15T10:15:30Z",
        order_reference_id: "REF-12345"
    };

    const mapped = mapGrowwTrade(rawOrder);

    assert.equal(mapped.broker, "GROWW");
    assert.equal(mapped.tradeId, "GMK39038RDT490CCVRO");
    assert.equal(mapped.orderId, "GMK39038RDT490CCVRO");
    assert.equal(mapped.symbol, "WIPRO");
    assert.equal(mapped.exchange, "NSE");
    assert.equal(mapped.segment, "EQUITY");
    assert.equal(mapped.transactionType, "BUY");
    assert.equal(mapped.productType, "DELIVERY");
    assert.equal(mapped.orderType, "LIMIT");
    assert.equal(mapped.quantity, 100);
    assert.equal(mapped.price, 2498.50);
    assert.equal(mapped.status, "EXECUTED");
    assert.ok(mapped.executedAt instanceof Date);
});

// ✅ 5. Groww Segment and Product Helpers
test("Groww 5: Segment and Product parsing rules", () => {
    assert.equal(mapGrowwSegment("CASH"), "EQUITY");
    assert.equal(mapGrowwSegment("FNO", "NIFTY24OCTFUT"), "FUTURES");
    assert.equal(mapGrowwSegment("FNO", "BANKNIFTY24OCT50000PE"), "OPTIONS");
    assert.equal(mapGrowwSegment("COMMODITY"), "COMMODITY");

    assert.equal(mapGrowwProduct("CNC"), "DELIVERY");
    assert.equal(mapGrowwProduct("MIS"), "INTRADAY");
    assert.equal(mapGrowwProduct("INTRADAY"), "INTRADAY");
    assert.equal(mapGrowwProduct("NRML"), "INTRADAY");

    assert.equal(mapGrowwOrderType("LIMIT"), "LIMIT");
    assert.equal(mapGrowwOrderType("STOP_LOSS"), "SL");
    assert.equal(mapGrowwOrderType("STOP_LOSS_MARKET"), "SL-M");
});

// ✅ 6. BrokerAccount Schema accepts GROWW
test("Groww 6: BrokerAccount schema allows GROWW broker type", () => {
    const enumValues = BrokerAccount.schema.path("broker").enumValues;
    assert.ok(enumValues.includes("GROWW"), "BrokerAccount schema enum must include GROWW");
});
