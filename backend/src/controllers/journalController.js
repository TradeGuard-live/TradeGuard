import mongoose from "mongoose";
import JournalEntry from "../models/JournalEntry.js";
import TradeRecord from "../models/TradeRecord.js";
import { calculateCharges, calculatePnL } from "../services/calculations.js";
import brokerConfig from "../services/brokers/brokerConfig.js";

// ✅ Security: Derive verified userId strictly from JWT; reject IDOR mismatch attempts
const getVerifiedUserId = (req, res) => {
  const tokenUserId = req.user?.userId ? String(req.user.userId) : null;
  if (!tokenUserId) {
    res.status(401).json({ success: false, message: "Unauthorized: Valid user identity required" });
    return null;
  }
  const paramUserId = req.query.userId || req.params.userId || req.body?.userId;
  if (paramUserId && String(paramUserId) !== tokenUserId) {
    res.status(403).json({ success: false, message: "Forbidden: Access denied to other users' records" });
    return null;
  }
  return tokenUserId;
};

// Helper: Calculate Planned Risk/Reward Ratio
function calculatePlannedRR(direction, entryPrice, stopLoss, targetPrice) {
  const e = Number(entryPrice);
  const sl = Number(stopLoss);
  const tp = Number(targetPrice);
  if (!e || !sl || !tp || e <= 0 || sl <= 0 || tp <= 0) return null;

  const isBuy = String(direction).toUpperCase() === "BUY" || String(direction).toUpperCase() === "LONG";
  const risk = isBuy ? e - sl : sl - e;
  const reward = isBuy ? tp - e : e - tp;

  if (risk <= 0 || reward <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

// Helper: Calculate Actual Financial P&L using existing TradeGuard calculations
function computePnL(direction, entryPrice, exitPrice, quantity, segment = "EQUITY", broker = "UPSTOX") {
  const ep = Number(entryPrice);
  const xp = Number(exitPrice);
  const qty = Number(quantity);
  if (!ep || !xp || !qty || ep <= 0 || xp <= 0 || qty <= 0) {
    return { grossPnl: null, netPnl: null };
  }

  const isBuy = String(direction).toUpperCase() === "BUY" || String(direction).toUpperCase() === "LONG";
  const grossPnl = isBuy ? (xp - ep) * qty : (ep - xp) * qty;

  // Use TradeGuard calculation service for statutory charges
  let totalCharges = 0;
  try {
    const bConfig = brokerConfig[broker] || brokerConfig.UPSTOX;
    const dummyTrade = {
      price: ep,
      quantity: qty,
      transactionType: isBuy ? "BUY" : "SELL",
      segment: segment,
      productType: "INTRADAY"
    };
    const buyCharges = calculateCharges(dummyTrade, bConfig);
    const sellTrade = {
      ...dummyTrade,
      price: xp,
      transactionType: isBuy ? "SELL" : "BUY"
    };
    const sellCharges = calculateCharges(sellTrade, bConfig);
    totalCharges = (buyCharges?.totalCharges || 0) + (sellCharges?.totalCharges || 0);
  } catch (err) {
    // Standard baseline fallback if config unavailable (0.1% approximate)
    totalCharges = (ep * qty + xp * qty) * 0.0005;
  }

  const netPnl = Math.round((grossPnl - totalCharges) * 100) / 100;
  return {
    grossPnl: Math.round(grossPnl * 100) / 100,
    netPnl: netPnl
  };
}

/**
 * ✅ List Journal Entries with extensive filtering and pagination
 * GET /api/journal
 */
export const listJournalEntries = async (req, res) => {
  try {
    const userId = getVerifiedUserId(req, res);
    if (!userId) return;

    const {
      range,
      startDate,
      endDate,
      symbol,
      segment,
      strategy,
      outcome,
      mistake,
      emotion,
      status,
      tradeRecordId,
      page = 1,
      limit = 50
    } = req.query;

    const filter = { userId: new mongoose.Types.ObjectId(userId) };

    // Status filter (DRAFT, PUBLISHED, or all)
    if (status && status !== "ALL") {
      filter.status = status.toUpperCase();
    }

    // Trade record linking filter
    if (tradeRecordId && mongoose.Types.ObjectId.isValid(tradeRecordId)) {
      filter.tradeRecordId = new mongoose.Types.ObjectId(tradeRecordId);
    }

    // ✅ Security: Escape regex special characters to prevent ReDoS attacks
    if (symbol) {
      const safeSymbol = String(symbol).trim().slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.symbol = { $regex: safeSymbol, $options: "i" };
    }

    // Segment filter
    if (segment && segment !== "ALL") {
      filter.segment = segment.toUpperCase();
    }

    // Strategy filter
    if (strategy && strategy !== "ALL") {
      filter.strategy = strategy;
    }

    // Mistake filter
    if (mistake && mistake !== "ALL") {
      filter.mistakes = mistake;
    }

    // ✅ Security: Escape emotion filter to prevent ReDoS or RegExp syntax errors
    if (emotion && emotion !== "ALL") {
      const safeEmotion = String(emotion).trim().slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { "psychology.preTradeEmotions": emotion },
        { "psychology.postTradeEmotionalState": { $regex: new RegExp(`^${safeEmotion}$`, "i") } }
      ];
    }

    // Date range filter
    const now = new Date();
    let cutoff = null;
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    } else if (range && range !== "all") {
      if (range === "1d" || range === "today") {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      } else if (range === "7d") {
        cutoff = new Date(now.getTime() - 7 * 86400000);
      } else if (range === "30d") {
        cutoff = new Date(now.getTime() - 30 * 86400000);
      } else if (range === "90d") {
        cutoff = new Date(now.getTime() - 90 * 86400000);
      } else if (range === "1y") {
        cutoff = new Date(now.getTime() - 365 * 86400000);
      }
      if (cutoff) {
        filter.createdAt = { $gte: cutoff };
      }
    }

    // Outcome filter (WIN / LOSS / BREAKEVEN)
    if (outcome && outcome !== "ALL") {
      if (outcome.toUpperCase() === "WIN") {
        filter.netPnl = { $gt: 0 };
      } else if (outcome.toUpperCase() === "LOSS") {
        filter.netPnl = { $lt: 0 };
      } else if (outcome.toUpperCase() === "BREAKEVEN") {
        filter.netPnl = { $eq: 0 };
      }
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const skip = (pageNum - 1) * limitNum;

    const [entries, totalCount] = await Promise.all([
      JournalEntry.find(filter)
        .populate("tradeRecordId")
        .sort({ entryTime: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      JournalEntry.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      count: entries.length,
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      data: entries
    });
  } catch (error) {
    console.error("List journal entries error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch journal entries" });
  }
};

/**
 * ✅ Get Single Journal Entry by ID
 * GET /api/journal/:id
 */
export const getJournalEntry = async (req, res) => {
  try {
    const userId = getVerifiedUserId(req, res);
    if (!userId) return;

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid journal entry ID format" });
    }

    const entry = await JournalEntry.findOne({
      _id: id,
      userId: new mongoose.Types.ObjectId(userId)
    })
      .populate("tradeRecordId")
      .lean();

    if (!entry) {
      return res.status(404).json({ success: false, message: "Journal entry not found" });
    }

    return res.status(200).json({ success: true, data: entry });
  } catch (error) {
    console.error("Get journal entry error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch journal entry" });
  }
};

