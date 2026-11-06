import test from "node:test";
import assert from "node:assert";
import positionEngine from "../src/services/position/PositionEngine.js";
import KotakNeoAdapter from "../src/brokers/kotakNeo/KotakNeoAdapter.js";

test("PositionEngine - Exited broker position is cleanly squared and filtered out of open positions", () => {
    // 1. Setup a computed open position from trade history (e.g., BUY 10 RELIANCE)
    const initialTrades = [
        {
            _id: "trade-1",
            tradeId: "TRD-001",
            symbol: "RELIANCE",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 10,
            executedPrice: 2500,
            status: "COMPLETE",
            tradeTime: new Date("2026-10-30T10:00:00Z")
        }
    ];

    const openPositions = positionEngine.getOpenPositions(initialTrades);
    assert.strictEqual(openPositions.length, 1);
    assert.strictEqual(openPositions[0].symbol, "RELIANCE");
    assert.strictEqual(openPositions[0].openQuantity, 10);
    assert.strictEqual(openPositions[0].status, "OPEN");

    // 2. Simulate broker reporting the position has been exited on the broker app (netQuantity: 0, status: CLOSED)
    const brokerPositions = [
        {
            trading_symbol: "RELIANCE-EQ",
            symbol: "RELIANCE",
            exchange: "NSE",
            quantity: 0,
            netQuantity: 0,
            status: "CLOSED",
            realizedPnL: 350.50,
            lastPrice: 2535
        }
    ];

    const reconciledOpen = positionEngine.reconcileWithBrokerPositions(openPositions, brokerPositions);

    // 3. Must be excluded from open positions so the live dashboard does not show it open
    assert.strictEqual(reconciledOpen.length, 0, "Exited position must not remain in open positions");
});

test("PositionEngine - Partially squared broker position updates open quantity correctly", () => {
    const initialTrades = [
        {
            _id: "trade-2",
            tradeId: "TRD-002",
            symbol: "INFY",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 20,
            executedPrice: 1800,
            status: "COMPLETE",
            tradeTime: new Date("2026-10-30T10:15:00Z")
        }
    ];

    const openPositions = positionEngine.getOpenPositions(initialTrades);
    assert.strictEqual(openPositions.length, 1);
    assert.strictEqual(openPositions[0].openQuantity, 20);

    // Broker reports user sold 12 shares, leaving 8 shares open
    const brokerPositions = [
        {
            trading_symbol: "INFY-EQ",
            symbol: "INFY",
            exchange: "NSE",
            quantity: 8,
            netQuantity: 8,
            status: "OPEN",
            lastPrice: 1820
        }
    ];

    const reconciled = positionEngine.reconcileWithBrokerPositions(openPositions, brokerPositions);
    assert.strictEqual(reconciled.length, 1);
    assert.strictEqual(reconciled[0].openQuantity, 8, "Open quantity must reflect broker net quantity");
    assert.strictEqual(reconciled[0].brokerQuantity, 8);
});

