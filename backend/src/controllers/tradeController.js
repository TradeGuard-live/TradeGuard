import mongoose from "mongoose";
import TradeRecord from "../models/TradeRecord.js";
import BrokerAccount from "../models/BrokerAccount.js";
import { calculateCharges, calculatePnL } from "../services/calculations.js";
import brokerConfig from "../services/brokers/brokerConfig.js";
import positionEngine from "../services/position/PositionEngine.js";
import pnlEngine from "../services/pnl/PnLEngine.js";

const getUserId = (req, res) => {
  const userId = req.query.userId || req.params.userId;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    res.status(400).json({ success: false, message: "A valid MongoDB userId is required" });
    return null;
  }
  return userId;
};

export const listTrades = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const { broker, side, search, limit = "500" } = req.query;
    const filter = { userId, status: "COMPLETE" };
    if (broker && broker !== "all") filter.broker = broker;
    if (side && side !== "all") filter.transactionType = side.toUpperCase();
    if (search) filter.symbol = { $regex: String(search).slice(0, 80), $options: "i" };
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000);
    const records = await TradeRecord.find(filter)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean();
    return res.json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error("List trades error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch trades" });
  }
};

export const getTradeSummary = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const [summary] = await TradeRecord.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), status: "COMPLETE" } },
      { $group: {
        _id: null,
        totalExecutions: { $sum: 1 },
        buyExecutions: { $sum: { $cond: [{ $eq: ["$transactionType", "BUY"] }, 1, 0] } },
        sellExecutions: { $sum: { $cond: [{ $eq: ["$transactionType", "SELL"] }, 1, 0] } },
        totalQuantity: { $sum: "$quantity" },
        brokerSet: { $addToSet: "$broker" },
        symbolSet: { $addToSet: "$symbol" }
      }}
    ]);
    const accounts = await BrokerAccount.countDocuments({ userId });
    return res.json({
      success: true,
      data: {
        totalExecutions: summary?.totalExecutions || 0,
        buyExecutions: summary?.buyExecutions || 0,
        sellExecutions: summary?.sellExecutions || 0,
        totalQuantity: summary?.totalQuantity || 0,
        brokersWithTrades: summary?.brokerSet?.length || 0,
        distinctSymbols: summary?.symbolSet?.length || 0,
        brokerAccounts: accounts
      }
    });
  } catch (error) {
    console.error("Trade summary error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to calculate trade summary" });
  }
};


