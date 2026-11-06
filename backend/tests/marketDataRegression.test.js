import test from "node:test";
import assert from "node:assert/strict";
import quoteCache from "../src/services/marketData/quoteCache.js";
import { getMarketSession, isAnyMarketOpen, isIndianMarketOpen } from "../src/services/marketData/marketSessionService.js";
import positionEngine from "../src/services/position/PositionEngine.js";
import { mapUpstoxTrade, mapUpstoxPosition, parseUpstoxTimestamp } from "../src/brokers/upstox/UpstoxMapper.js";
import upstoxInstrumentService from "../src/services/marketData/upstoxInstrumentService.js";

// ==========================================
// MARKET DATA REGRESSION TESTS
// ==========================================

test("MarketData Regression 1: Market-closed quote maintains last valid price and never fabricates Date.now()", () => {
    quoteCache.clear();
    const key = "NSE_EQ|INE002A01018"; // Reliance
    const historicalTradeTime = new Date("2026-10-30T14:45:00.000+05:30").getTime();

    // 1. Ingest a valid quote with explicit timestamp
    const res1 = quoteCache.updateQuote(key, {
        ltp: 2855.75,
        cp: 2810.00,
        open: 2820.00,
        high: 2865.00,
        low: 2815.00,
        timestamp: historicalTradeTime,
        source: "UPSTOX_REST"
    });

    assert.equal(res1.accepted, true);
    const cached1 = quoteCache.getQuote(key);
    assert.equal(cached1.lastPrice, 2855.75);
    assert.equal(cached1.previousClose, 2810.00);
    assert.equal(cached1.lastPriceAt, historicalTradeTime);

    // 2. Simulate API response when market is closed omitting or providing null timestamp
    const res2 = quoteCache.updateQuote(key, {
        ltp: 2855.75,
        timestamp: null, // No fresh trade occurred
        source: "UPSTOX_REST_CLOSED"
    });

    const cached2 = quoteCache.getQuote(key);
    assert.equal(cached2.lastPrice, 2855.75, "Price must remain stable when market is closed");
    assert.equal(cached2.lastPriceAt, historicalTradeTime, "lastPriceAt must not be fabricated with Date.now()");
    assert.notEqual(cached2.lastPriceAt, cached2.quoteReceivedAt, "Provider timestamp must be separated from receipt timestamp");
});

test("MarketData Regression 2: Out-of-order quote rejection prevents stale updates from overwriting newer ones", () => {
    quoteCache.clear();
    const key = "NSE_EQ|INE467B01029"; // TCS
    const tNewer = new Date("2026-10-30T11:30:00.000+05:30").getTime();
    const tOlder = new Date("2026-10-30T11:25:00.000+05:30").getTime();

    // 1. Ingest newer quote first (e.g. from fast WebSocket)
    quoteCache.updateQuote(key, {
        ltp: 3950.00,
        timestamp: tNewer,
        source: "WS"
    });

    // 2. Delayed older quote arrives later (e.g. from lagging polling loop)
    const delayedRes = quoteCache.updateQuote(key, {
        ltp: 3940.00,
        timestamp: tOlder,
        source: "REST_DELAYED"
    });

    assert.equal(delayedRes.accepted, false, "Older quote must be rejected");
    assert.equal(delayedRes.reason, "STALE_TIMESTAMP");

    const cached = quoteCache.getQuote(key);
    assert.equal(cached.lastPrice, 3950.00, "Price must not be reverted to older quote");
    assert.equal(cached.lastPriceAt, tNewer);
});

test("MarketData Regression 3: Non-positive, zero, NaN and infinite prices are strictly rejected", () => {
    quoteCache.clear();
    const key = "NSE_EQ|INFY";

    const invalidInputs = [
        { ltp: 0 },
        { ltp: -150 },
        { ltp: NaN },
        { ltp: Infinity },
        { ltp: "invalid_string" },
        { ltp: null }
    ];

    for (const input of invalidInputs) {
        const res = quoteCache.updateQuote(key, input);
        assert.equal(res.accepted, false, `Price ${input.ltp} must be rejected`);
        assert.equal(res.reason, "INVALID_PRICE");
    }

    assert.equal(quoteCache.getQuote(key), null, "Cache must remain empty for invalid prices");
});

