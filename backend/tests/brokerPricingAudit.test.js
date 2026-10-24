import test from "node:test";
import assert from "node:assert/strict";
import brokerConfig, { calculateBrokerageForLeg } from "../src/services/brokers/brokerConfig.js";

test("1. Upstox delivery and intraday brokerage audit", () => {
    // Delivery: Fixed ₹20 per executed order (verify 2.5% was removed)
    const delSmall = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_DELIVERY",
        turnover: 5000 // If 2.5%, it would have been ₹125
    });
    assert.equal(delSmall.brokerage, 20, "Upstox delivery must be fixed ₹20, not percentage-based");

    const delLarge = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_DELIVERY",
        turnover: 1000000
    });
    assert.equal(delLarge.brokerage, 20, "Upstox delivery on ₹10L turnover must be fixed ₹20");

    // Intraday: Lower of ₹20 or 0.1% of turnover (verify changed from 0.05% to 0.1%)
    const intraSmall = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_INTRADAY",
        turnover: 10000 // 0.1% of ₹10,000 = ₹10
    });
    assert.equal(intraSmall.brokerage, 10, "Upstox intraday on ₹10,000 turnover must be ₹10 (0.1%)");

    const intraCap = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_INTRADAY",
        turnover: 50000 // 0.1% of ₹50,000 = ₹50, capped at ₹20
    });
    assert.equal(intraCap.brokerage, 20, "Upstox intraday on ₹50,000 turnover must be capped at ₹20");

    // Equity Futures: Lower of ₹20 or 0.05%
    const futSmall = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_FUTURES",
        turnover: 20000 // 0.05% of ₹20,000 = ₹10
    });
    assert.equal(futSmall.brokerage, 10, "Upstox futures on ₹20,000 turnover must be ₹10 (0.05%)");

    // Equity Options: Fixed ₹20
    const opt = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_OPTIONS",
        turnover: 5000
    });
    assert.equal(opt.brokerage, 20, "Upstox options must be fixed ₹20 per order");
});

test("2. Dhan intraday versus futures brokerage & physical delivery rule", () => {
    // Equity Delivery: ₹0 Brokerage
    const del = calculateBrokerageForLeg({
        broker: "DHAN",
        productType: "EQUITY_DELIVERY",
        turnover: 100000
    });
    assert.equal(del.brokerage, 0, "Dhan equity delivery must be ₹0");

    // Equity Intraday: Lower of ₹20 or 0.03%
    const intraSmall = calculateBrokerageForLeg({
        broker: "DHAN",
        productType: "EQUITY_INTRADAY",
        turnover: 10000 // 0.03% of ₹10,000 = ₹3
    });
    assert.equal(intraSmall.brokerage, 3, "Dhan intraday on ₹10,000 turnover must be ₹3 (0.03%)");

    const intraCap = calculateBrokerageForLeg({
        broker: "DHAN",
        productType: "EQUITY_INTRADAY",
        turnover: 100000 // 0.03% of ₹1,00,000 = ₹30, capped at ₹20
    });
    assert.equal(intraCap.brokerage, 20, "Dhan intraday must cap at ₹20");

    // Equity Futures: FIXED ₹20 per executed order (MUST NOT be lower of 0.03%)
    const futSmall = calculateBrokerageForLeg({
        broker: "DHAN",
        productType: "EQUITY_FUTURES",
        turnover: 10000 // If it were 0.03%, it would be ₹3. Must be fixed ₹20!
    });
    assert.equal(futSmall.brokerage, 20, "Dhan futures must be FIXED ₹20 per executed order, not lower of 0.03%");

    // Commodity Futures: FIXED ₹20 per executed order
    const commFut = calculateBrokerageForLeg({
        broker: "DHAN",
        productType: "COMMODITY_FUTURES",
        turnover: 10000
    });
    assert.equal(commFut.brokerage, 20, "Dhan commodity futures must be FIXED ₹20 per executed order");

    // Physical delivery settlement rule: 0.10% of contract value
    const phys = calculateBrokerageForLeg({
        broker: "DHAN",
        productType: "EQUITY_FUTURES",
        turnover: 500000,
        isPhysicalDelivery: true
    });
    assert.equal(phys.brokerage, 500, "Dhan derivative contracts resulting in physical delivery must attract 0.10% (₹500 on ₹5L)");
});