function effectiveTradeDate(t) {
  const d = t.tradeTime || t.executedAt || t.createdAt || t.updatedAt;
  const parsed = d ? new Date(d) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function getEffectivePrice(t) {
  const p = Number(t.executedPrice ?? t.brokerResponse?.price ?? t.price);
  return Number.isFinite(p) ? p : 0;
}

// FIFO matching of executions; only closed quantity contributes realized P&L.
function buildRealizedMatches(records) {
  const queues = new Map();
  const closes = [];
  const ordered = [...records].filter(t => effectiveTradeDate(t) &&
    Number(t.quantity) > 0 && getEffectivePrice(t) > 0)
    .sort((a,b) => effectiveTradeDate(a)-effectiveTradeDate(b));
  for (const t of ordered) {
    const key = [String(t.brokerAccountId || ""), t.exchange || "", t.segment || "",
      t.symbol || "", t.productCode || ""].join("|");
    const side = String(t.transactionType || "").toUpperCase();
    if (!["BUY","SELL"].includes(side)) continue;
    const signedQty = side === "BUY" ? Number(t.quantity) : -Number(t.quantity);
    let remaining = Math.abs(signedQty);
    const queue = queues.get(key) || [];
    const execPrice = getEffectivePrice(t);
    while (remaining > 0 && queue.length && Math.sign(queue[0].qty) !== Math.sign(signedQty)) {
      const lot = queue[0];
      const matched = Math.min(remaining, Math.abs(lot.qty));
      const pnl = (execPrice - lot.price) * matched * (lot.qty > 0 ? 1 : -1);
      closes.push({ pnl, quantity: matched, broker: t.broker || "UNKNOWN",
        date: effectiveTradeDate(t), symbol: t.symbol, entryPrice: lot.price,
        exitPrice: execPrice });
      lot.qty += Math.sign(signedQty) * matched;
      remaining -= matched;
      if (Math.abs(lot.qty) < 1e-9) queue.shift();
    }
    if (remaining > 0) queue.push({ qty: Math.sign(signedQty) * remaining, price: execPrice });
    queues.set(key, queue);
  }
  return closes;
}

export const getAnalytics = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const objectId = new mongoose.Types.ObjectId(userId);
    const now = new Date();
    const range = String(req.query.range || "30d").toLowerCase();

    let cutoff;
    if (range === "today" || range === "1d") {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (range === "7d" || range === "1w") {
      cutoff = new Date(now.getTime() - 7 * 86400000);
    } else if (range === "30d" || range === "1m") {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    } else if (range === "90d" || range === "3m") {
      cutoff = new Date(now.getTime() - 90 * 86400000);
    } else if (range === "1y" || range === "365d") {
      cutoff = new Date(now.getTime() - 365 * 86400000);
    } else if (range === "all") {
      cutoff = new Date(0);
    } else {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    }

    const all = await TradeRecord.find({ userId: objectId, status: "COMPLETE" }).lean();
    const trades = all.filter(t => {
      const d = effectiveTradeDate(t);
      return d && d >= cutoff && d <= now;
    }).sort((a,b) => effectiveTradeDate(a)-effectiveTradeDate(b));

    // Include pre-range executions so positions opened earlier can be matched to exits in range.
    const closes = buildRealizedMatches(all).filter(c => c.date >= cutoff && c.date <= now);
    const byDay = new Map();
    for (const c of closes) {
      const key = c.date.toISOString().slice(0,10);
      byDay.set(key, (byDay.get(key) || 0) + c.pnl);
    }
    let running = 0;
    const equitySeries = [...byDay.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,pnl]) => {
      running += pnl;
      return { date: new Date(`${date}T12:00:00`).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}), value: Math.round(running) };
    });

    // Real date-aligned Win and Loss Period breakdown (calendar months for 1y/all, weekly for 30d, daily for 7d)
    const weeklyPnL = [];

    if (range === "today" || range === "1d") {
      const sessions = [
        { label: "09:15 - 11:30", startHour: 9, startMin: 15, endHour: 11, endMin: 30 },
        { label: "11:30 - 13:30", startHour: 11, startMin: 30, endHour: 13, endMin: 30 },
        { label: "13:30 - 15:30", startHour: 13, startMin: 30, endHour: 15, endMin: 30 }
      ];
      for (const s of sessions) {
        const pStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), s.startHour, s.startMin);
        const pEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), s.endHour, s.endMin);
        const matched = closes.filter(c => c.date >= pStart && c.date <= pEnd);
        weeklyPnL.push({
          label: s.label,
          dateRange: `Today ${s.label}`,
          wins: Math.round(matched.filter(c => c.pnl > 0).reduce((sum, c) => sum + c.pnl, 0)),
          losses: Math.round(Math.abs(matched.filter(c => c.pnl < 0).reduce((sum, c) => sum + c.pnl, 0)))
        });
      }
    } else if (range === "7d" || range === "1w") {
      for (let i = 6; i >= 0; i--) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
        const dEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
        const matched = closes.filter(c => c.date >= dStart && c.date <= dEnd);
        const label = day.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        weeklyPnL.push({
          label,
          dateRange: day.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
          wins: Math.round(matched.filter(c => c.pnl > 0).reduce((sum, c) => sum + c.pnl, 0)),
          losses: Math.round(Math.abs(matched.filter(c => c.pnl < 0).reduce((sum, c) => sum + c.pnl, 0)))
        });
      }
    } else if (range === "30d" || range === "1m") {
      const daysPerSlice = 7;
      for (let i = 3; i >= 0; i--) {
        const pStart = new Date(now.getTime() - (i + 1) * daysPerSlice * 86400000);
        const pEnd = new Date(now.getTime() - i * daysPerSlice * 86400000);
        const matched = closes.filter(c => c.date >= pStart && c.date < pEnd);
        const label = `${pStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} - ${pEnd.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
        weeklyPnL.push({
          label,
          dateRange: `${pStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} to ${pEnd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
          wins: Math.round(matched.filter(c => c.pnl > 0).reduce((sum, c) => sum + c.pnl, 0)),
          losses: Math.round(Math.abs(matched.filter(c => c.pnl < 0).reduce((sum, c) => sum + c.pnl, 0)))
        });
      }
    } else {
      // 1y, 365d, fy, all, 90d -> Calendar Month Grouping!
      let startMonthDate;
      if (range === "all") {
        if (closes.length > 0) {
          const earliest = Math.min(...closes.map(c => c.date.getTime()));
          startMonthDate = new Date(earliest);
        } else {
          startMonthDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        }
      } else if (range === "fy") {
        const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        startMonthDate = new Date(fyYear, 3, 1);
      } else if (range === "90d" || range === "3m") {
        startMonthDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      } else {
        startMonthDate = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
      }

      const cur = new Date(startMonthDate.getFullYear(), startMonthDate.getMonth(), 1);
      const endMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      while (cur <= endMonth) {
        const mStart = new Date(cur.getFullYear(), cur.getMonth(), 1, 0, 0, 0);
        const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999);
        const matched = closes.filter(c => c.date >= mStart && c.date <= mEnd);
        const label = cur.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
        const fullLabel = cur.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

        weeklyPnL.push({
          label,
          dateRange: fullLabel,
          wins: Math.round(matched.filter(c => c.pnl > 0).reduce((sum, c) => sum + c.pnl, 0)),
          losses: Math.round(Math.abs(matched.filter(c => c.pnl < 0).reduce((sum, c) => sum + c.pnl, 0)))
        });

        cur.setMonth(cur.getMonth() + 1);
      }

      if (weeklyPnL.length > 12) {
        const sliced = weeklyPnL.slice(-12);
        weeklyPnL.length = 0;
        weeklyPnL.push(...sliced);
      }
    }

    const brokerMap = new Map();
    // Pre-populate brokers from in-range trades
    for (const t of trades) {
      if (t.broker && !brokerMap.has(t.broker)) {
        brokerMap.set(t.broker, { pnl: 0, trades: 0 });
      }
    }
    // Aggregate realized P&L from closed positions
    for (const c of closes) {
      const b = c.broker || "UNKNOWN";
      const prev = brokerMap.get(b) || { pnl: 0, trades: 0 };
      brokerMap.set(b, { ...prev, pnl: prev.pnl + c.pnl });
    }
    // Count trades for each broker
    for (const t of trades) {
      if (t.broker && brokerMap.has(t.broker)) {
        brokerMap.get(t.broker).trades++;
      }
    }

    const brokerPnL = [...brokerMap.entries()].map(([broker, data]) => ({
      broker,
      name: brokerConfig.brokers[broker]?.name || (broker === "ANGEL_ONE" ? "Angel One" : broker),
      value: Math.round((data.pnl + Number.EPSILON) * 100) / 100,
      trades: data.trades
    })).sort((a, b) => b.trades - a.trades);

    // Build trading activity breakdown based on selected range
    let dailyActivity = [];
    if (range === "today" || range === "1d") {
      const slots = [
        { label: "09:15 - 11:30", startH: 9, startM: 15, endH: 11, endM: 30 },
        { label: "11:30 - 13:30", startH: 11, startM: 30, endH: 13, endM: 30 },
        { label: "13:30 - 15:30", startH: 13, startM: 30, endH: 15, endM: 30 },
        { label: "Post Market",   startH: 15, startM: 30, endH: 23, endM: 59 }
      ];
      dailyActivity = slots.map(s => {
        const count = trades.filter(t => {
          const d = effectiveTradeDate(t);
          if (!d) return false;
          const mins = d.getHours() * 60 + d.getMinutes();
          return mins >= (s.startH * 60 + s.startM) && mins <= (s.endH * 60 + s.endM);
        }).length;
        return {
          label: s.label,
          day: s.label,
          value: count,
          dateRange: `Today (${s.label})`
        };
      });
    } else if (range === "7d" || range === "1w") {
      // 7 calendar days
      for (let i = 6; i >= 0; i--) {
        const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const ymd = target.toISOString().slice(0, 10);
        const count = trades.filter(t => {
          const d = effectiveTradeDate(t);
          return d && d.toISOString().slice(0, 10) === ymd;
        }).length;
        dailyActivity.push({
          label: target.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          day: target.toLocaleDateString("en-IN", { weekday: "short" }),
          value: count,
          dateRange: target.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })
        });
      }
    } else if (range === "30d" || range === "1m") {
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const dayFullNames = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
      const activity = new Map();
      for (const t of trades) {
        const d = effectiveTradeDate(t);
        if (!d) continue;
        const dayIdx = (d.getDay() + 6) % 7;
        const name = dayNames[dayIdx];
        activity.set(name, (activity.get(name) || 0) + 1);
      }
      dailyActivity = dayNames.map(name => ({
        label: name,
        day: dayFullNames[name],
        value: activity.get(name) || 0,
        dateRange: `${dayFullNames[name]} — ${activity.get(name) || 0} trades in last 30 days`
      }));
    } else {
      // 90d, 1y, all -> Mon-Sun breakdown with full day names and context
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const dayFullNames = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
      const activity = new Map();
      for (const t of trades) {
        const d = effectiveTradeDate(t);
        if (!d) continue;
        const dayIdx = (d.getDay() + 6) % 7;
        const name = dayNames[dayIdx];
        activity.set(name, (activity.get(name) || 0) + 1);
      }
      const periodName = range === 'all' ? 'All Time' : (range === '1y' ? 'Past 1 Year' : 'Past 90 Days');
      dailyActivity = dayNames.map(name => ({
        label: name,
        day: dayFullNames[name],
        value: activity.get(name) || 0,
        dateRange: `${dayFullNames[name]} — ${activity.get(name) || 0} trades (${periodName})`
      }));
    }
    const wins=closes.filter(c=>c.pnl>0), losses=closes.filter(c=>c.pnl<0);
    return res.json({success:true,data:{
      equitySeries,weeklyPnL,brokerPnL,dailyActivity,
      averageWin:wins.length?wins.reduce((s,c)=>s+c.pnl,0)/wins.length:0,
      averageLoss:losses.length?Math.abs(losses.reduce((s,c)=>s+c.pnl,0)/losses.length):0,
      winningTrades:wins.length,losingTrades:losses.length,
      realizedPnL:closes.reduce((s,c)=>s+c.pnl,0),closedTrades:closes.length
    }});
  } catch(error) {
    console.error("Analytics error:",error.message);
    return res.status(500).json({success:false,message:"Failed to fetch analytics"});
  }
};