/**
 * ✅ Create a New Journal Entry (Standalone or Linked to TradeRecord)
 * POST /api/journal
 */
export const createJournalEntry = async (req, res) => {
  try {
    const userId = getVerifiedUserId(req, res);
    if (!userId) return;

    const payload = req.body;
    if (!payload.symbol || !payload.direction) {
      return res.status(400).json({
        success: false,
        message: "Trading symbol and trade direction (BUY/SELL) are required"
      });
    }

    // Verify linked TradeRecord if provided
    let linkedTrade = null;
    if (payload.tradeRecordId && mongoose.Types.ObjectId.isValid(payload.tradeRecordId)) {
      linkedTrade = await TradeRecord.findOne({
        _id: payload.tradeRecordId,
        userId: new mongoose.Types.ObjectId(userId)
      }).lean();
    }

    // Calculate Planned R:R if stop loss and target provided
    const plannedRR = payload.preTrade?.plannedRiskReward || calculatePlannedRR(
      payload.direction,
      payload.entryPrice,
      payload.preTrade?.plannedStopLoss,
      payload.preTrade?.plannedTarget
    );

    // Compute gross and net P&L if entry & exit prices provided and not supplied manually
    let grossPnl = payload.grossPnl;
    let netPnl = payload.netPnl;
    if ((grossPnl === undefined || grossPnl === null) && payload.entryPrice && payload.exitPrice) {
      const pnlRes = computePnL(
        payload.direction,
        payload.entryPrice,
        payload.exitPrice,
        payload.quantity || 1,
        payload.segment || "EQUITY",
        linkedTrade?.broker || "UPSTOX"
      );
      grossPnl = pnlRes.grossPnl;
      netPnl = pnlRes.netPnl;
    }

    // Deduce mistakes from psychology boolean flags if not in mistakes array
    const mistakesSet = new Set(Array.isArray(payload.mistakes) ? payload.mistakes : []);
    if (payload.psychology?.revengeTrading) mistakesSet.add("Revenge trading");
    if (payload.psychology?.fomoEntry) mistakesSet.add("FOMO entry");
    if (payload.psychology?.overtrading) mistakesSet.add("Overtrading");
    if (payload.psychology?.earlyExit) mistakesSet.add("Early exit");
    if (payload.psychology?.stopLossViolation) mistakesSet.add("Stop-loss violation");
    if (payload.postTrade?.modifiedStopLoss) mistakesSet.add("Moving stop-loss");
    if (payload.postTrade?.followedPlan === false) mistakesSet.add("Ignoring trading plan");

    const newEntry = new JournalEntry({
      userId: new mongoose.Types.ObjectId(userId),
      tradeRecordId: linkedTrade ? linkedTrade._id : (payload.tradeRecordId || null),
      tradeId: linkedTrade?.tradeId || payload.tradeId || null,
      isStandalone: !linkedTrade,
      status: payload.status === "DRAFT" ? "DRAFT" : "PUBLISHED",
      instrument: payload.instrument || payload.symbol,
      symbol: payload.symbol.toUpperCase().trim(),
      segment: payload.segment || linkedTrade?.segment || "EQUITY",
      direction: payload.direction.toUpperCase(),
      entryTime: payload.entryTime ? new Date(payload.entryTime) : (linkedTrade?.tradeTime || new Date()),
      exitTime: payload.exitTime ? new Date(payload.exitTime) : null,
      entryPrice: Number(payload.entryPrice ?? linkedTrade?.executedPrice ?? 0),
      exitPrice: payload.exitPrice != null ? Number(payload.exitPrice) : null,
      quantity: Number(payload.quantity ?? linkedTrade?.quantity ?? 1),
      grossPnl: grossPnl != null ? Number(grossPnl) : null,
      netPnl: netPnl != null ? Number(netPnl) : null,
      strategy: payload.strategy?.trim() || "Discretionary",
      setup: payload.setup?.trim() || "",
      marketConditions: payload.marketConditions?.trim() || "Trending Bullish",
      entryReasoning: payload.entryReasoning || payload.preTrade?.whyEntering || "",
      exitReasoning: payload.exitReasoning || payload.postTrade?.whyExited || "",
      stopLossReasoning: payload.stopLossReasoning || "",
      targetReasoning: payload.targetReasoning || "",
      lessonsLearned: payload.lessonsLearned || payload.postTrade?.lessonsLearned || "",
      personalNotes: payload.personalNotes || "",
      preTrade: {
        whyEntering: payload.preTrade?.whyEntering || payload.entryReasoning || "",
        setup: payload.preTrade?.setup || payload.setup || "",
        confirmation: payload.preTrade?.confirmation || "",
        plannedStopLoss: payload.preTrade?.plannedStopLoss != null ? Number(payload.preTrade.plannedStopLoss) : null,
        plannedTarget: payload.preTrade?.plannedTarget != null ? Number(payload.preTrade.plannedTarget) : null,
        plannedRiskReward: plannedRR != null ? Number(plannedRR) : null,
        confidenceLevel: payload.preTrade?.confidenceLevel || "MEDIUM",
        invalidationCriteria: payload.preTrade?.invalidationCriteria || ""
      },
      postTrade: {
        whyExited: payload.postTrade?.whyExited || payload.exitReasoning || "",
        followedPlan: payload.postTrade?.followedPlan ?? true,
        wasEntryCorrect: payload.postTrade?.wasEntryCorrect ?? true,
        wasExitCorrect: payload.postTrade?.wasExitCorrect ?? true,
        modifiedStopLoss: payload.postTrade?.modifiedStopLoss ?? false,
        exitedEarly: payload.postTrade?.exitedEarly ?? false,
        mistakesSummary: payload.postTrade?.mistakesSummary || "",
        lessonsLearned: payload.postTrade?.lessonsLearned || payload.lessonsLearned || "",
        improvements: payload.postTrade?.improvements || ""
      },
      psychology: {
        preTradeEmotions: Array.isArray(payload.psychology?.preTradeEmotions) ? payload.psychology.preTradeEmotions : [],
        postTradeEmotionalState: payload.psychology?.postTradeEmotionalState || "",
        disciplineScore: payload.psychology?.disciplineScore != null ? Number(payload.psychology.disciplineScore) : 8,
        followedTradingPlan: payload.psychology?.followedTradingPlan ?? (payload.postTrade?.followedPlan ?? true),
        revengeTrading: payload.psychology?.revengeTrading ?? false,
        fomoEntry: payload.psychology?.fomoEntry ?? false,
        overtrading: payload.psychology?.overtrading ?? false,
        earlyExit: payload.psychology?.earlyExit ?? false,
        stopLossViolation: payload.psychology?.stopLossViolation ?? false
      },
      mistakes: Array.from(mistakesSet),
      attachments: Array.isArray(payload.attachments) ? payload.attachments : []
    });

    const saved = await newEntry.save();
    return res.status(201).json({
      success: true,
      message: "Journal entry created successfully",
      data: saved
    });
  } catch (error) {
    console.error("Create journal entry error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "Failed to create journal entry" });
  }
};

/**
 * ✅ Update Journal Entry
 * PUT /api/journal/:id
 */
export const updateJournalEntry = async (req, res) => {
  try {
    const userId = getVerifiedUserId(req, res);
    if (!userId) return;

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid journal entry ID format" });
    }

    const existing = await JournalEntry.findOne({
      _id: id,
      userId: new mongoose.Types.ObjectId(userId)
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Journal entry not found" });
    }

    const payload = req.body;

    // Recalculate Planned R:R if changed
    const direction = payload.direction || existing.direction;
    const entryPrice = payload.entryPrice !== undefined ? Number(payload.entryPrice) : existing.entryPrice;
    const plannedSL = payload.preTrade?.plannedStopLoss !== undefined ? Number(payload.preTrade.plannedStopLoss) : existing.preTrade?.plannedStopLoss;
    const plannedTP = payload.preTrade?.plannedTarget !== undefined ? Number(payload.preTrade.plannedTarget) : existing.preTrade?.plannedTarget;

    const plannedRR = payload.preTrade?.plannedRiskReward || calculatePlannedRR(direction, entryPrice, plannedSL, plannedTP);

    // Compute P&L if prices updated
    const exitPrice = payload.exitPrice !== undefined ? (payload.exitPrice != null ? Number(payload.exitPrice) : null) : existing.exitPrice;
    const quantity = payload.quantity !== undefined ? Number(payload.quantity) : existing.quantity;

    let grossPnl = payload.grossPnl !== undefined ? payload.grossPnl : existing.grossPnl;
    let netPnl = payload.netPnl !== undefined ? payload.netPnl : existing.netPnl;

    if (entryPrice && exitPrice && (grossPnl === undefined || grossPnl === null)) {
      const pnlRes = computePnL(
        direction,
        entryPrice,
        exitPrice,
        quantity || 1,
        payload.segment || existing.segment || "EQUITY"
      );
      grossPnl = pnlRes.grossPnl;
      netPnl = pnlRes.netPnl;
    }

    // Deduce mistakes
    const mistakesSet = new Set(Array.isArray(payload.mistakes) ? payload.mistakes : (existing.mistakes || []));
    if (payload.psychology?.revengeTrading) mistakesSet.add("Revenge trading");
    if (payload.psychology?.fomoEntry) mistakesSet.add("FOMO entry");
    if (payload.psychology?.overtrading) mistakesSet.add("Overtrading");
    if (payload.psychology?.earlyExit) mistakesSet.add("Early exit");
    if (payload.psychology?.stopLossViolation) mistakesSet.add("Stop-loss violation");
    if (payload.postTrade?.modifiedStopLoss) mistakesSet.add("Moving stop-loss");
    if (payload.postTrade?.followedPlan === false) mistakesSet.add("Ignoring trading plan");

    // Apply updates
    if (payload.status) existing.status = payload.status;
    if (payload.symbol) existing.symbol = payload.symbol.toUpperCase().trim();
    if (payload.instrument !== undefined) existing.instrument = payload.instrument;
    if (payload.segment) existing.segment = payload.segment;
    if (payload.direction) existing.direction = payload.direction.toUpperCase();
    if (payload.entryTime) existing.entryTime = new Date(payload.entryTime);
    if (payload.exitTime !== undefined) existing.exitTime = payload.exitTime ? new Date(payload.exitTime) : null;
    if (payload.entryPrice !== undefined) existing.entryPrice = entryPrice;
    if (payload.exitPrice !== undefined) existing.exitPrice = exitPrice;
    if (payload.quantity !== undefined) existing.quantity = quantity;
    if (grossPnl !== undefined) existing.grossPnl = grossPnl;
    if (netPnl !== undefined) existing.netPnl = netPnl;
    if (payload.strategy !== undefined) existing.strategy = payload.strategy.trim();
    if (payload.setup !== undefined) existing.setup = payload.setup.trim();
    if (payload.marketConditions !== undefined) existing.marketConditions = payload.marketConditions.trim();
    if (payload.entryReasoning !== undefined) existing.entryReasoning = payload.entryReasoning;
    if (payload.exitReasoning !== undefined) existing.exitReasoning = payload.exitReasoning;
    if (payload.stopLossReasoning !== undefined) existing.stopLossReasoning = payload.stopLossReasoning;
    if (payload.targetReasoning !== undefined) existing.targetReasoning = payload.targetReasoning;
    if (payload.lessonsLearned !== undefined) existing.lessonsLearned = payload.lessonsLearned;
    if (payload.personalNotes !== undefined) existing.personalNotes = payload.personalNotes;

    if (payload.preTrade) {
      existing.preTrade = {
        ...existing.preTrade?.toObject?.(),
        ...payload.preTrade,
        plannedRiskReward: plannedRR != null ? Number(plannedRR) : existing.preTrade?.plannedRiskReward
      };
    }
    if (payload.postTrade) {
      existing.postTrade = {
        ...existing.postTrade?.toObject?.(),
        ...payload.postTrade
      };
    }
    if (payload.psychology) {
      existing.psychology = {
        ...existing.psychology?.toObject?.(),
        ...payload.psychology
      };
    }

    existing.mistakes = Array.from(mistakesSet);
    if (Array.isArray(payload.attachments)) {
      existing.attachments = payload.attachments;
    }

    const updated = await existing.save();
    return res.status(200).json({
      success: true,
      message: "Journal entry updated successfully",
      data: updated
    });
  } catch (error) {
    console.error("Update journal entry error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "Failed to update journal entry" });
  }
};

/**
 * ✅ Delete Journal Entry
 * DELETE /api/journal/:id
 */
export const deleteJournalEntry = async (req, res) => {
  try {
    const userId = getVerifiedUserId(req, res);
    if (!userId) return;

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid journal entry ID format" });
    }

    const deleted = await JournalEntry.findOneAndDelete({
      _id: id,
      userId: new mongoose.Types.ObjectId(userId)
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Journal entry not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Journal entry deleted successfully"
    });
  } catch (error) {
    console.error("Delete journal entry error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to delete journal entry" });
  }
};