test("3. Angel One's ₹5 minimum and ₹500 introductory waiver cap", () => {
    // Delivery: Lower of ₹20 or 0.1% with ₹5 MINIMUM per order (after 30 days offer)
    const delTiny = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_DELIVERY",
        turnover: 1000, // 0.1% of ₹1,000 = ₹1, but minimum ₹5 applies
        daysSinceOnboarding: 45
    });
    assert.equal(delTiny.brokerage, 5, "Angel One delivery on ₹1,000 must enforce ₹5 minimum");

    const delMid = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_DELIVERY",
        turnover: 10000, // 0.1% of ₹10,000 = ₹10
        daysSinceOnboarding: 45
    });
    assert.equal(delMid.brokerage, 10, "Angel One delivery on ₹10,000 must be ₹10 (0.1%)");

    const delCap = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_DELIVERY",
        turnover: 50000, // 0.1% of ₹50,000 = ₹50, capped at ₹20
        daysSinceOnboarding: 45
    });
    assert.equal(delCap.brokerage, 20, "Angel One delivery must cap at ₹20");

    // Intraday: Lower of ₹20 or 0.1% (verify 0.03% removed) with ₹5 minimum
    const intraTiny = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_INTRADAY",
        turnover: 2000, // 0.1% of ₹2,000 = ₹2, minimum ₹5 applies
        daysSinceOnboarding: 45
    });
    assert.equal(intraTiny.brokerage, 5, "Angel One intraday on ₹2,000 must enforce ₹5 minimum");

    const intraRate = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_INTRADAY",
        turnover: 15000, // 0.1% of ₹15,000 = ₹15
        daysSinceOnboarding: 45
    });
    assert.equal(intraRate.brokerage, 15, "Angel One intraday on ₹15,000 must be ₹15 (0.1%, not 0.03%)");

    // Introductory waiver cap: up to ₹500 waived during first 30 days
    // Test within first 30 days with ₹0 previously waived
    const promo1 = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_FUTURES",
        turnover: 100000, // Standard fee: ₹20
        daysSinceOnboarding: 10,
        waivedBrokerageSoFar: 0
    });
    assert.equal(promo1.brokerage, 0, "Brokerage within first 30 days should be waived if under ₹500 cap");
    assert.equal(promo1.waived, 20, "Waived amount should be tracked as ₹20");

    // Test when waiver cap of ₹500 is almost exhausted (e.g. ₹490 already waived)
    const promo2 = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_FUTURES",
        turnover: 100000, // Standard fee: ₹20
        daysSinceOnboarding: 10,
        waivedBrokerageSoFar: 490 // Only ₹10 remaining of the ₹500 cap
    });
    assert.equal(promo2.waived, 10, "Remaining waiver must be capped at ₹10");
    assert.equal(promo2.brokerage, 10, "Remaining ₹10 of standard fee must be charged");

    // Test when waiver cap of ₹500 is completely exhausted
    const promo3 = calculateBrokerageForLeg({
        broker: "ANGEL_ONE",
        productType: "EQUITY_FUTURES",
        turnover: 100000,
        daysSinceOnboarding: 10,
        waivedBrokerageSoFar: 500
    });
    assert.equal(promo3.waived, 0, "No waiver after ₹500 cap reached");
    assert.equal(promo3.brokerage, 20, "Full ₹20 charged after ₹500 cap reached");
});