export const getInstrumentDistribution = async (req, res) => {
  try {
    const userId=getUserId(req,res); if(!userId)return;
    const trades=await TradeRecord.find({userId:new mongoose.Types.ObjectId(userId),status:"COMPLETE"}).lean();
    const counts={};
    for(const t of trades){
      const seg=String(t.segment||"").toUpperCase();
      const product=String(t.productCode||"").toUpperCase();
      let category;
      if(seg==="FUTURES" || seg==="FUTURE") category="Futures";
      else if(seg==="OPTIONS" || seg==="OPTION") category="Options";
      else if(seg==="EQUITY" && ["INTRADAY","I","MIS"].includes(product)) category="Equity Intraday";
      else if(seg==="EQUITY" && ["DELIVERY","D","CNC"].includes(product)) category="Equity Delivery";
      else if(seg==="EQUITY") category="Equity (product unknown)";
      else category="Other / Unknown";
      counts[category]=(counts[category]||0)+1;
    }
    const total=Object.values(counts).reduce((a,b)=>a+b,0);
    return res.json({success:true,data:{distribution:Object.entries(counts).map(([label,count])=>({label,count,value:total?Math.round(count/total*100):0})),total}});
  }catch(error){console.error("Instrument distribution error:",error.message);return res.status(500).json({success:false,message:"Failed to fetch instrument distribution"});}
};

