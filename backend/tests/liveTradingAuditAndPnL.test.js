import test from "node:test";
import assert from "node:assert";
import positionEngine from "../src/services/position/PositionEngine.js";
import pnlEngine from "../src/services/pnl/PnLEngine.js";

test("Live Trading Audit 1: Historical squared trades do not leak realized loss into new open trades", () => {
    // Simulate user trading SWIGGY in March 2026:
    // Buy 9, Buy 37, Buy 54 = 100 shares.
    // Sell 9, Sell 37, Sell 54 = 100 shares with total realized loss of -192.70.
    const historicalTrades = [
        {
            _id: "m1",
            tradeId: "TRD-SWIGGY-B1",
            symbol: "SWIGGY-EQ",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 9,
            executedPrice: 295.45,
            tradeTime: new Date("2026-03-11T09:30:00Z"),
            status: "COMPLETE"
        },
        {
            _id: "m2",
            tradeId: "TRD-SWIGGY-S1",
            symbol: "SWIGGY-EQ",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "SELL",
            quantity: 9,
            executedPrice: 293.55, // -17.10 loss
            tradeTime: new Date("2026-03-11T10:00:00Z"),
            status: "COMPLETE"
        },
        {
            _id: "m3",
            tradeId: "TRD-SWIGGY-B2",
            symbol: "SWIGGY-EQ",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 91,
            executedPrice: 295.45,
            tradeTime: new Date("2026-03-11T10:30:00Z"),
            status: "COMPLETE"
        },
        {
            _id: "m4",
            tradeId: "TRD-SWIGGY-S2",
            symbol: "SWIGGY-EQ",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "SELL",
            quantity: 91,
            executedPrice: 293.52, // -175.60 loss (-192.70 total)
            tradeTime: new Date("2026-03-11T11:00:00Z"),
            status: "COMPLETE"
        }
    ];

    // Today (Nov 2, 2026), user buys 1 share of SWIGGY @ 180.10 and has NOT squared off.
    const todayTrade = {
        _id: "nov1",
        tradeId: "TRD-SWIGGY-NOV1",
        symbol: "SWIGGY-EQ",
        exchange: "NSE",
        segment: "EQUITY",
        productType: "INTRADAY",
        transactionType: "BUY",
        quantity: 1,
        executedPrice: 180.10,
        tradeTime: new Date("2026-11-02T10:08:21Z"),
        status: "COMPLETE"
    };

    const allTrades = [...historicalTrades, todayTrade];

    // 1. Get Open Positions
    const openPositions = positionEngine.getOpenPositions(allTrades);
    assert.strictEqual(openPositions.length, 1, "Must have exactly 1 active open position");

    const openPos = openPositions[0];
    assert.strictEqual(openPos.openQuantity, 1, "Open quantity must be 1");
    assert.strictEqual(openPos.averagePrice, 180.10, "Average entry price must be 180.10");
    assert.strictEqual(openPos.status, "OPEN", "Brand new trade must have status OPEN, not PARTIALLY_SQUARED");
    assert.strictEqual(openPos.realizedPnL, 0, "Unsquared open trade must have 0 realized P&L");
    assert.strictEqual(openPos.squaredLots.length, 0, "Unsquared open trade must have 0 squared lots");

    // 2. Get Fully Squared Positions
    const squaredPositions = positionEngine.getFullySquaredPositions(allTrades);
    assert.strictEqual(squaredPositions.length >= 1, true, "Historical March trade must be in squaredPositions");
    const swiggySquared = squaredPositions.filter(p => p.symbol.includes("SWIGGY"));
    assert.ok(swiggySquared.length > 0, "SWIGGY historical closed positions must exist in squaredPositions");
    const swiggyTotalRealized = swiggySquared.reduce((sum, p) => sum + p.realizedPnL, 0);
    assert.strictEqual(Math.round(swiggyTotalRealized * 100) / 100, -192.73, "Historical closed positions retain -192.73 loss in historical tab");

    // 3. PnLEngine calculation for the open position
    pnlEngine.setPositions("user-swiggy", openPositions);
    const snap = pnlEngine.calculate("user-swiggy");
    const calcPos = snap.positions[0];

    assert.strictEqual(calcPos.realizedGrossPnL, 0, "Calculated open position realized gross PnL must be 0");
    assert.strictEqual(calcPos.grossPnL, 0, "Gross PnL must be 0 before price moves (not -192 loss!)");
    assert.strictEqual(snap.portfolioSummary.totalRealizedPnL, 0, "Open portfolio realized PnL must be 0");
    assert.strictEqual(snap.portfolioSummary.totalGrossPnL, 0, "Portfolio Gross PnL must be 0");
});