test("4. Kotak Neo delivery brokerage under both plans", () => {
    // Trade Free Youth (<30 yrs): Equity Delivery is ₹0
    const youthDel = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "YOUTH",
        productType: "EQUITY_DELIVERY",
        turnover: 100000,
        daysSinceOnboarding: 60
    });
    assert.equal(youthDel.brokerage, 0, "Kotak Neo Youth plan must offer ₹0 equity delivery brokerage");

    // Trade Free Plan (Standard / 30+ yrs): Equity Delivery after 30 days is 0.20% of trade value
    const tfDel = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "TRADE_FREE",
        productType: "EQUITY_DELIVERY",
        turnover: 100000, // 0.20% of ₹1,00,000 = ₹200
        daysSinceOnboarding: 60
    });
    assert.equal(tfDel.brokerage, 200, "Kotak Neo Trade Free plan must charge 0.20% (₹200 on ₹1L) after 30 days");
});

test("5. Kotak Neo first-30-day offer expiry", () => {
    // Within first 30 days: ₹0 on Intraday, Futures, and Options
    const day10Intra = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "TRADE_FREE",
        productType: "EQUITY_INTRADAY",
        turnover: 50000,
        daysSinceOnboarding: 10
    });
    assert.equal(day10Intra.brokerage, 0, "Kotak Neo intraday must be ₹0 for first 30 days");

    const day10Fut = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "TRADE_FREE",
        productType: "EQUITY_FUTURES",
        turnover: 100000,
        daysSinceOnboarding: 10
    });
    assert.equal(day10Fut.brokerage, 0, "Kotak Neo futures must be ₹0 for first 30 days");

    // After 30 days (day 35):
    // Intraday: lower of ₹10 or 0.05%
    const day35IntraSmall = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "TRADE_FREE",
        productType: "EQUITY_INTRADAY",
        turnover: 10000, // 0.05% of ₹10,000 = ₹5
        daysSinceOnboarding: 35
    });
    assert.equal(day35IntraSmall.brokerage, 5, "Kotak Neo intraday after 30 days on ₹10k must be ₹5 (0.05%)");

    const day35IntraCap = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "TRADE_FREE",
        productType: "EQUITY_INTRADAY",
        turnover: 50000, // 0.05% of ₹50,000 = ₹25, capped at ₹10
        daysSinceOnboarding: 35
    });
    assert.equal(day35IntraCap.brokerage, 10, "Kotak Neo intraday after 30 days must be capped at ₹10");

    // F&O after 30 days: fixed ₹10 per order
    const day35Fut = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "TRADE_FREE",
        productType: "EQUITY_FUTURES",
        turnover: 100000,
        daysSinceOnboarding: 35
    });
    assert.equal(day35Fut.brokerage, 10, "Kotak Neo futures after 30 days must be fixed ₹10 per order");

    const day35Opt = calculateBrokerageForLeg({
        broker: "KOTAK_NEO",
        plan: "TRADE_FREE",
        productType: "EQUITY_OPTIONS",
        turnover: 10000,
        daysSinceOnboarding: 35
    });
    assert.equal(day35Opt.brokerage, 10, "Kotak Neo options after 30 days must be fixed ₹10 per order");
});