export const getReportData = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const now = new Date();
    const range = String(req.query.range || "30d").toLowerCase();
    const brokerFilter = req.query.broker;

    let cutoff;
    if (range === "today" || range === "1d") {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (range === "7d" || range === "1w") {
      cutoff = new Date(now.getTime() - 7 * 86400000);
    } else if (range === "30d" || range === "1m") {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    } else if (range === "90d" || range === "3m") {
      cutoff = new Date(now.getTime() - 90 * 86400000);
    } else if (range === "1y" || range === "365d") {
      cutoff = new Date(now.getTime() - 365 * 86400000);
    } else if (range === "fy") {
      const currentYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      cutoff = new Date(currentYear, 3, 1, 0, 0, 0);
    } else if (range === "all") {
      cutoff = new Date(0);
    } else {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    }

    const query = {
      userId: new mongoose.Types.ObjectId(userId),
      status: "COMPLETE"
    };
    if (brokerFilter && brokerFilter !== "all") {
      query.broker = brokerFilter;
    }

    const all = await TradeRecord.find(query).lean();
    const trades = all.filter(t => {
      const d = effectiveTradeDate(t);
      return d && d >= cutoff && d <= now;
    }).sort((a, b) => (effectiveTradeDate(b) || 0) - (effectiveTradeDate(a) || 0));

    const closes = buildRealizedMatches(all)
      .filter(c => c.date >= cutoff && c.date <= now)
      .sort((a, b) => b.date - a.date);

    const wins = closes.filter(c => c.pnl > 0);
    const losses = closes.filter(c => c.pnl < 0);
    const grossPnl = closes.reduce((s, c) => s + c.pnl, 0);

    let totalCharges = 0;
    for (const t of trades) {
      try {
        const c = pnlEngine.calculateTradeFillCharges({
          symbol: t.symbol,
          exchange: t.exchange || "NSE",
          segment: t.segment || "EQUITY",
          productType: t.productCode || "INTRADAY",
          transactionType: t.transactionType || "BUY",
          quantity: Number(t.quantity) || 0,
          price: getEffectivePrice(t),
          broker: t.broker || "UPSTOX"
        });
        totalCharges += (c.total || 0);
      } catch (err) {
        // continue
      }
    }

    const netPnl = grossPnl - totalCharges;
    const totalWinPnl = wins.reduce((s, c) => s + c.pnl, 0);
    const totalLossPnl = Math.abs(losses.reduce((s, c) => s + c.pnl, 0));
    const profitFactor = totalLossPnl > 0 ? (totalWinPnl / totalLossPnl) : (totalWinPnl > 0 ? 99.9 : 1);

    const largestWin = wins.length ? Math.max(...wins.map(c => c.pnl)) : 0;
    const largestLoss = losses.length ? Math.min(...losses.map(c => c.pnl)) : 0;

    const brokers = new Map();
    for (const c of closes) {
      brokers.set(c.broker, (brokers.get(c.broker) || 0) + c.pnl);
    }
    const brokerBreakdown = [...brokers].map(([broker, value]) => ({
      broker,
      name: brokerConfig.brokers[broker]?.name || broker,
      value: Math.round(value * 100) / 100
    }));

    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

    return res.json({
      success: true,
      data: {
        range,
        period: {
          from: cutoff.toISOString(),
          to: now.toISOString()
        },
        grossPnl: round2(grossPnl),
        totalCharges: round2(totalCharges),
        netPnl: round2(netPnl),
        totalTrades: trades.length,
        closedTrades: closes.length,
        winRate: closes.length ? Math.round((wins.length / closes.length) * 1000) / 10 : 0,
        winningTrades: wins.length,
        losingTrades: losses.length,
        averageWin: wins.length ? round2(totalWinPnl / wins.length) : 0,
        averageLoss: losses.length ? round2(totalLossPnl / losses.length) : 0,
        profitFactor: round2(profitFactor),
        largestWin: round2(largestWin),
        largestLoss: round2(largestLoss),
        brokerBreakdown,
        closedPositions: closes.map(c => ({
          symbol: c.symbol,
          broker: c.broker,
          brokerName: brokerConfig.brokers[c.broker]?.name || c.broker,
          quantity: c.quantity,
          entryPrice: round2(c.entryPrice),
          exitPrice: round2(c.exitPrice),
          pnl: round2(c.pnl),
          pnlPercent: c.entryPrice > 0 ? round2(((c.exitPrice - c.entryPrice) / c.entryPrice) * 100) : 0,
          date: c.date.toISOString()
        })),
        trades: trades.slice(0, 500).map(t => {
          const d = effectiveTradeDate(t);
          return {
            tradeId: t.tradeId,
            orderId: t.orderId,
            symbol: t.symbol,
            broker: t.broker,
            brokerName: brokerConfig.brokers[t.broker]?.name || t.broker,
            segment: t.segment || "EQUITY",
            productCode: t.productCode || "INTRADAY",
            transactionType: t.transactionType,
            quantity: t.quantity,
            executedPrice: t.executedPrice,
            tradeTime: d ? d.toISOString() : (t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString())
          };
        })
      }
    });
  } catch (error) {
    console.error("Report error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch report data" });
  }
};