test("MarketData Regression 4: Canonical key resolution resolves colon and pipe formats seamlessly", () => {
    quoteCache.clear();
    const canonicalKey = "NSE_EQ|INE002A01018";
    const colonKey = "NSE_EQ:RELIANCE";

    // Register alias mapping in cache
    quoteCache.registerAlias(colonKey, canonicalKey);

    quoteCache.updateQuote(canonicalKey, {
        ltp: 2870.00,
        timestamp: Date.now(),
        source: "UPSTOX"
    });

    // Both canonical and colon alias lookups must return the exact same quote
    const byCanonical = quoteCache.getQuote(canonicalKey);
    const byColon = quoteCache.getQuote(colonKey);

    assert.ok(byCanonical);
    assert.ok(byColon);
    assert.equal(byCanonical.lastPrice, 2870.00);
    assert.equal(byColon.lastPrice, 2870.00);
});

test("MarketData Regression 5: Multi-segment trading sessions support F&O, Currency, Commodity, and Muhurat", () => {
    // 1. Regular Equity F&O (09:15 - 15:30 IST)
    const foTime = new Date("2026-10-30T10:00:00.000+05:30");
    const foSession = getMarketSession("NSE", "FUTURES", foTime);
    assert.equal(foSession.isOpen, true);
    assert.equal(foSession.session, "REGULAR");

    // 2. Currency Derivatives (09:00 - 17:00 IST)
    const currencyTime = new Date("2026-10-30T16:15:00.000+05:30");
    const currSession = getMarketSession("NSE", "CURRENCY", currencyTime);
    assert.equal(currSession.isOpen, true, "Currency session must be open at 16:15 IST");

    // Equity cash is closed at 16:15 IST
    const equitySession = getMarketSession("NSE", "EQUITY", currencyTime);
    assert.equal(equitySession.isOpen, false, "Cash equity must be closed at 16:15 IST");

    // 3. Commodity MCX (09:00 - 23:30 IST)
    const commodityTime = new Date("2026-10-30T21:00:00.000+05:30");
    const mcxSession = getMarketSession("MCX", "COMMODITY", commodityTime);
    assert.equal(mcxSession.isOpen, true, "MCX Commodity must be open at 21:00 IST");

    // 4. Diwali Muhurat Trading (18:15 - 19:15 IST on Nov 8, 2026)
    const muhuratTime = new Date("2026-11-08T18:30:00.000+05:30");
    const muhuratSession = getMarketSession("NSE", "EQUITY", muhuratTime);
    assert.equal(muhuratSession.isOpen, true, "Muhurat trading must be open at 18:30 IST");
    assert.equal(muhuratSession.session, "MUHURAT");

    // 5. isAnyMarketOpen detects if any subscribed instrument has an active market
    const openForAny = isAnyMarketOpen(["MCX_FO|CRUDEOIL"], commodityTime);
    assert.equal(openForAny, true, "isAnyMarketOpen must return true when MCX is open at 21:00 IST");
});

test("MarketData Regression 6: ExcludeExpiredIntraday excludes stale intraday trades from prior days", () => {
    const today = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const trades = [
        {
            _id: "trade-today-1",
            symbol: "HDFCBANK",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 50,
            executedPrice: 1650.00,
            tradeTime: today,
            status: "COMPLETE"
        },
        {
            _id: "trade-yesterday-1",
            symbol: "HDFCLIFE",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 100,
            executedPrice: 650.00,
            tradeTime: yesterday,
            status: "COMPLETE"
        }
    ];

    // With excludeExpiredIntraday: true, the yesterday intraday trade must not appear as a live open trade!
    const openPositions = positionEngine.getOpenPositions(trades, { excludeExpiredIntraday: true });
    assert.equal(openPositions.length, 1, "Only today's intraday trade should be returned");
    assert.equal(openPositions[0].symbol, "HDFCBANK");
    assert.equal(openPositions.find(p => p.symbol === "HDFCLIFE"), undefined, "Expired yesterday intraday trade must be excluded");
});