test("KotakNeoAdapter - Order placement normalizes cash equity symbol to include -EQ suffix", async () => {
    const adapter = new KotakNeoAdapter({
        clientId: "TEST_UCC",
        mobileNumber: "+919876543210",
        password: "123456",
        apiKey: "TEST_KEY",
        accessToken: "MOCK_TOKEN"
    });

    let capturedPayload = null;
    adapter._request = async (method, path, data) => {
        capturedPayload = data;
        return { nOrdNo: "26103000001", stat: "Ok" };
    };

    // Case 1: Plain symbol "LTF"
    await adapter.placeOrder({
        symbol: "LTF",
        exchangeSegment: "nse_cm",
        transactionType: "B",
        orderType: "MKT",
        productCode: "CNC",
        quantity: 5
    });

    assert.ok(capturedPayload);
    assert.strictEqual(capturedPayload.ts, "LTF-EQ", "Symbol 'LTF' must be normalized to 'LTF-EQ' for nse_cm");

    // Case 2: Symbol with exchange pipe prefix "NSE_EQ|RELIANCE"
    await adapter.placeOrder({
        symbol: "NSE_EQ|RELIANCE",
        exchangeSegment: "nse_cm",
        transactionType: "BUY",
        orderType: "MKT",
        productCode: "MIS",
        quantity: 10
    });

    assert.strictEqual(capturedPayload.ts, "RELIANCE-EQ", "Prefix 'NSE_EQ|' must be stripped and -EQ appended");

    // Case 3: Already has -EQ
    await adapter.placeOrder({
        symbol: "TCS-EQ",
        exchangeSegment: "nse_cm",
        transactionType: "B",
        orderType: "MKT",
        productCode: "CNC",
        quantity: 1
    });

    assert.strictEqual(capturedPayload.ts, "TCS-EQ", "Symbol already ending in -EQ must remain 'TCS-EQ'");

    // Case 4: Market order with non-zero price (e.g. from master trade) must force pr="0"
    await adapter.placeOrder({
        symbol: "GREENPLY",
        exchangeSegment: "nse_cm",
        transactionType: "BUY",
        orderType: "MARKET",
        productCode: "MIS",
        quantity: 1,
        price: "280.20",
        triggerPrice: "0"
    });

    assert.strictEqual(capturedPayload.ts, "GREENPLY-EQ");
    assert.strictEqual(capturedPayload.pt, "MKT", "orderType 'MARKET' must normalize to 'MKT'");
    assert.strictEqual(capturedPayload.pr, "0", "Market order price must be forced to '0' to avoid Kotak 400 body invalid");
    assert.strictEqual(capturedPayload.tp, "0", "Market order trigger price must be '0'");

    // Case 5: Limit order with price
    await adapter.placeOrder({
        symbol: "INFY",
        exchangeSegment: "nse_cm",
        transactionType: "BUY",
        orderType: "LIMIT",
        productCode: "CNC",
        quantity: 10,
        price: 1550.5
    });

    assert.strictEqual(capturedPayload.pt, "L", "orderType 'LIMIT' must normalize to 'L'");
    assert.strictEqual(capturedPayload.pr, "1550.50", "Limit order price must be formatted with 2 decimal places");
});

test("KotakNeoAdapter - Avoids background auto re-login loop on expired 6-digit static OTP codes", async () => {
    const adapter = new KotakNeoAdapter({
        clientId: "W0WLI",
        mobileNumber: "+919876543210",
        password: "123456",
        apiKey: "TEST_KEY",
        accessToken: "EXPIRED_SESSION_TOKEN",
        totpSecret: "482910" // Stale 6-digit static OTP
    });

    let loginCalled = false;
    adapter.login = async () => {
        loginCalled = true;
        throw new Error("Invalid TOTP (Code: 10506)");
    };

    adapter._request = async (method, path, data, options = {}) => {
        if (!options._retried) {
            const err = new Error("Kotak Neo API Error (401): invalid session token");
            err.response = { status: 401, data: { errMsg: "invalid session token" } };
            throw err;
        }
    };

    await assert.rejects(
        async () => {
            await adapter.getPositions();
        },
        /invalid session token/i
    );

    assert.strictEqual(loginCalled, false, "Must not attempt automated re-login with an expired 6-digit static OTP");
});