export const getRiskExposures = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const objectId = new mongoose.Types.ObjectId(userId);

    const positions = await TradeRecord.aggregate([
      { $match: { userId: objectId, status: "COMPLETE" } },
      { $group: {
        _id: "$symbol",
        totalQty: { $sum: { $cond: [{ $eq: ["$transactionType", "BUY"] }, "$quantity", { $multiply: ["$quantity", -1] }] } },
        avgPrice: { $avg: "$executedPrice" },
        lastTrade: { $max: "$createdAt" }
      }}
    ]);

    const exposures = positions
      .filter(p => p.totalQty !== 0)
      .map(p => ({
        instrument: p._id,
        quantity: Math.abs(p.totalQty),
        direction: p.totalQty > 0 ? "LONG" : "SHORT",
        avgPrice: Math.round(p.avgPrice * 100) / 100,
        exposureAmount: Math.round(Math.abs(p.totalQty) * p.avgPrice * 100) / 100,
        lastTrade: p.lastTrade
      }));

    const totalExposure = exposures.reduce((sum, e) => sum + e.exposureAmount, 0);

    const allTrades = await TradeRecord.find({ userId: objectId, status: "COMPLETE" })
      .sort({ createdAt: 1 })
      .lean();

    const closed = buildRealizedMatches(allTrades);

    let peak = 0;
    let running = 0;
    let maxDrawdown = 0;
    let todayPnL = 0;
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const c of closed) {
      running += c.pnl;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (c.date && c.date.toISOString().slice(0, 10) === todayStr) {
        todayPnL += c.pnl;
      }
    }

    return res.json({
      success: true,
      data: {
        exposures,
        totalExposure: Math.round(totalExposure * 100) / 100,
        openPositionsCount: exposures.length,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        todayPnL: Math.round(todayPnL * 100) / 100,
        totalTrades: allTrades.length,
        closedPositionsCount: closed.length
      }
    });
  } catch (error) {
    console.error("Risk exposures error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch exposures" });
  }
};

export const getBrokerComparison = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const objectId = new mongoose.Types.ObjectId(userId);

    const accounts = await BrokerAccount.find({ userId: objectId }).lean();
    const connectedBrokers = new Set(accounts.filter(a => a.isConnected).map(a => a.broker));

    const brokers = Object.entries(brokerConfig.brokers).map(([key, config]) => ({
      broker: key,
      name: config.name,
      delivery: config.brokerage?.equityDelivery?.type === "FLAT" && config.brokerage?.equityDelivery?.amount === 0
        ? "₹0"
        : `₹${config.brokerage?.equityDelivery?.amount || 20}/order`,
      intraday: config.brokerage?.equityIntraday?.type === "FLAT"
        ? `₹${config.brokerage?.equityIntraday?.amount || 20}/order`
        : `₹${config.brokerage?.equityIntraday?.flat || 20}/order`,
      segments: key === "UPSTOX" ? "Equity, F&O, Currency" : key === "ANGEL_ONE" ? "Equity, F&O, Commodity, Currency" : "Equity, F&O, Commodity",
      connection: connectedBrokers.has(key) ? "Connected" : "Not configured"
    }));

    return res.json({
      success: true,
      data: { brokers }
    });
  } catch (error) {
    console.error("Broker comparison error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch broker comparison" });
  }
};

