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

test("MarketData Regression 7: Newer quote followed by missing timestamp cannot overwrite verified price", () => {
    quoteCache.clear();
    const key = "NSE_EQ|INFY";
    const verifiedTime = new Date("2026-11-06T11:00:00.000+05:30").getTime();

    // 1. First ingest a verified quote with valid timestamp
    const res1 = quoteCache.updateQuote(key, {
        ltp: 1850.00,
        timestamp: verifiedTime,
        source: "UPSTOX_WS"
    });
    assert.equal(res1.accepted, true);

    // 2. Incoming update has missing/null timestamp
    const res2 = quoteCache.updateQuote(key, {
        ltp: 1820.00, // fabricated or unverified price
        timestamp: null,
        source: "POLLING_NO_TS"
    });

    assert.equal(res2.accepted, false, "Quote with missing timestamp must not overwrite newer verified quote");
    assert.equal(res2.reason, "MISSING_TIMESTAMP_OVERWRITE_PREVENTED");

    // Verified price must remain unchanged
    const cached = quoteCache.getQuote(key);
    assert.equal(cached.lastPrice, 1850.00, "Price must remain preserved");
    assert.equal(cached.lastPriceAt, verifiedTime);
});

test("MarketData Regression 8: Missing timestamp with NO existing quote is stored with lastPriceAt: null and not LIVE", () => {
    quoteCache.clear();
    const key = "NSE_EQ|SBIN";

    // Quote with no timestamp arrives for a symbol not yet in cache
    const res = quoteCache.updateQuote(key, {
        ltp: 820.00,
        source: "INITIAL_SEED"
    });

    assert.equal(res.accepted, true, "New quote with missing timestamp should be accepted as baseline");
    const cached = quoteCache.getQuote(key);
    assert.equal(cached.lastPrice, 820.00);
    assert.equal(cached.lastPriceAt, null, "lastPriceAt must be null without provider timestamp");
    assert.notEqual(cached.quoteFreshness, "LIVE", "Must never classify quote as LIVE without freshness timestamp evidence");
});

test("MarketData Regression 9: Malformed timestamp values are rejected explicitly", () => {
    quoteCache.clear();
    const key = "NSE_EQ|WIPRO";

    const malformedCases = [
        { ltp: 550, timestamp: "invalid-date-string" },
        { ltp: 550, timestamp: -99999 },
        { ltp: 550, lastPriceAt: NaN }
    ];

    for (const testCase of malformedCases) {
        const res = quoteCache.updateQuote(key, testCase);
        assert.equal(res.accepted, false, `Malformed timestamp ${testCase.timestamp} must be rejected`);
        assert.equal(res.reason, "MALFORMED_TIMESTAMP");
    }
});

test("MarketData Regression 10: Duplicate updates with identical timestamp preserve cache and quote source", () => {
    quoteCache.clear();
    const key = "NSE_EQ|ITC";
    const ts = new Date("2026-11-06T10:15:00.000+05:30").getTime();

    const res1 = quoteCache.updateQuote(key, { ltp: 490.00, timestamp: ts, source: "WS" });
    assert.equal(res1.accepted, true);

    // Duplicate update with same timestamp
    const res2 = quoteCache.updateQuote(key, { ltp: 490.00, timestamp: ts, source: "WS" });
    assert.equal(res2.accepted, true);

    const cached = quoteCache.getQuote(key);
    assert.equal(cached.lastPrice, 490.00);
    assert.equal(cached.lastPriceAt, ts);
    assert.equal(cached.quoteSource, "WS");
});

test("MarketData Regression 11: REST vs WebSocket race condition - delayed REST rejected after fast WS update", () => {
    quoteCache.clear();
    const key = "NSE_EQ|BAJFINANCE";

    const wsTime = new Date("2026-11-06T11:45:02.000+05:30").getTime();
    const restDelayedTime = new Date("2026-11-06T11:45:00.000+05:30").getTime();

    // 1. Fast WebSocket tick arrives first at 11:45:02
    const wsRes = quoteCache.updateQuote(key, {
        ltp: 7200.00,
        timestamp: wsTime,
        source: "UPSTOX_WS"
    });
    assert.equal(wsRes.accepted, true);

    // 2. Delayed REST response from earlier in-flight request arrives at 11:45:00
    const restRes = quoteCache.updateQuote(key, {
        ltp: 7185.00,
        timestamp: restDelayedTime,
        source: "UPSTOX_REST"
    });
    assert.equal(restRes.accepted, false, "Delayed REST quote must be rejected");
    assert.equal(restRes.reason, "STALE_TIMESTAMP");

    // Ensure WS price is preserved
    const cached = quoteCache.getQuote(key);
    assert.equal(cached.lastPrice, 7200.00);
    assert.equal(cached.quoteSource, "UPSTOX_WS");
});

test("MarketData Regression 12: parseUpstoxTimestamp prioritizes exchange execution time and never fabricates Date.now()", () => {
    // 1. Missing timestamp returns null (never new Date())
    assert.equal(parseUpstoxTimestamp(null), null);
    assert.equal(parseUpstoxTimestamp({}), null);
    assert.equal(parseUpstoxTimestamp(""), null);
    assert.equal(parseUpstoxTimestamp("invalid-date-xyz"), null);

    // 2. Exchange execution timestamp takes priority over order placement timestamp
    const tradeObj = {
        order_timestamp: "2026-11-06 09:15:00",
        exchange_timestamp: "2026-11-06 09:15:05"
    };
    const parsed = parseUpstoxTimestamp(tradeObj);
    assert.ok(parsed instanceof Date);
    // 09:15:05 IST = 03:45:05 UTC
    assert.equal(parsed.toISOString(), "2026-11-06T03:45:05.000Z");

    // 3. Epoch ms and epoch seconds handling
    const epochMs = 1730865300000;
    assert.equal(parseUpstoxTimestamp(epochMs).getTime(), epochMs);
    assert.equal(parseUpstoxTimestamp(Math.round(epochMs / 1000)).getTime(), epochMs);
});

test("MarketData Regression 13: mapUpstoxInstrumentSegment supports all 5 segments and rejects ambiguous instruments", async () => {
    const { mapUpstoxInstrumentSegment } = await import("../src/brokers/upstox/UpstoxMapper.js");

    // 1. Authoritative instrument types
    assert.equal(mapUpstoxInstrumentSegment({ instrument_type: "EQ" }), "EQUITY");
    assert.equal(mapUpstoxInstrumentSegment({ instrument_type: "FUTSTK" }), "FUTURES");
    assert.equal(mapUpstoxInstrumentSegment({ instrument_type: "OPTIDX" }), "OPTIONS");
    assert.equal(mapUpstoxInstrumentSegment({ instrument_type: "CUR" }), "CURRENCY");
    assert.equal(mapUpstoxInstrumentSegment({ instrument_type: "COM" }), "COMMODITY");

    // 2. Authoritative exchange
    assert.equal(mapUpstoxInstrumentSegment({ exchange: "MCX", symbol: "GOLD" }), "COMMODITY");
    assert.equal(mapUpstoxInstrumentSegment({ exchange: "CDS", symbol: "USDINR" }), "CURRENCY");

    // 3. Reject ambiguous / unidentifiable instruments
    assert.equal(mapUpstoxInstrumentSegment(null), null);
    assert.equal(mapUpstoxInstrumentSegment({}), null);
    assert.equal(mapUpstoxInstrumentSegment({ symbol: "MYSTERY_XYZ" }), null);
});
