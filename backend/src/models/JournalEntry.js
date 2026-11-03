import mongoose from "mongoose";

// ✅ Trading Journal Entry Schema for TradeGuard
const journalAttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    filename: { type: String, required: true },
    originalName: { type: String, default: "" },
    mimeType: { type: String, default: "image/png" },
    size: { type: Number, default: 0 },
    caption: { type: String, default: "" },
    attachmentType: {
      type: String,
      enum: ["ENTRY_CHART", "EXIT_CHART", "SETUP", "DOCUMENT", "OTHER"],
      default: "ENTRY_CHART"
    },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const journalEntrySchema = new mongoose.Schema(
  {
    // ✅ User ownership enforcing strict isolation
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // ✅ Optional link to an executed trade record in TradeRecord collection
    tradeRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradeRecord",
      default: null,
      index: true
    },

    tradeId: {
      type: String,
      default: null
    },

    isStandalone: {
      type: Boolean,
      default: false
    },

    // ✅ Drafts & Published status
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED"],
      default: "PUBLISHED",
      index: true
    },

    // Core Trade details
    instrument: {
      type: String,
      trim: true,
      default: ""
    },

    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    },

    segment: {
      type: String,
      enum: ["EQUITY", "FUTURES", "OPTIONS", "COMMODITY", "CURRENCY"],
      default: "EQUITY"
    },

    direction: {
      type: String,
      enum: ["BUY", "SELL", "LONG", "SHORT"],
      required: true
    },

    entryTime: {
      type: Date,
      default: Date.now
    },

    exitTime: {
      type: Date,
      default: null
    },

    entryPrice: {
      type: Number,
      default: 0
    },

    exitPrice: {
      type: Number,
      default: null
    },

    quantity: {
      type: Number,
      default: 1
    },

    grossPnl: {
      type: Number,
      default: null
    },

    netPnl: {
      type: Number,
      default: null
    },

    // Strategy & Setup
    strategy: {
      type: String,
      trim: true,
      default: "Discretionary",
      index: true
    },

    setup: {
      type: String,
      trim: true,
      default: ""
    },

    marketConditions: {
      type: String,
      trim: true,
      default: "Trending Bullish"
    },

    // Reasoning & Notes
    entryReasoning: {
      type: String,
      default: ""
    },

    exitReasoning: {
      type: String,
      default: ""
    },

    stopLossReasoning: {
      type: String,
      default: ""
    },

    targetReasoning: {
      type: String,
      default: ""
    },

    lessonsLearned: {
      type: String,
      default: ""
    },

    personalNotes: {
      type: String,
      default: ""
    },

    // ✅ Pre-Trade Review Section
    preTrade: {
      whyEntering: { type: String, default: "" },
      setup: { type: String, default: "" },
      confirmation: { type: String, default: "" },
      plannedStopLoss: { type: Number, default: null },
      plannedTarget: { type: Number, default: null },
      plannedRiskReward: { type: Number, default: null },
      confidenceLevel: {
        type: String,
        enum: ["LOW", "MEDIUM", "HIGH"],
        default: "MEDIUM"
      },
      invalidationCriteria: { type: String, default: "" }
    },

    // ✅ Post-Trade Review Section
    postTrade: {
      whyExited: { type: String, default: "" },
      followedPlan: { type: Boolean, default: true },
      wasEntryCorrect: { type: Boolean, default: true },
      wasExitCorrect: { type: Boolean, default: true },
      modifiedStopLoss: { type: Boolean, default: false },
      exitedEarly: { type: Boolean, default: false },
      mistakesSummary: { type: String, default: "" },
      lessonsLearned: { type: String, default: "" },
      improvements: { type: String, default: "" }
    },

    // ✅ Trading Psychology Tracker
    psychology: {
      preTradeEmotions: {
        type: [String],
        default: []
      },
      postTradeEmotionalState: {
        type: String,
        default: ""
      },
      disciplineScore: {
        type: Number,
        min: 1,
        max: 10,
        default: 8
      },
      followedTradingPlan: { type: Boolean, default: true },
      revengeTrading: { type: Boolean, default: false },
      fomoEntry: { type: Boolean, default: false },
      overtrading: { type: Boolean, default: false },
      earlyExit: { type: Boolean, default: false },
      stopLossViolation: { type: Boolean, default: false }
    },

    // ✅ Mistake Tracker Tags
    mistakes: {
      type: [String],
      default: []
    },

    // ✅ Multiple Screenshots and Attachments
    attachments: [journalAttachmentSchema]
  },
  {
    timestamps: true
  }
);

// ✅ Compound indexes for fast filtering and analytics queries
journalEntrySchema.index({ userId: 1, createdAt: -1 });
journalEntrySchema.index({ userId: 1, tradeRecordId: 1 });
journalEntrySchema.index({ userId: 1, strategy: 1 });
journalEntrySchema.index({ userId: 1, status: 1 });
journalEntrySchema.index({ userId: 1, symbol: 1 });

const JournalEntry = mongoose.model("JournalEntry", journalEntrySchema);

export default JournalEntry;