export const calculateTradeCharges = async (req,res) => {
  try {
    const {broker,productType,buyPrice,sellPrice,quantity,exchange="NSE"}=req.body;
    const buy=Number(buyPrice), sell=Number(sellPrice), qty=Number(quantity);
    if(!broker||!productType||!Number.isFinite(buy)||!Number.isFinite(sell)||!Number.isFinite(qty)||buy<=0||sell<=0||qty<=0)
      return res.status(400).json({success:false,message:"broker, productType, positive buyPrice, sellPrice and quantity are required"});
    const cfg=brokerConfig.brokers[broker]; if(!cfg)return res.status(400).json({success:false,message:"Invalid broker"});
    const p=String(productType).toLowerCase().replace(/[^a-z]/g,"");
    const key=p.includes("future")?"equityFutures":p.includes("option")?"equityOptions":p.includes("delivery")?"equityDelivery":"equityIntraday";
    const rate=cfg.brokerage?.[key]; if(!rate)return res.status(400).json({success:false,message:`Brokerage configuration missing for ${key}`});
    const buyTurn=buy*qty, sellTurn=sell*qty, totalTurn=buyTurn+sellTurn;
    const brokerageFor=(turn)=> {
      if(rate.type==="FLAT")return Number(rate.amount||0);
      if(rate.type==="LOWER_OF")return Math.min(Number(rate.flat||0),turn*Number(rate.percentage||0)/100);
      if(rate.type==="PERCENTAGE")return turn*Number(rate.percentage||0)/100;
      return 0;
    };
    const brokerage=brokerageFor(buyTurn)+brokerageFor(sellTurn);
    const exchangeCfg=brokerConfig.exchangeCharges?.[exchange]?.[key] || brokerConfig.exchangeCharges?.NSE?.[key];
    const sttCfg=brokerConfig.statutoryCharges.STT[key];
    const stampCfg=brokerConfig.statutoryCharges.stampDuty[key];
    if(!exchangeCfg||!sttCfg||!stampCfg)return res.status(400).json({success:false,message:`Charge configuration missing for ${key}`});
    const basisValue=(basis,side)=> {
      if(basis==="PREMIUM")return side==="buy"?buyTurn:sellTurn;
      return side==="buy"?buyTurn:sellTurn;
    };
    const exchangeCharges=(basisValue(exchangeCfg.basis,"buy")*Number(exchangeCfg.buy||0)/100)+(basisValue(exchangeCfg.basis,"sell")*Number(exchangeCfg.sell||0)/100);
    const stt=(basisValue(sttCfg.basis,"buy")*Number(sttCfg.buy||0)/100)+(basisValue(sttCfg.basis,"sell")*Number(sttCfg.sell||0)/100);
    const stampDuty=(buyTurn*Number(stampCfg.buy||0)/100)+(sellTurn*Number(stampCfg.sell||0)/100);
    const sebi=(totalTurn*0.000001); // ₹10 per crore = 0.0001% of turnover
    const gst=(brokerage+exchangeCharges+sebi)*0.18;
    const dpCharges=key==="equityDelivery"?(Number(cfg.dpCharges?.equityDelivery?.sell||cfg.dpCharges?.equityDelivery?.amount||0)):0;
    const totalCharges=brokerage+stt+exchangeCharges+sebi+stampDuty+gst+dpCharges;
    const grossPnL=(sell-buy)*qty;
    const round=n=>Math.round((n+Number.EPSILON)*100)/100;
    return res.json({success:true,data:{brokerage:round(brokerage),stt:round(stt),exchangeCharges:round(exchangeCharges),
      sebiCharges:round(sebi),stampDuty:round(stampDuty),dpCharges:round(dpCharges),gst:round(gst),
      totalCharges:round(totalCharges),grossPnL:round(grossPnL),netPnL:round(grossPnL-totalCharges),
      assumptions:{broker,productType:key,exchange,quantity:qty,brokeragePlan:cfg.brokeragePlan||"configured rates",note:"Estimate from local brokerConfig; verify current broker/exchange rates before relying on it."}}});
  }catch(error){console.error("Calculate charges error:",error.message);return res.status(500).json({success:false,message:error.message||"Failed to calculate charges"});}
};

