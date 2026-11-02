import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { OrderExecutionService } from "../src/services/trading/OrderExecutionService.js";
import BrokerAdapterFactory from "../src/services/copyTrading/adapters/BrokerAdapterFactory.js";
import positionEngine from "../src/services/position/PositionEngine.js";
import pnlEngine from "../src/services/pnl/PnLEngine.js";

test("OrderExecution 1: Resolves opposing transaction side (Long -> SELL, Short -> BUY)", async () => {
    const mockUserId = "507f1f77bcf86cd799439011";

    // Setup an in-memory Long position in PnLEngine
    pnlEngine.setPositions(mockUserId, [
        {
            key: "MOCK|NSE|EQUITY|RELIANCE|INTRADAY",
            symbol: "RELIANCE",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            openQuantity: 10,
            netQuantity: 10,
            averagePrice: 2500,
            ltp: 2550,
            side: "BUY"
        }
    ]);

    const exitRes = await OrderExecutionService.executeExitPosition({
        userId: mockUserId,
        symbol: "RELIANCE",
        orderType: "MARKET",
        quantity: 10
    });

    assert.equal(exitRes.success, true);
    assert.equal(exitRes.symbol, "RELIANCE");
    assert.equal(exitRes.exitSide, "SELL");
    assert.equal(exitRes.quantity, 10);
    assert.ok(exitRes.orderId);
});

test("OrderExecution 2: Supports LIMIT order with user-specified limit price", async () => {
    const mockUserId = "507f1f77bcf86cd799439012";

    pnlEngine.setPositions(mockUserId, [
        {
            key: "MOCK|NSE|EQUITY|TCS|INTRADAY",
            symbol: "TCS",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            openQuantity: 5,
            netQuantity: 5,
            averagePrice: 3800,
            ltp: 3820,
            side: "BUY"
        }
    ]);

    const exitRes = await OrderExecutionService.executeExitPosition({
        userId: mockUserId,
        symbol: "TCS",
        orderType: "LIMIT",
        quantity: 5,
        price: 3850
    });

    assert.equal(exitRes.success, true);
    assert.equal(exitRes.orderType, "LIMIT");
    assert.equal(exitRes.price, 3850);
});

test("OrderExecution 3: Validates SL and SL-M order types requiring trigger price", async () => {
    const mockUserId = "507f1f77bcf86cd799439013";

    pnlEngine.setPositions(mockUserId, [
        {
            key: "MOCK|NSE|EQUITY|INFY|INTRADAY",
            symbol: "INFY",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            openQuantity: 20,
            netQuantity: 20,
            averagePrice: 1500,
            ltp: 1510,
            side: "BUY"
        }
    ]);

    // Should reject SL order without triggerPrice
    await assert.rejects(
        async () => {
            await OrderExecutionService.executeExitPosition({
                userId: mockUserId,
                symbol: "INFY",
                orderType: "SL",
                price: 1480,
                triggerPrice: 0
            });
        },
        /trigger price greater than 0 is required/
    );

    // Should succeed with valid triggerPrice & price
    const validSL = await OrderExecutionService.executeExitPosition({
        userId: mockUserId,
        symbol: "INFY",
        orderType: "SL",
        price: 1480,
        triggerPrice: 1485,
        quantity: 20
    });

    assert.equal(validSL.success, true);
    assert.equal(validSL.orderType, "SL");
});

test("OrderExecution 4: Partial quantity exit clamps to available open quantity", async () => {
    const mockUserId = "507f1f77bcf86cd799439014";

    pnlEngine.setPositions(mockUserId, [
        {
            key: "MOCK|NSE|EQUITY|SBIN|INTRADAY",
            symbol: "SBIN",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            openQuantity: 50,
            netQuantity: 50,
            averagePrice: 750,
            ltp: 760,
            side: "BUY"
        }
    ]);

    // Partial exit: exit 15 of 50
    const partialExit = await OrderExecutionService.executeExitPosition({
        userId: mockUserId,
        symbol: "SBIN",
        orderType: "MARKET",
        quantity: 15
    });

    assert.equal(partialExit.success, true);
    assert.equal(partialExit.quantity, 15);

    // Over-requested exit: request 100, but only 50 open -> clamps to 50
    const clampedExit = await OrderExecutionService.executeExitPosition({
        userId: mockUserId,
        symbol: "SBIN",
        orderType: "MARKET",
        quantity: 100
    });

    assert.equal(clampedExit.success, true);
    assert.equal(clampedExit.quantity, 50);
});

test("OrderExecution 5: Exit All Positions (Square Off All) iterates across all open positions", async () => {
    const mockUserId = "507f1f77bcf86cd799439015";

    const testPositions = [
        {
            key: "MOCK|NSE|EQUITY|WIPRO|INTRADAY",
            symbol: "WIPRO",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            openQuantity: 10,
            netQuantity: 10,
            averagePrice: 450,
            ltp: 455,
            side: "BUY"
        },
        {
            key: "MOCK|NSE|EQUITY|ITC|INTRADAY",
            symbol: "ITC",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            openQuantity: 25,
            netQuantity: 25,
            averagePrice: 420,
            ltp: 425,
            side: "BUY"
        }
    ];

    pnlEngine.setPositions(mockUserId, testPositions);

    const squareOffRes = await OrderExecutionService.executeExitAllPositions({
        userId: mockUserId,
        orderType: "MARKET",
        positions: testPositions
    });

    assert.equal(squareOffRes.success, true);
    assert.equal(squareOffRes.total, 2);
    assert.equal(squareOffRes.exitedCount, 2);
    assert.equal(squareOffRes.failedCount, 0);
    assert.equal(squareOffRes.results.length, 2);
    assert.equal(squareOffRes.results[0].symbol, "WIPRO");
    assert.equal(squareOffRes.results[1].symbol, "ITC");
});