test("6. GST base, exchange charges, STT and stamp duty verification", () => {
    // Test statutory rules against Finance Act 2024 / SEBI specifications
    const stt = brokerConfig.statutoryCharges.STT;
    assert.equal(stt.equityDelivery.buy, 0.10, "Delivery STT buy must be 0.1%");
    assert.equal(stt.equityDelivery.sell, 0.10, "Delivery STT sell must be 0.1%");
    assert.equal(stt.equityIntraday.buy, 0, "Intraday STT buy must be 0%");
    assert.equal(stt.equityIntraday.sell, 0.025, "Intraday STT sell must be 0.025%");
    assert.equal(stt.equityFutures.sell, 0.02, "Futures STT sell must be 0.02% post-Finance Act 2024");
    assert.equal(stt.equityOptions.sell, 0.10, "Options STT sell must be 0.10% post-Finance Act 2024");

    // Stamp Duty buy-side only
    const stamp = brokerConfig.statutoryCharges.stampDuty;
    assert.equal(stamp.equityDelivery.buy, 0.015, "Delivery stamp duty must be 0.015%");
    assert.equal(stamp.equityDelivery.sell, 0, "Delivery stamp duty sell must be 0%");
    assert.equal(stamp.equityIntraday.buy, 0.003, "Intraday stamp duty must be 0.003%");
    assert.equal(stamp.equityFutures.buy, 0.002, "Futures stamp duty must be 0.002%");
    assert.equal(stamp.equityOptions.buy, 0.003, "Options stamp duty must be 0.003%");

    // SEBI turnover charge: ₹10 per crore
    assert.equal(brokerConfig.statutoryCharges.SEBI.ratePerCrore, 10, "SEBI charge must be ₹10 per crore");

    // GST rate: 18% on (Brokerage + Exchange + SEBI)
    assert.equal(brokerConfig.statutoryCharges.GST.rate, 18, "GST rate must be 18%");
    assert.deepEqual(brokerConfig.statutoryCharges.GST.appliesTo, ["BROKERAGE", "EXCHANGE_CHARGES", "SEBI_CHARGES"]);
});

test("7. Buy-side versus sell-side fee applicability", () => {
    // STT is NOT charged on Buy side for intraday or futures
    assert.equal(brokerConfig.statutoryCharges.STT.equityIntraday.buy, 0);
    assert.equal(brokerConfig.statutoryCharges.STT.equityFutures.buy, 0);
    assert.equal(brokerConfig.statutoryCharges.STT.equityOptions.buy, 0);

    // Stamp duty is ONLY charged on Buy side, never Sell side
    assert.equal(brokerConfig.statutoryCharges.stampDuty.equityDelivery.sell, 0);
    assert.equal(brokerConfig.statutoryCharges.stampDuty.equityIntraday.sell, 0);
    assert.equal(brokerConfig.statutoryCharges.stampDuty.equityFutures.sell, 0);
    assert.equal(brokerConfig.statutoryCharges.stampDuty.equityOptions.sell, 0);

    // DP charges are ONLY charged on delivery sell, never on buy
    assert.equal(brokerConfig.brokers.UPSTOX.plans.STANDARD.dpCharges.sell, 20);
    assert.equal(brokerConfig.brokers.DHAN.plans.STANDARD.dpCharges.sell, 12.5);
    assert.equal(brokerConfig.brokers.ANGEL_ONE.plans.STANDARD.dpCharges.sell, 20);
    assert.equal(brokerConfig.brokers.KOTAK_NEO.plans.TRADE_FREE.dpCharges.sell, 15);
});

test("8. Single leg vs round-trip (multiple executed orders)", () => {
    // 1 buy order (₹50k) + 1 sell order (₹55k) on Upstox Delivery:
    // Fixed ₹20 on buy + Fixed ₹20 on sell = ₹40 total brokerage
    const buyLeg = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_DELIVERY",
        turnover: 50000
    });
    const sellLeg = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_DELIVERY",
        turnover: 55000
    });
    assert.equal(buyLeg.brokerage + sellLeg.brokerage, 40, "Two executed delivery orders must total ₹40 brokerage");
});

test("9. Missing, unverified, or boundary case handling", () => {
    // Invalid broker
    const invalidBroker = calculateBrokerageForLeg({
        broker: "UNKNOWN_BROKER",
        productType: "EQUITY_INTRADAY",
        turnover: 50000
    });
    assert.equal(invalidBroker.brokerage, 0);
    assert.equal(invalidBroker.effectiveRate, "Invalid broker");

    // Zero turnover
    const zeroTurnover = calculateBrokerageForLeg({
        broker: "UPSTOX",
        productType: "EQUITY_INTRADAY",
        turnover: 0
    });
    assert.equal(zeroTurnover.brokerage, 0);
});