export const getLiveTradingSummary = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    let trades = await TradeRecord.find({
      userId: new mongoose.Types.ObjectId(userId),
      status: "COMPLETE"
    }).lean();

    if (!trades || trades.length === 0) {
      trades = await TradeRecord.find({}).limit(50).lean();
    }

    const allPositions = positionEngine.processTrades(trades);
    const openPositions = positionEngine.getOpenPositions(trades);
    const squaredPositions = positionEngine.getFullySquaredPositions(trades);

    pnlEngine.setPositions(userId, openPositions);
    const calculated = pnlEngine.calculate(userId);

    return res.json({
      success: true,
      data: {
        ...calculated,
        allPositions,
        squaredPositions
      }
    });
  } catch (error) {
    console.error("Live trading summary error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch live trading summary" });
  }
};

export const getChargesAnalytics = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;
    const objectId = new mongoose.Types.ObjectId(userId);
    const now = new Date();
    const range = String(req.query.range || "30d").toLowerCase();

    let cutoff;
    if (range === "today" || range === "1d") {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (range === "7d" || range === "1w") {
      cutoff = new Date(now.getTime() - 7 * 86400000);
    } else if (range === "30d" || range === "1m") {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    } else if (range === "90d" || range === "3m") {
      cutoff = new Date(now.getTime() - 90 * 86400000);
    } else if (range === "1y" || range === "365d") {
      cutoff = new Date(now.getTime() - 365 * 86400000);
    } else if (range === "all") {
      cutoff = new Date(0);
    } else {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    }

    const brokerFilter = req.query.broker;

    let allTrades = await TradeRecord.find({ userId: objectId, status: "COMPLETE" }).lean();
    if (!allTrades || allTrades.length === 0) {
      allTrades = await TradeRecord.find({ userId: objectId }).lean();
    }

    // Collect unique brokers from all trades for the filter list
    const availableBrokers = [...new Set(allTrades.map(t => t.broker).filter(Boolean))];

    // Apply broker filter (filter only the in-range trades, not allTrades — needed for correct FIFO P&L)
    const filteredAll = brokerFilter && brokerFilter !== "all"
      ? allTrades.filter(t => t.broker === brokerFilter)
      : allTrades;

    const tradesInRange = filteredAll.filter(t => {
      const d = effectiveTradeDate(t);
      return d && d >= cutoff && d <= now;
    }).sort((a, b) => effectiveTradeDate(b) - effectiveTradeDate(a));

    let totalTurnover = 0;
    let totalBrokerage = 0;
    let totalSTT = 0;
    let totalGST = 0;
    let totalExchange = 0;
    let totalCTT = 0;
    let totalSEBI = 0;
    let totalStampDuty = 0;
    let totalDP = 0;
    let totalCharges = 0;

    const symbolCharges = new Map();
    const dailyCharges = new Map();

    const tradesWithCharges = tradesInRange.map(t => {
      const execPrice = getEffectivePrice(t);
      const qty = Number(t.quantity) || 0;
      const charges = pnlEngine.calculateTradeFillCharges({
        symbol: t.symbol,
        exchange: t.exchange || "NSE",
        segment: t.segment || "EQUITY",
        productType: t.productCode || "INTRADAY",
        transactionType: t.transactionType || "BUY",
        quantity: qty,
        price: execPrice,
        broker: t.broker || "UPSTOX"
      });

      totalTurnover += charges.turnover;
      totalBrokerage += charges.brokerage;
      totalSTT += charges.stt;
      totalGST += charges.gst;
      totalExchange += charges.exchangeCharges;
      totalCTT += charges.ctt;
      totalSEBI += charges.sebiCharges;
      totalStampDuty += charges.stampDuty;
      totalDP += charges.dpCharges;
      totalCharges += charges.total;

      const sym = t.symbol || "OTHER";
      symbolCharges.set(sym, (symbolCharges.get(sym) || 0) + charges.total);

      const d = effectiveTradeDate(t);
      if (d) {
        const dayKey = d.toISOString().slice(0, 10);
        dailyCharges.set(dayKey, (dailyCharges.get(dayKey) || 0) + charges.total);
      }

      return {
        _id: t._id,
        tradeId: t.tradeId,
        orderId: t.orderId,
        symbol: t.symbol,
        transactionType: t.transactionType,
        quantity: qty,
        price: execPrice,
        turnover: charges.turnover,
        tradeTime: d,
        segment: t.segment,
        exchange: t.exchange,
        broker: t.broker,
        charges
      };
    });

    const closes = buildRealizedMatches(filteredAll).filter(c => c.date >= cutoff && c.date <= now);
    const grossPnL = closes.reduce((sum, c) => sum + c.pnl, 0);
    const netPnL = grossPnL - totalCharges;

    const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

    // Per-broker charge breakdown (useful for combined/all view)
    const brokerChargesMap = new Map();
    for (const t of tradesWithCharges) {
      const b = t.broker || "UNKNOWN";
      const prev = brokerChargesMap.get(b) || { charges: 0, trades: 0, turnover: 0 };
      brokerChargesMap.set(b, {
        charges: prev.charges + (t.charges?.total || 0),
        trades: prev.trades + 1,
        turnover: prev.turnover + (t.turnover || 0)
      });
    }
    const brokerBreakdown = [...brokerChargesMap.entries()].map(([broker, data]) => ({
      broker,
      name: brokerConfig.brokers[broker]?.name || (broker === "ANGEL_ONE" ? "Angel One" : broker),
      charges: round(data.charges),
      trades: data.trades,
      turnover: round(data.turnover),
      percentage: totalCharges > 0 ? round((data.charges / totalCharges) * 100) : 0
    })).sort((a, b) => b.charges - a.charges);

    const timeline = [...dailyCharges.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({
        date: new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        charges: Math.round(amount * 100) / 100
      }));

    const topSymbols = [...symbolCharges.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([symbol, charges]) => ({
        symbol,
        charges: Math.round(charges * 100) / 100,
        percentage: totalCharges > 0 ? Math.round((charges / totalCharges) * 1000) / 10 : 0
      }));

    return res.json({
      success: true,
      data: {
        range,
        totalTrades: tradesInRange.length,
        totalTurnover: round(totalTurnover),
        grossPnL: round(grossPnL),
        netPnL: round(netPnL),
        totalCharges: round(totalCharges),
        breakdown: {
          brokerage: round(totalBrokerage),
          stt: round(totalSTT),
          gst: round(totalGST),
          exchangeCharges: round(totalExchange),
          ctt: round(totalCTT),
          sebiCharges: round(totalSEBI),
          stampDuty: round(totalStampDuty),
          dpCharges: round(totalDP)
        },
        percentages: {
          brokerage: totalCharges > 0 ? round((totalBrokerage / totalCharges) * 100) : 0,
          stt: totalCharges > 0 ? round((totalSTT / totalCharges) * 100) : 0,
          gst: totalCharges > 0 ? round((totalGST / totalCharges) * 100) : 0,
          exchangeCharges: totalCharges > 0 ? round((totalExchange / totalCharges) * 100) : 0,
          ctt: totalCharges > 0 ? round((totalCTT / totalCharges) * 100) : 0,
          sebiCharges: totalCharges > 0 ? round((totalSEBI / totalCharges) * 100) : 0,
          stampDuty: totalCharges > 0 ? round((totalStampDuty / totalCharges) * 100) : 0,
          dpCharges: totalCharges > 0 ? round((totalDP / totalCharges) * 100) : 0
        },
        chargesToTurnoverPercent: totalTurnover > 0 ? round((totalCharges / totalTurnover) * 100) : 0,
        avgChargePerTrade: tradesInRange.length > 0 ? round(totalCharges / tradesInRange.length) : 0,
        timeline,
        topSymbols,
        brokerBreakdown,
        availableBrokers,
        activeBrokerFilter: brokerFilter || "all",
        recentTrades: tradesWithCharges.slice(0, 50)
      }
    });
  } catch (error) {
    console.error("Charges analytics error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to calculate charges analytics" });
  }
};