test("PositionEngine - Cash equity trades match across NSE and BSE fungibly to prevent ghost open trades", () => {
    // User bought 5 ITC on NSE and sold 5 ITC on BSE
    // User bought 11 TATASTEEL on NSE + 3 on BSE (total 14) and sold 14 on NSE
    const trades = [
        {
            _id: "t1",
            tradeId: "TRD-ITC-B",
            symbol: "ITC",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "CNC",
            transactionType: "BUY",
            quantity: 5,
            executedPrice: 420.5,
            tradeTime: new Date("2026-10-30T09:30:00Z")
        },
        {
            _id: "t2",
            tradeId: "TRD-ITC-S",
            symbol: "ITC",
            exchange: "BSE",
            segment: "EQUITY",
            productType: "CNC",
            transactionType: "SELL",
            quantity: 5,
            executedPrice: 422.0,
            tradeTime: new Date("2026-10-30T10:00:00Z")
        },
        {
            _id: "t3",
            tradeId: "TRD-TATA-B1",
            symbol: "Tata Steel",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "DELIVERY",
            transactionType: "BUY",
            quantity: 11,
            executedPrice: 155.0,
            tradeTime: new Date("2026-10-30T09:35:00Z")
        },
        {
            _id: "t4",
            tradeId: "TRD-TATA-B2",
            symbol: "TATASTEEL",
            exchange: "BSE",
            segment: "EQUITY",
            productType: "DELIVERY",
            transactionType: "BUY",
            quantity: 3,
            executedPrice: 155.5,
            tradeTime: new Date("2026-10-30T09:40:00Z")
        },
        {
            _id: "t5",
            tradeId: "TRD-TATA-S1",
            symbol: "TATASTEEL",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "DELIVERY",
            transactionType: "SELL",
            quantity: 14,
            executedPrice: 158.0,
            tradeTime: new Date("2026-10-30T11:00:00Z")
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    assert.strictEqual(openPositions.length, 0, "All 4 legs must be matched to 0 open positions");

    const squaredPositions = positionEngine.getFullySquaredPositions(trades);
    assert.strictEqual(squaredPositions.length, 2, "Must produce 2 fully squared contracts (ITC and TATASTEEL)");
});

test("BrokerAccountController - Dhan 401 invalid token marks account disconnected and saves verificationError", async () => {
    const { verifyBrokerCredentials } = await import("../src/controllers/brokerAccountController.js");
    let saved = false;

    const mockAccount = {
        _id: "mock-dhan-1",
        broker: "DHAN",
        credentials: {
            clientId: "1000000001",
            accessToken: "invalid_or_expired_dhan_token_xyz"
        },
        isConnected: true,
        verificationError: null,
        isActive: true,
        save: async function () {
            saved = true;
            return this;
        }
    };

    const isConnected = await verifyBrokerCredentials(mockAccount);
    assert.strictEqual(isConnected, false, "Must return false when token is invalid");
    assert.strictEqual(mockAccount.isConnected, false, "Must update isConnected to false in DB document");
    assert.ok(mockAccount.verificationError, "Must set verificationError message");
    assert.strictEqual(saved, true, "Must persist changes to database");
});

test("DhanMapper - mapDhanPosition derives live price from unrealizedProfit & entry price on SHORT and LONG positions", async () => {
    const { mapDhanPosition } = await import("../src/brokers/dhan/DhanMapper.js");

    // Case 1: SHORT position with profit (HDFCLIFE: sold 1 @ 522.50, unrealizedProfit: 0.50 => LTP: 522.00)
    const shortPosProfit = {
        tradingSymbol: "HDFCLIFE",
        securityId: "467",
        positionType: "SHORT",
        exchangeSegment: "NSE_EQ",
        productType: "INTRADAY",
        buyAvg: 0,
        sellAvg: 522.50,
        costPrice: 522.50,
        netQty: -1,
        realizedProfit: 0,
        unrealizedProfit: 0.50
    };
    const mappedShortProfit = mapDhanPosition(shortPosProfit);
    assert.strictEqual(mappedShortProfit.lastPrice, 522.00, "SHORT with profit must have LTP lower than sell average");
    assert.strictEqual(mappedShortProfit.lastBrokerPrice, 522.00);
    assert.strictEqual(mappedShortProfit.securityId, "467");
    assert.strictEqual(mappedShortProfit.side, "SELL");

    // Case 2: SHORT position with loss (HDFCLIFE: sold 1 @ 522.50, unrealizedProfit: -0.80 => LTP: 523.30)
    const shortPosLoss = {
        ...shortPosProfit,
        unrealizedProfit: -0.80
    };
    const mappedShortLoss = mapDhanPosition(shortPosLoss);
    assert.strictEqual(mappedShortLoss.lastPrice, 523.30, "SHORT with loss must have LTP higher than sell average");
    assert.strictEqual(mappedShortLoss.lastBrokerPrice, 523.30);

    // Case 3: LONG position with profit (bought 10 @ 100.00, unrealizedProfit: 50.00 => LTP: 105.00)
    const longPos = {
        tradingSymbol: "TCS",
        securityId: "11536",
        positionType: "LONG",
        exchangeSegment: "NSE_EQ",
        productType: "INTRADAY",
        buyAvg: 100.00,
        costPrice: 100.00,
        netQty: 10,
        realizedProfit: 0,
        unrealizedProfit: 50.00
    };
    const mappedLong = mapDhanPosition(longPos);
    assert.strictEqual(mappedLong.lastPrice, 105.00, "LONG with profit must have LTP higher than buy average");
    assert.strictEqual(mappedLong.lastBrokerPrice, 105.00);
    assert.strictEqual(mappedLong.securityId, "11536");
    assert.strictEqual(mappedLong.side, "BUY");
});

test("PositionEngine & PnLEngine - Dhan position reconciles with live broker price and avoids Unavailable", async () => {
    const { mapDhanPosition } = await import("../src/brokers/dhan/DhanMapper.js");
    const pnlEngine = (await import("../src/services/pnl/PnLEngine.js")).default;

    const trades = [
        {
            _id: "trade-dhan-1",
            tradeId: "TRD-DHAN-01",
            symbol: "HDFCLIFE",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "SELL",
            quantity: 1,
            executedPrice: 522.50,
            status: "COMPLETE",
            broker: "DHAN",
            tradeTime: new Date()
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    const dhanBrokerPositions = [
        mapDhanPosition({
            tradingSymbol: "HDFCLIFE",
            securityId: "467",
            positionType: "SHORT",
            exchangeSegment: "NSE_EQ",
            productType: "INTRADAY",
            costPrice: 522.50,
            sellAvg: 522.50,
            netQty: -1,
            unrealizedProfit: -0.55
        })
    ];

    const reconciled = positionEngine.reconcileWithBrokerPositions(openPositions, dhanBrokerPositions);
    assert.strictEqual(reconciled.length, 1);
    assert.strictEqual(reconciled[0].lastBrokerPrice, 523.05);

    pnlEngine.setPositions("test-dhan-user", reconciled);
    const calculated = pnlEngine.calculate("test-dhan-user");
    assert.strictEqual(calculated.positions.length, 1);
    const p = calculated.positions[0];
    assert.strictEqual(p.symbol, "HDFCLIFE");
    assert.strictEqual(p.ltp, 523.05, "Current LTP must be exactly ₹523.05 derived from Dhan position");
    assert.notStrictEqual(p.quoteFreshness, "UNAVAILABLE", "Quote freshness must never be UNAVAILABLE");
    assert.strictEqual(p.quoteSource, "BROKER_POSITION");
});

test("BrokerAccountController - Kotak Neo accepts 6-digit Google Authenticator TOTP and connects successfully", async () => {
    const { verifyBrokerCredentials } = await import("../src/controllers/brokerAccountController.js");
    const KotakNeoAdapter = (await import("../src/brokers/kotakNeo/KotakNeoAdapter.js")).default;

    // Spy / mock KotakNeoAdapter.prototype.login
    const originalLogin = KotakNeoAdapter.prototype.login;
    let attemptedTotp = null;

    KotakNeoAdapter.prototype.login = async function () {
        attemptedTotp = this.totpSecret;
        this.tradingToken = "MOCK_TRADING_TOKEN_12345";
        this.tradingSid = "MOCK_SID_67890";
        this.baseUrl = "https://cis.kotaksecurities.com";
        return {
            tradingToken: this.tradingToken,
            tradingSid: this.tradingSid,
            baseUrl: this.baseUrl
        };
    };

    try {
        const mockKotakAccount = {
            _id: "mock-kotak-user-1",
            broker: "KOTAK_NEO",
            credentials: {
                clientId: "W0WLI",
                mobileNumber: "9723029081",
                password: "123456",
                apiKey: "mock-neo-api-token",
                totpSecret: "822892", // 6-digit code from Google Authenticator
                accessToken: ""
            },
            isConnected: false,
            verificationError: null,
            save: async function () { return this; }
        };

        const isConnected = await verifyBrokerCredentials(mockKotakAccount);
        assert.strictEqual(isConnected, true, "Must successfully connect when valid 6-digit TOTP is supplied");
        assert.strictEqual(attemptedTotp, "822892", "Must pass the 6-digit TOTP to adapter.login()");
        assert.strictEqual(mockKotakAccount.isConnected, true);
        assert.strictEqual(mockKotakAccount.credentials.accessToken, "MOCK_TRADING_TOKEN_12345");
        assert.strictEqual(mockKotakAccount.credentials.sid, "MOCK_SID_67890");
        assert.strictEqual(mockKotakAccount.verificationError, null);
    } finally {
        KotakNeoAdapter.prototype.login = originalLogin;
    }
});

test("OrderExecutionService & PnLEngine - Upstox position exit strictly routes to Upstox account and never Dhan", async () => {
    const pnlEngine = (await import("../src/services/pnl/PnLEngine.js")).default;
    const { OrderExecutionService } = await import("../src/services/trading/OrderExecutionService.js");

    const userId = "test-user-multi-broker-1";
    const testPositions = [
        {
            key: "BROKER|NSE_EQ|INE00H001014",
            symbol: "SWIGGY",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            broker: "UPSTOX",
            brokerAccountId: "upstox-acc-123",
            openQuantity: 1,
            netQuantity: 1,
            averagePrice: 180.10,
            status: "OPEN",
            side: "BUY"
        },
        {
            key: "BROKER|NSE_EQ|467",
            symbol: "HDFCLIFE",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            broker: "DHAN",
            brokerAccountId: "dhan-acc-456",
            securityId: "467",
            openQuantity: 1,
            netQuantity: -1,
            averagePrice: 522.50,
            status: "OPEN",
            side: "SELL"
        }
    ];

    pnlEngine.setPositions(userId, testPositions);
    const calculated = pnlEngine.calculate(userId);

    // Verify calculated positions retain broker and securityId metadata
    const swiggyPos = calculated.positions.find(p => p.symbol === "SWIGGY");
    const hdfcPos = calculated.positions.find(p => p.symbol === "HDFCLIFE");

    assert.ok(swiggyPos, "SWIGGY position must be present");
    assert.strictEqual(swiggyPos.broker, "UPSTOX");
    assert.strictEqual(swiggyPos.brokerAccountId, "upstox-acc-123");
    assert.strictEqual(swiggyPos.key, "BROKER|NSE_EQ|INE00H001014");

    assert.ok(hdfcPos, "HDFCLIFE position must be present");
    assert.strictEqual(hdfcPos.broker, "DHAN");
    assert.strictEqual(hdfcPos.brokerAccountId, "dhan-acc-456");
    assert.strictEqual(hdfcPos.securityId, "467");

    // In disconnected/mock mode, resolveBrokerAccount must preserve requested broker
    const upstoxAccount = await OrderExecutionService.resolveBrokerAccount(userId, swiggyPos, swiggyPos.brokerAccountId, swiggyPos.broker);
    assert.strictEqual(upstoxAccount.broker, "UPSTOX", "SWIGGY exit must strictly route to UPSTOX broker account");

    const dhanAccount = await OrderExecutionService.resolveBrokerAccount(userId, hdfcPos, hdfcPos.brokerAccountId, hdfcPos.broker);
    assert.strictEqual(dhanAccount.broker, "DHAN", "HDFCLIFE exit must strictly route to DHAN broker account");
});

test("DhanAdapter & BrokerAdapterFactory - resolves numeric securityId and formats DH-905 cleanly", async () => {
    const DhanAdapter = (await import("../src/brokers/dhan/DhanAdapter.js")).default;
    const BrokerAdapterFactory = (await import("../src/services/copyTrading/adapters/BrokerAdapterFactory.js")).default;

    // Verify DhanAdapter instance configuration
    const dhan = new DhanAdapter({ clientId: "1112095636", accessToken: "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJ1c2VyUmVnaW9uIjoiUjEiLCJpc3MiOiJkaGFuIiwicGFydG5lcklkIjoiIiwiZXhwIjoxNzkzNjgwMzYyLCJpYXQiOjE3OTM1OTM5NjIsInRva2VuQ29uc3VtZXJUeXBlIjoiU0VMRiIsIndlYmhvb2tVcmwiOiIiLCJkaGFuQ2xpZW50SWQiOiIxMTEyMDk1NjM2In0.mockSignature" });
    assert.ok(dhan.httpsAgent, "DhanAdapter must have httpsAgent configured");
    assert.strictEqual(dhan.httpsAgent.options.family, 4, "DhanAdapter must force IPv4 (family: 4)");

    // Test BrokerAdapterFactory numeric securityId resolution
    let capturedOrder = null;
    dhan.placeOrder = async (order) => {
        capturedOrder = order;
        return { orderId: "DHAN-ORD-999" };
    };

    const wrapped = BrokerAdapterFactory._wrapDhanAdapter(dhan, "dhan-acc-1");
    await wrapped.placeOrder({
        symbol: "HDFCLIFE",
        exchange: "NSE",
        segment: "EQUITY",
        instrumentToken: "NSE_EQ|467",
        transactionType: "BUY",
        quantity: 1
    });

    assert.ok(capturedOrder, "Order should be placed");
    assert.strictEqual(capturedOrder.securityId, "467", "Numeric securityId must be extracted from instrumentToken NSE_EQ|467");
    assert.strictEqual(capturedOrder.transactionType, "BUY");
});

test("KotakNeoSync - getKotakNeoAdapterForAccount skips background auto-login when TOTP is static 6-digit code", async () => {
    const { getKotakNeoAdapterForAccount } = await import("../src/brokers/kotakNeo/KotakNeoSyncService.js");
    const KotakNeoAdapter = (await import("../src/brokers/kotakNeo/KotakNeoAdapter.js")).default;

    let loginInvoked = false;
    const origLogin = KotakNeoAdapter.prototype.login;
    KotakNeoAdapter.prototype.login = async function () {
        loginInvoked = true;
        return { tradingToken: "MOCK_TOKEN" };
    };

    try {
        const mockBrokerAccount = {
            _id: "mock-kotak-id",
            broker: "KOTAK_NEO",
            isActive: true,
            isConnected: false,
            credentials: {
                clientId: "W0WLI",
                apiKey: "mock-api-key",
                mobileNumber: "9876543210",
                password: "mock-password",
                totpSecret: "822892", // 6-digit static OTP from Google Authenticator
                accessToken: "" // expired/missing
            },
            save: async () => {}
        };

        const adapter = await getKotakNeoAdapterForAccount(mockBrokerAccount);
        assert.strictEqual(loginInvoked, false, "Automated background login must NOT be attempted with static 6-digit OTP code");
        assert.ok(!adapter.tradingToken, "Adapter should not have a session token without reusable TOTP");
    } finally {
        KotakNeoAdapter.prototype.login = origLogin;
    }
});

test("PnLEngine - position calculation supplies entryPrice and executionPrice attributes", async () => {
    const pnlEngine = (await import("../src/services/pnl/PnLEngine.js")).default;
    const userId = "test-entry-price-user";

    pnlEngine.setPositions(userId, [
        {
            key: "NSE_EQ|HDFCLIFE",
            symbol: "HDFCLIFE",
            broker: "DHAN",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            side: "BUY",
            openQuantity: 1,
            averagePrice: 522.50,
            lastBrokerPrice: 523.00,
            ltp: 523.00
        }
    ]);

    const result = pnlEngine.calculate(userId);
    assert.strictEqual(result.positions.length, 1);
    const pos = result.positions[0];
    assert.strictEqual(pos.averagePrice, 522.50);
    assert.strictEqual(pos.entryPrice, 522.50, "entryPrice must match execution average price");
    assert.strictEqual(pos.executionPrice, 522.50, "executionPrice must match execution average price");
});

test("PositionEngine - excludeExpiredIntraday option excludes stale intraday trades from previous dates", () => {
    const pastTrades = [
        {
            _id: "past-trade-1",
            tradeId: "TRD-PAST-01",
            symbol: "HDFCLIFE",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "SELL",
            quantity: 1,
            executedPrice: 522.50,
            status: "COMPLETE",
            tradeTime: new Date(Date.now() - 4 * 86400000) // 4 days ago
        }
    ];

    // Standard call preserves raw open positions
    const standardOpen = positionEngine.getOpenPositions(pastTrades);
    assert.strictEqual(standardOpen.length, 1);

    // Call with excludeExpiredIntraday must filter it out because MIS positions do not carry across days
    const liveOpen = positionEngine.getOpenPositions(pastTrades, { excludeExpiredIntraday: true });
    assert.strictEqual(liveOpen.length, 0, "Past-date intraday position must be excluded from live open positions");
});

test("UpstoxMapper - correctly identifies option symbols and parses IST timestamps", async () => {
    const { mapUpstoxTrade } = await import("../src/brokers/upstox/UpstoxMapper.js");

    const optionTrade = {
        trade_id: "UP-OPT-001",
        order_id: "ORD-OPT-001",
        trading_symbol: "NIFTY26N0924550CE",
        exchange: "NFO",
        instrument_token: "NSE_FO|40005",
        transaction_type: "BUY",
        quantity: 65,
        price: 188.20,
        product: "I",
        order_type: "MARKET",
        order_timestamp: "2026-11-06 09:47:56"
    };

    const mapped = mapUpstoxTrade(optionTrade);
    assert.strictEqual(mapped.segment, "OPTIONS", "Option symbol NIFTY...CE must be mapped to OPTIONS segment");
    assert.strictEqual(mapped.productCode, "INTRADAY");
    assert.strictEqual(mapped.quantity, 65);
    assert.strictEqual(mapped.executedPrice, 188.20);
    assert.ok(mapped.tradeTime instanceof Date);
    // Verified IST conversion: 09:47:56 IST is 04:17:56 UTC
    assert.strictEqual(mapped.tradeTime.toISOString(), "2026-11-06T04:17:56.000Z");
});





