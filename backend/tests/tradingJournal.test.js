import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import JournalEntry from "../src/models/JournalEntry.js";

// ✅ Trading Journal Module Backend Test Suite
test("Journal 1: Schema supports all required fields and defaults", () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const entry = new JournalEntry({
    userId: dummyUserId,
    symbol: "TCS",
    direction: "BUY",
    entryPrice: 3500,
    exitPrice: 3600,
    quantity: 10
  });

  assert.equal(entry.symbol, "TCS");
  assert.equal(entry.direction, "BUY");
  assert.equal(entry.status, "PUBLISHED");
  assert.equal(entry.segment, "EQUITY");
  assert.equal(entry.strategy, "Discretionary");
  assert.equal(entry.isStandalone, false);
  assert.equal(entry.psychology.disciplineScore, 8);
  assert.equal(entry.preTrade.confidenceLevel, "MEDIUM");
  assert.equal(entry.postTrade.followedPlan, true);
  assert.ok(Array.isArray(entry.mistakes));
  assert.ok(Array.isArray(entry.attachments));
});

test("Journal 2: Draft mode and standalone journal entries", () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const draftEntry = new JournalEntry({
    userId: dummyUserId,
    symbol: "INFY",
    direction: "SELL",
    status: "DRAFT",
    isStandalone: true,
    entryPrice: 1500,
    preTrade: {
      whyEntering: "Breakdown below 1510 support",
      setup: "Support Breakdown",
      plannedStopLoss: 1525,
      plannedTarget: 1460,
      confidenceLevel: "HIGH"
    }
  });

  assert.equal(draftEntry.status, "DRAFT");
  assert.equal(draftEntry.isStandalone, true);
  assert.equal(draftEntry.preTrade.setup, "Support Breakdown");
  assert.equal(draftEntry.preTrade.plannedStopLoss, 1525);
  assert.equal(draftEntry.preTrade.plannedTarget, 1460);
});

test("Journal 3: Pre-trade and Post-trade review questions coverage", () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const entry = new JournalEntry({
    userId: dummyUserId,
    symbol: "RELIANCE",
    direction: "BUY",
    entryPrice: 2800,
    exitPrice: 2870,
    quantity: 25,
    preTrade: {
      whyEntering: "Double bottom breakout on 15m chart with heavy volume",
      setup: "Double Bottom",
      confirmation: "RSI bullish divergence + candle close above neckline",
      plannedStopLoss: 2780,
      plannedTarget: 2860,
      plannedRiskReward: 3.0,
      confidenceLevel: "HIGH",
      invalidationCriteria: "Hourly candle closing below 2780"
    },
    postTrade: {
      whyExited: "Reached primary target at 2860 resistance",
      followedPlan: true,
      wasEntryCorrect: true,
      wasExitCorrect: true,
      modifiedStopLoss: false,
      exitedEarly: false,
      mistakesSummary: "None - executed according to plan",
      lessonsLearned: "Patience in waiting for neckline close paid off",
      improvements: "Could trail 20% position for runner"
    }
  });

  // Verify all Section 4 requirements
  assert.equal(entry.preTrade.whyEntering.includes("Double bottom"), true);
  assert.equal(entry.preTrade.setup, "Double Bottom");
  assert.equal(entry.preTrade.confirmation.includes("RSI"), true);
  assert.equal(entry.preTrade.plannedStopLoss, 2780);
  assert.equal(entry.preTrade.plannedTarget, 2860);
  assert.equal(entry.preTrade.plannedRiskReward, 3.0);
  assert.equal(entry.preTrade.invalidationCriteria.includes("closing below"), true);

  assert.equal(entry.postTrade.followedPlan, true);
  assert.equal(entry.postTrade.wasEntryCorrect, true);
  assert.equal(entry.postTrade.wasExitCorrect, true);
  assert.equal(entry.postTrade.modifiedStopLoss, false);
  assert.equal(entry.postTrade.exitedEarly, false);
});

test("Journal 4: Trading psychology and emotion tracking", () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const entry = new JournalEntry({
    userId: dummyUserId,
    symbol: "NIFTY24DEC24500CE",
    segment: "OPTIONS",
    direction: "BUY",
    psychology: {
      preTradeEmotions: ["Calm", "Confident"],
      postTradeEmotionalState: "Satisfied",
      disciplineScore: 9,
      followedTradingPlan: true,
      revengeTrading: false,
      fomoEntry: false,
      overtrading: false,
      earlyExit: false,
      stopLossViolation: false
    }
  });

  assert.deepEqual(entry.psychology.preTradeEmotions, ["Calm", "Confident"]);
  assert.equal(entry.psychology.postTradeEmotionalState, "Satisfied");
  assert.equal(entry.psychology.disciplineScore, 9);
  assert.equal(entry.psychology.followedTradingPlan, true);
  assert.equal(entry.psychology.revengeTrading, false);
  assert.equal(entry.psychology.fomoEntry, false);
});

test("Journal 5: Mistake tracking and custom mistakes", () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const entry = new JournalEntry({
    userId: dummyUserId,
    symbol: "TATAMOTORS",
    direction: "BUY",
    mistakes: [
      "FOMO entry",
      "Moving stop-loss",
      "Trading outside planned hours",
      "Custom: Sized too heavy before earnings"
    ],
    psychology: {
      disciplineScore: 4,
      fomoEntry: true,
      stopLossViolation: true
    }
  });

  assert.equal(entry.mistakes.length, 4);
  assert.ok(entry.mistakes.includes("FOMO entry"));
  assert.ok(entry.mistakes.includes("Moving stop-loss"));
  assert.ok(entry.mistakes.includes("Trading outside planned hours"));
  assert.ok(entry.mistakes.includes("Custom: Sized too heavy before earnings"));
});

test("Journal 6: Attachments structure and types", () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const entry = new JournalEntry({
    userId: dummyUserId,
    symbol: "BANKNIFTY",
    direction: "SELL",
    attachments: [
      {
        url: "/uploads/journal/entry-chart-1.png",
        filename: "entry-chart-1.png",
        originalName: "15m-breakout.png",
        mimeType: "image/png",
        size: 154200,
        attachmentType: "ENTRY_CHART",
        caption: "15m chart pre-entry setup"
      },
      {
        url: "/uploads/journal/exit-chart-1.png",
        filename: "exit-chart-1.png",
        originalName: "exit.png",
        mimeType: "image/png",
        size: 204800,
        attachmentType: "EXIT_CHART",
        caption: "Exit at VWAP band"
      }
    ]
  });

  assert.equal(entry.attachments.length, 2);
  assert.equal(entry.attachments[0].attachmentType, "ENTRY_CHART");
  assert.equal(entry.attachments[1].attachmentType, "EXIT_CHART");
  assert.equal(entry.attachments[0].caption, "15m chart pre-entry setup");
});

test("Journal 7: Discipline score validation (1 to 10)", () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const validEntry = new JournalEntry({
    userId: dummyUserId,
    symbol: "SBIN",
    direction: "BUY",
    psychology: { disciplineScore: 10 }
  });
  assert.equal(validEntry.psychology.disciplineScore, 10);

  const invalidEntry = new JournalEntry({
    userId: dummyUserId,
    symbol: "SBIN",
    direction: "BUY",
    psychology: { disciplineScore: 12 }
  });
  const err = invalidEntry.validateSync();
  assert.ok(err?.errors?.["psychology.disciplineScore"]);
});