export const createTrade = async (req, res) => {
  try {
    const {
      userId,
      brokerAccountId,
      broker,
      symbol,
      exchange = "NSE",
      segment = "EQUITY",
      transactionType,
      quantity,
      executedPrice,
      orderType = "MARKET",
      productCode = "INTRADAY",
      tradeTime,
      tradeId,
      orderId
    } = req.body;

    if (!userId || !brokerAccountId || !symbol || !transactionType || !quantity || !executedPrice) {
      return res.status(400).json({
        success: false,
        message: "userId, brokerAccountId, symbol, transactionType, quantity, and executedPrice are required"
      });
    }

    const tId = tradeId || `TRD-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const trade = await TradeRecord.create({
      userId,
      brokerAccountId,
      broker: broker || "ANGEL_ONE",
      tradeId: tId,
      orderId: orderId || `ORD-${tId}`,
      symbol: String(symbol).toUpperCase(),
      exchange: String(exchange).toUpperCase(),
      segment: String(segment).toUpperCase(),
      transactionType: String(transactionType).toUpperCase(),
      quantity: Number(quantity),
      executedPrice: Number(executedPrice),
      orderType: String(orderType).toUpperCase(),
      status: "COMPLETE",
      productCode: String(productCode).toUpperCase(),
      tradeTime: tradeTime ? new Date(tradeTime) : new Date()
    });

    return res.status(201).json({
      success: true,
      message: "Trade created successfully",
      data: trade
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A trade with this tradeId already exists" });
    }
    return res.status(500).json({ success: false, message: err.message || "Failed to create trade" });
  }
};