/**
 * ✅ Complete Journal Analytics (Discipline, Plan Adherence, Strategies, Mistakes, Psychology, Reviews)
 * GET /api/journal/analytics
 */
export const getJournalAnalytics = async (req, res) => {
  try {
    const userId = getVerifiedUserId(req, res);
    if (!userId) return;

    const objectId = new mongoose.Types.ObjectId(userId);
    const range = String(req.query.range || "all").toLowerCase();
    const now = new Date();

    let cutoff = new Date(0);
    if (range === "1d" || range === "today") {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (range === "7d") {
      cutoff = new Date(now.getTime() - 7 * 86400000);
    } else if (range === "30d") {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    } else if (range === "90d") {
      cutoff = new Date(now.getTime() - 90 * 86400000);
    } else if (range === "1y") {
      cutoff = new Date(now.getTime() - 365 * 86400000);
    }

    // Fetch all journal entries for the user within range
    const entries = await JournalEntry.find({
      userId: objectId,
      status: "PUBLISHED",
      createdAt: { $gte: cutoff }
    }).lean();

    const totalEntries = entries.length;
    if (totalEntries === 0) {
      return res.status(200).json({
        success: true,
        data: {
          totalEntries: 0,
          disciplineScore: 0,
          planAdherencePercent: 0,
          totalNetPnl: 0,
          winRate: 0,
          followedPlanStats: { count: 0, winRate: 0, netPnl: 0 },
          brokePlanStats: { count: 0, winRate: 0, netPnl: 0 },
          strategies: [],
          emotions: [],
          mistakes: [],
          reviews: { weekly: [], monthly: [], yearly: [] }
        }
      });
    }

    // 1. Discipline score & Plan adherence
    let totalDiscipline = 0;
    let followedPlanCount = 0;
    let followedWins = 0, followedNetPnl = 0;
    let brokePlanCount = 0, brokeWins = 0, brokeNetPnl = 0;
    let totalWins = 0, totalLosses = 0, totalNetPnl = 0;

    for (const e of entries) {
      const disc = Number(e.psychology?.disciplineScore ?? 8);
      totalDiscipline += disc;

      const followed = e.postTrade?.followedPlan ?? e.psychology?.followedTradingPlan ?? true;
      const netPnl = Number(e.netPnl || 0);
      totalNetPnl += netPnl;

      if (netPnl > 0) totalWins++;
      else if (netPnl < 0) totalLosses++;

      if (followed) {
        followedPlanCount++;
        followedNetPnl += netPnl;
        if (netPnl > 0) followedWins++;
      } else {
        brokePlanCount++;
        brokeNetPnl += netPnl;
        if (netPnl > 0) brokeWins++;
      }
    }

    const avgDiscipline = Math.round((totalDiscipline / totalEntries) * 10) / 10;
    const planAdherencePercent = Math.round((followedPlanCount / totalEntries) * 100);
    const winRate = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;

    // 2. Strategy Performance Analysis
    const stratMap = new Map();
    for (const e of entries) {
      const strat = e.strategy || "Discretionary";
      if (!stratMap.has(strat)) {
        stratMap.set(strat, {
          strategy: strat,
          trades: 0,
          wins: 0,
          losses: 0,
          totalProfit: 0,
          totalLoss: 0,
          netPnl: 0,
          plannedRRSum: 0,
          plannedRRCount: 0
        });
      }
      const st = stratMap.get(strat);
      st.trades++;
      const pnl = Number(e.netPnl || 0);
      st.netPnl += pnl;
      if (pnl > 0) {
        st.wins++;
        st.totalProfit += pnl;
      } else if (pnl < 0) {
        st.losses++;
        st.totalLoss += Math.abs(pnl);
      }
      if (e.preTrade?.plannedRiskReward) {
        st.plannedRRSum += Number(e.preTrade.plannedRiskReward);
        st.plannedRRCount++;
      }
    }

    const strategies = Array.from(stratMap.values()).map(s => {
      const closed = s.wins + s.losses;
      const winRate = closed > 0 ? Math.round((s.wins / closed) * 100) : 0;
      const avgProfit = s.wins > 0 ? Math.round(s.totalProfit / s.wins) : 0;
      const avgLoss = s.losses > 0 ? Math.round(s.totalLoss / s.losses) : 0;
      const profitFactor = s.totalLoss > 0 ? Math.round((s.totalProfit / s.totalLoss) * 100) / 100 : (s.totalProfit > 0 ? 99.99 : 1.0);
      const avgRiskReward = s.plannedRRCount > 0 ? Math.round((s.plannedRRSum / s.plannedRRCount) * 10) / 10 : null;

      return {
        strategy: s.strategy,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        winRate,
        netPnl: Math.round(s.netPnl * 100) / 100,
        avgProfit,
        avgLoss,
        profitFactor,
        avgRiskReward
      };
    }).sort((a, b) => b.netPnl - a.netPnl);

    // 3. Emotion Analysis
    const emotionMap = new Map();
    for (const e of entries) {
      const emotions = Array.isArray(e.psychology?.preTradeEmotions) && e.psychology.preTradeEmotions.length > 0
        ? e.psychology.preTradeEmotions
        : ["Neutral / Undefined"];

      for (const emo of emotions) {
        if (!emotionMap.has(emo)) {
          emotionMap.set(emo, {
            emotion: emo,
            trades: 0,
            wins: 0,
            losses: 0,
            netPnl: 0,
            disciplineSum: 0
          });
        }
        const em = emotionMap.get(emo);
        em.trades++;
        const pnl = Number(e.netPnl || 0);
        em.netPnl += pnl;
        if (pnl > 0) em.wins++;
        else if (pnl < 0) em.losses++;
        em.disciplineSum += Number(e.psychology?.disciplineScore ?? 8);
      }
    }

    const emotions = Array.from(emotionMap.values()).map(em => {
      const closed = em.wins + em.losses;
      return {
        emotion: em.emotion,
        trades: em.trades,
        winRate: closed > 0 ? Math.round((em.wins / closed) * 100) : 0,
        netPnl: Math.round(em.netPnl * 100) / 100,
        avgDiscipline: Math.round((em.disciplineSum / em.trades) * 10) / 10
      };
    }).sort((a, b) => b.trades - a.trades);

    // 4. Mistake Tracker Analysis
    const mistakeMap = new Map();
    for (const e of entries) {
      const mistakes = Array.isArray(e.mistakes) ? e.mistakes : [];
      const pnl = Number(e.netPnl || 0);
      const isLoss = pnl < 0;

      for (const m of mistakes) {
        if (!mistakeMap.has(m)) {
          mistakeMap.set(m, {
            mistake: m,
            count: 0,
            losingTrades: 0,
            winningTrades: 0,
            financialLoss: 0,
            netPnl: 0
          });
        }
        const item = mistakeMap.get(m);
        item.count++;
        item.netPnl += pnl;
        if (isLoss) {
          item.losingTrades++;
          item.financialLoss += Math.abs(pnl);
        } else if (pnl > 0) {
          item.winningTrades++;
        }
      }
    }

    const mistakes = Array.from(mistakeMap.values()).map(m => ({
      mistake: m.mistake,
      count: m.count,
      losingTrades: m.losingTrades,
      winningTrades: m.winningTrades,
      financialLoss: Math.round(m.financialLoss * 100) / 100,
      netPnl: Math.round(m.netPnl * 100) / 100
    })).sort((a, b) => b.count - a.count);

    // 5. Pre-Trade vs Post-Trade Expectations
    let confidenceStats = {
      HIGH: { trades: 0, wins: 0, pnl: 0 },
      MEDIUM: { trades: 0, wins: 0, pnl: 0 },
      LOW: { trades: 0, wins: 0, pnl: 0 }
    };
    let plannedRRTotal = 0, plannedRRCount = 0;
    let actualRRTotal = 0, actualRRCount = 0;

    for (const e of entries) {
      const conf = e.preTrade?.confidenceLevel || "MEDIUM";
      if (!confidenceStats[conf]) confidenceStats[conf] = { trades: 0, wins: 0, pnl: 0 };
      confidenceStats[conf].trades++;
      const pnl = Number(e.netPnl || 0);
      confidenceStats[conf].pnl += pnl;
      if (pnl > 0) confidenceStats[conf].wins++;

      if (e.preTrade?.plannedRiskReward) {
        plannedRRTotal += Number(e.preTrade.plannedRiskReward);
        plannedRRCount++;
      }

      if (e.entryPrice && e.exitPrice && e.preTrade?.plannedStopLoss) {
        const isBuy = e.direction === "BUY" || e.direction === "LONG";
        const risk = Math.abs(e.entryPrice - e.preTrade.plannedStopLoss);
        const actualGain = isBuy ? (e.exitPrice - e.entryPrice) : (e.entryPrice - e.exitPrice);
        if (risk > 0) {
          actualRRTotal += actualGain / risk;
          actualRRCount++;
        }
      }
    }

    // 6. Timeframe Reviews (Weekly, Monthly, Yearly)
    const weeklyMap = new Map();
    const monthlyMap = new Map();
    const yearlyMap = new Map();

    for (const e of entries) {
      const d = new Date(e.createdAt);
      const year = d.getFullYear();
      const month = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      // ISO week calculation
      const startOfYear = new Date(year, 0, 1);
      const weekNum = Math.ceil((((d - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
      const week = `${year}-W${String(weekNum).padStart(2, "0")}`;

      const pnl = Number(e.netPnl || 0);
      const disc = Number(e.psychology?.disciplineScore ?? 8);
      const followed = e.postTrade?.followedPlan ?? true;

      // Group Helper
      const accumulate = (map, key, label) => {
        if (!map.has(key)) {
          map.set(key, {
            period: key,
            label,
            trades: 0,
            wins: 0,
            losses: 0,
            netPnl: 0,
            discSum: 0,
            followedCount: 0
          });
        }
        const item = map.get(key);
        item.trades++;
        item.netPnl += pnl;
        item.discSum += disc;
        if (pnl > 0) item.wins++;
        else if (pnl < 0) item.losses++;
        if (followed) item.followedCount++;
      };

      accumulate(weeklyMap, week, `Week ${weekNum}, ${year}`);
      accumulate(monthlyMap, month, d.toLocaleDateString("en-IN", { month: "short", year: "numeric" }));
      accumulate(yearlyMap, String(year), String(year));
    }

    const formatReviewList = (map) => {
      return Array.from(map.values()).map(item => {
        const closed = item.wins + item.losses;
        return {
          period: item.period,
          label: item.label,
          trades: item.trades,
          wins: item.wins,
          losses: item.losses,
          winRate: closed > 0 ? Math.round((item.wins / closed) * 100) : 0,
          netPnl: Math.round(item.netPnl * 100) / 100,
          avgDiscipline: Math.round((item.discSum / item.trades) * 10) / 10,
          planAdherence: Math.round((item.followedCount / item.trades) * 100)
        };
      }).sort((a, b) => b.period.localeCompare(a.period));
    };

    return res.status(200).json({
      success: true,
      data: {
        totalEntries,
        disciplineScore: avgDiscipline,
        planAdherencePercent,
        totalNetPnl: Math.round(totalNetPnl * 100) / 100,
        winRate,
        followedPlanStats: {
          count: followedPlanCount,
          winRate: followedPlanCount > 0 ? Math.round((followedWins / followedPlanCount) * 100) : 0,
          netPnl: Math.round(followedNetPnl * 100) / 100,
          avgPnl: followedPlanCount > 0 ? Math.round(followedNetPnl / followedPlanCount) : 0
        },
        brokePlanStats: {
          count: brokePlanCount,
          winRate: brokePlanCount > 0 ? Math.round((brokeWins / brokePlanCount) * 100) : 0,
          netPnl: Math.round(brokeNetPnl * 100) / 100,
          avgPnl: brokePlanCount > 0 ? Math.round(brokeNetPnl / brokePlanCount) : 0
        },
        expectations: {
          avgPlannedRR: plannedRRCount > 0 ? Math.round((plannedRRTotal / plannedRRCount) * 100) / 100 : null,
          avgActualRR: actualRRCount > 0 ? Math.round((actualRRTotal / actualRRCount) * 100) / 100 : null,
          confidenceBreakdown: Object.keys(confidenceStats).map(c => ({
            confidence: c,
            trades: confidenceStats[c].trades,
            winRate: confidenceStats[c].trades > 0 ? Math.round((confidenceStats[c].wins / confidenceStats[c].trades) * 100) : 0,
            netPnl: Math.round(confidenceStats[c].pnl * 100) / 100
          }))
        },
        strategies,
        emotions,
        mistakes,
        reviews: {
          weekly: formatReviewList(weeklyMap),
          monthly: formatReviewList(monthlyMap),
          yearly: formatReviewList(yearlyMap)
        }
      }
    });
  } catch (error) {
    console.error("Get journal analytics error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to generate journal analytics" });
  }
};

/**
 * ✅ Get Unique User Strategies
 * GET /api/journal/strategies
 */
export const getJournalStrategies = async (req, res) => {
  try {
    const userId = getVerifiedUserId(req, res);
    if (!userId) return;

    const strategies = await JournalEntry.distinct("strategy", {
      userId: new mongoose.Types.ObjectId(userId)
    });

    const defaultStrategies = [
      "Breakout",
      "Mean Reversion",
      "Trend Following",
      "Support & Resistance",
      "Pullback",
      "Opening Range Breakout (ORB)",
      "Momentum",
      "Scalping",
      "Discretionary"
    ];

    const merged = Array.from(new Set([...defaultStrategies, ...strategies.filter(Boolean)])).sort();

    return res.status(200).json({ success: true, data: merged });
  } catch (error) {
    console.error("Get strategies error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch strategies" });
  }
};

/**
 * ✅ Handle Screenshot and File Upload with Multer
 * POST /api/journal/upload
 */
export const handleJournalUpload = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded or invalid file format" });
  }

  // Build public static URL
  const fileUrl = `/uploads/journal/${req.file.filename}`;

  return res.status(200).json({
    success: true,
    data: {
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    }
  });
};