test("Live Trading Audit 2: Stop loss and target are null/Not Set when not provided by user", () => {
    const trades = [
        {
            _id: "t_nosl",
            tradeId: "TRD-NOSL",
            symbol: "INFY",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 10,
            executedPrice: 1500.00,
            tradeTime: new Date("2026-11-02T10:00:00Z"),
            status: "COMPLETE"
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    pnlEngine.setPositions("user-nosl", openPositions);

    const snapshot = pnlEngine.calculate("user-nosl");
    const pos = snapshot.positions[0];

    // Must NOT fabricate default 1.5% SL (1477.5) or 3.0% Target (1545.0)
    assert.strictEqual(pos.stopLoss, null, "Stop Loss must be null when user did not input it");
    assert.strictEqual(pos.target, null, "Target must be null when user did not input it");
    assert.strictEqual(pos.riskAmount, null, "Risk Amount must be null when SL is not set");
    assert.strictEqual(pos.rewardAmount, null, "Reward Amount must be null when Target is not set");
    assert.strictEqual(pos.initialRiskRewardText, "Not Set", "R:R must be 'Not Set'");
    assert.strictEqual(pos.liveRiskRewardText, "Not Set", "Live R:R must be 'Not Set'");

    // Portfolio summary
    assert.strictEqual(snapshot.portfolioSummary.totalRiskAmount, 0, "Total risk must be 0 when no SL is set");
    assert.strictEqual(snapshot.portfolioSummary.portfolioRiskRewardText, "Not Set");
});

test("Live Trading Audit 3: Stop loss and target calculate correctly when user explicitly inputs them", () => {
    const trades = [
        {
            _id: "t_withsl",
            tradeId: "TRD-WITHSL",
            symbol: "RELIANCE",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 10,
            executedPrice: 2500.00,
            tradeTime: new Date("2026-11-02T10:00:00Z"),
            status: "COMPLETE"
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    pnlEngine.setPositions("user-withsl", openPositions);

    // User explicitly inputs SL = 2450, Target = 2600
    pnlEngine.updateRiskSettings("user-withsl", "RELIANCE", { stopLoss: 2450.00, target: 2600.00 });

    const snapshot = pnlEngine.calculate("user-withsl");
    const pos = snapshot.positions[0];

    assert.strictEqual(pos.stopLoss, 2450.00);
    assert.strictEqual(pos.target, 2600.00);
    // Risk: (2500 - 2450) * 10 = 500
    assert.strictEqual(pos.riskAmount, 500.00);
    // Reward: (2600 - 2500) * 10 = 1000
    assert.strictEqual(pos.rewardAmount, 1000.00);
    // R:R: 1000 / 500 = 1:2
    assert.strictEqual(pos.initialRiskRewardRatio, 2);
    assert.strictEqual(pos.initialRiskRewardText, "1:2");

    assert.strictEqual(snapshot.portfolioSummary.totalRiskAmount, 500.00);
    assert.strictEqual(snapshot.portfolioSummary.portfolioRiskRewardText, "1:2");
});

test("Live Trading Audit 4: All live trading terms adhere to exact financial definitions", () => {
    const trades = [
        {
            _id: "t_terms",
            tradeId: "TRD-TERMS-1",
            symbol: "TCS",
            exchange: "NSE",
            segment: "EQUITY",
            productType: "INTRADAY",
            transactionType: "BUY",
            quantity: 5,
            executedPrice: 3000.00,
            tradeTime: new Date("2026-11-02T10:00:00Z"),
            status: "COMPLETE"
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    pnlEngine.setPositions("user-terms", openPositions);

    // Live tick arrives: LTP = 3020.00
    pnlEngine.updatePrice("user-terms", openPositions[0].instrumentToken, 3020.00);

    const snapshot = pnlEngine.calculate("user-terms");
    const pos = snapshot.positions[0];

    // 1. Invested Capital / Position Cost: 3000 * 5 = 15,000
    assert.strictEqual(pos.investedCapital, 15000.00);

    // 2. Current Market Value: 3020 * 5 = 15,100
    assert.strictEqual(pos.marketValue, 15100.00);

    // 3. Unrealized Gross P&L (MTM): (3020 - 3000) * 5 = +100
    assert.strictEqual(pos.unrealizedGrossPnL, 100.00);

    // 4. Realized Gross P&L: 0 (unsquared)
    assert.strictEqual(pos.realizedGrossPnL, 0);

    // 5. Total Gross P&L: Unrealized + Realized = 100 + 0 = 100
    assert.strictEqual(pos.grossPnL, 100.00);

    // 6. Net P&L: Gross P&L - Total Charges
    assert.strictEqual(pos.netPnL, Math.round((pos.grossPnL - pos.charges.total) * 100) / 100);

    // 7. Breakeven Price: Entry + charges per unit
    assert.ok(pos.breakevenPrice > 3000.00, "Breakeven must exceed entry price to cover round-trip charges");
    assert.strictEqual(pos.isAboveBreakeven, true, "LTP 3020 is above breakeven ~3001.5");
});
