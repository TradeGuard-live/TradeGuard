// src/services/calculationService.js

/*
Expected trade fields:
{
  tradeId: String,
  orderId: String,
  symbol: String,
  exchange: String,
  segment: String,
  transactionType: "BUY" | "SELL",
  quantity: Number,
  executedPrice: Number,
  tradeTime: Date | String,
  brokerAccountId: String,
  productType: String
}

Expected brokerConfig example is provided after this file.
*/

// ------------------------------
// General helpers
// ------------------------------

const EPSILON = 0.00000001;

function toNumber(value, fieldName = "value") {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		throw new Error(`$ {fieldName} must be a valid number`);
	}

	return number;
}

function positiveNumber(value, fieldName) {
	const number = toNumber(value, fieldName);

	if (number <= 0) {
		throw new Error(`$ {fieldName} must be greater than zero`);
	}

	return number;
}

function nonNegativeNumber(value, fieldName) {
	const number = toNumber(value, fieldName);

	if (number < 0) {
		throw new Error(`$ {fieldName} cannot be negative`);
	}

	return number;
}

function roundMoney(value) {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
	return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function normalizeSide(side) {
	const normalized = String(side || "").toUpperCase();

	if (normalized !== "BUY" && normalized !== "SELL") {
		throw new Error(`Invalid transactionType: $ {side}`);
	}

	return normalized;
}

function getTradeValue(price, quantity) {
	return price * quantity;
}

function getDate(value) {
	const date = value instanceof Date ? value : new Date(value);

	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid date: $ {value}`);
	}

	return date;
}

function getTradeKey(trade) {
	return [
	           String(trade.brokerAccountId || ""),
	           String(trade.exchange || ""),
	           String(trade.segment || ""),
	           String(trade.symbol || ""),
	           String(trade.productType || "")
	       ].join("|");
}

// ------------------------------
// 1. Brokerage and tax calculator
// ------------------------------

/*
brokerConfig structure:

{
  brokerage: {
    type: "PERCENTAGE" | "PER_ORDER",
    rate: 0.0003,
    maxPerOrder: 20,
    perOrder: 20
  },

  stt: {
    buyRate: 0,
    sellRate: 0.001,
    appliesTo: "SELL" | "BOTH"
  },

  exchange: {
    rate: 0.0000297
  },

  sebi: {
    ratePerCrore: 10
  },

  stampDuty: {
    buyRate: 0.00003
  },

  gst: {
    rate: 0.18
  },

  dp: {
    perSellTransaction: 15.93
  }
}

Rates are decimal rates.
Example: 0.18 means 18%.
SEBI ratePerCrore is rupees charged per crore of turnover.
*/

export function calculateCharges(trade, brokerConfig = {}) {
	const quantity = positiveNumber(trade.quantity, "quantity");
	const buyPrice = positiveNumber(trade.buyPrice, "buyPrice");
	const sellPrice = positiveNumber(trade.sellPrice, "sellPrice");

	const buyTurnover = getTradeValue(buyPrice, quantity);
	const sellTurnover = getTradeValue(sellPrice, quantity);
	const totalTurnover = buyTurnover + sellTurnover;

	const brokerageConfig = brokerConfig.brokerage || {};
	const sttConfig = brokerConfig.stt || {};
	const exchangeConfig = brokerConfig.exchange || {};
	const sebiConfig = brokerConfig.sebi || {};
	const stampConfig = brokerConfig.stampDuty || {};
	const gstConfig = brokerConfig.gst || {};
	const dpConfig = brokerConfig.dp || {};

	// Brokerage
	let brokerage = 0;

	if (brokerageConfig.type === "PER_ORDER") {
		const buyOrders = nonNegativeNumber(
		                      trade.buyOrderCount ?? 1,
		                      "buyOrderCount"
		                  );

		const sellOrders = nonNegativeNumber(
		                       trade.sellOrderCount ?? 1,
		                       "sellOrderCount"
		                   );

		const perOrder = nonNegativeNumber(
		                     brokerageConfig.perOrder ?? 0,
		                     "brokerage.perOrder"
		                 );

		brokerage = (buyOrders + sellOrders) * perOrder;
	} else {
		const brokerageRate = nonNegativeNumber(
		                          brokerageConfig.rate ?? 0,
		                          "brokerage.rate"
		                      );

		const maxPerOrder = brokerageConfig.maxPerOrder;

		const buyBrokerage = buyTurnover * brokerageRate;
		const sellBrokerage = sellTurnover * brokerageRate;

		const cappedBuy =
		    maxPerOrder == null
		    ? buyBrokerage
		    : Math.min(
		        buyBrokerage,
		        nonNegativeNumber(maxPerOrder, "brokerage.maxPerOrder")
		    );

		const cappedSell =
		    maxPerOrder == null
		    ? sellBrokerage
		    : Math.min(
		        sellBrokerage,
		        nonNegativeNumber(maxPerOrder, "brokerage.maxPerOrder")
		    );

		brokerage = cappedBuy + cappedSell;
	}

	// STT
	const sttBuyRate = nonNegativeNumber(
	                       sttConfig.buyRate ?? 0,
	                       "stt.buyRate"
	                   );

	const sttSellRate = nonNegativeNumber(
	                        sttConfig.sellRate ?? 0,
	                        "stt.sellRate"
	                    );

	const sttAppliesTo = String(
	                         sttConfig.appliesTo || "SELL"
	                     ).toUpperCase();

	let stt = 0;

	if (sttAppliesTo === "BOTH") {
		stt = buyTurnover * sttBuyRate + sellTurnover * sttSellRate;
	} else {
		stt = sellTurnover * sttSellRate;
	}

	// Exchange transaction charges
	const exchangeRate = nonNegativeNumber(
	                         exchangeConfig.rate ?? 0,
	                         "exchange.rate"
	                     );

	const exchangeCharges = totalTurnover * exchangeRate;

	// SEBI charges
	const sebiRatePerCrore = nonNegativeNumber(
	                             sebiConfig.ratePerCrore ?? 0,
	                             "sebi.ratePerCrore"
	                         );

	const sebiCharges = (totalTurnover / 10000000) * sebiRatePerCrore;

	// Stamp duty generally applies to buy-side turnover.
	const stampDutyRate = nonNegativeNumber(
	                          stampConfig.buyRate ?? 0,
	                          "stampDuty.buyRate"
	                      );

	const stampDuty = buyTurnover * stampDutyRate;

	// DP charges: only charge when a sell transaction is applicable.
	const dpPerSellTransaction = nonNegativeNumber(
	                                 dpConfig.perSellTransaction ?? 0,
	                                 "dp.perSellTransaction"
	                             );

	const dpCharges =
	    trade.isDelivery === true
	                         ? dpPerSellTransaction *
	                         nonNegativeNumber(trade.sellOrderCount ?? 1, "sellOrderCount")
	                         : 0;

	// GST is calculated on the configured GST-applicable charge components.
	const gstRate = nonNegativeNumber(gstConfig.rate ?? 0, "gst.rate");

	const gstApplicableCharges =
	    brokerage + exchangeCharges + sebiCharges;

	const gst = gstApplicableCharges * gstRate;

	const totalCharges =
	    brokerage +
	    stt +
	    exchangeCharges +
	    sebiCharges +
	    stampDuty +
	    dpCharges +
	    gst;

	return {
buyTurnover:
		roundMoney(buyTurnover),
sellTurnover:
		roundMoney(sellTurnover),
totalTurnover:
		roundMoney(totalTurnover),

brokerage:
		roundMoney(brokerage),
stt:
		roundMoney(stt),
gst:
		roundMoney(gst),
exchangeCharges:
		roundMoney(exchangeCharges),
sebiCharges:
		roundMoney(sebiCharges),
stampDuty:
		roundMoney(stampDuty),
dpCharges:
		roundMoney(dpCharges),

totalCharges:
		roundMoney(totalCharges)
	};
}

// ------------------------------
// 2. P&L and ROI calculator
// ------------------------------

/*
trade:
{
  buyPrice,
  sellPrice,
  quantity,
  investmentAmount?
}

charges: result from calculateCharges()
*/

export function calculatePnL(trade, charges = {}) {
	const quantity = positiveNumber(trade.quantity, "quantity");
	const buyPrice = positiveNumber(trade.buyPrice, "buyPrice");
	const sellPrice = positiveNumber(trade.sellPrice, "sellPrice");

	const buyValue = buyPrice * quantity;
	const sellValue = sellPrice * quantity;

	const grossPnL = sellValue - buyValue;
	const totalCharges = nonNegativeNumber(
	                         charges.totalCharges ?? 0,
	                         "charges.totalCharges"
	                     );

	const netPnL = grossPnL - totalCharges;

	const investmentAmount =
	    trade.investmentAmount == null
	    ? buyValue
	    : positiveNumber(trade.investmentAmount, "investmentAmount");

	const roi =
	    investmentAmount === 0
	                         ? 0
	                         : (netPnL / investmentAmount) * 100;

	return {
buyValue:
		roundMoney(buyValue),
sellValue:
		roundMoney(sellValue),
grossPnL:
		roundMoney(grossPnL),
totalCharges:
		roundMoney(totalCharges),
netPnL:
		roundMoney(netPnL),
roi:
		roundMoney(roi)
	};
}

// ------------------------------
// 3. Break-even and target price
// ------------------------------

/*
For a long position:
- buyPrice and quantity are known
- break-even selling price is estimated after charges
- targetProfit is the desired net profit amount

Uses binary search because charges may include percentage-based components
and per-order minimum/fixed charges.
*/

export function calculateBreakEven(trade, brokerConfig = {}) {
	const buyPrice = positiveNumber(trade.buyPrice, "buyPrice");
	const quantity = positiveNumber(trade.quantity, "quantity");

	const targetProfit = nonNegativeNumber(
	                         trade.targetProfit ?? 0,
	                         "targetProfit"
	                     );

	const maxSearchPrice =
	    trade.maxSearchPrice == null
	    ? buyPrice * 100
	    : positiveNumber(trade.maxSearchPrice, "maxSearchPrice");

	function netProfitAt(sellPrice) {
		const charges = calculateCharges(
		{
			...trade,
			buyPrice,
			sellPrice,
			quantity
		},
		brokerConfig
		);

		return (sellPrice - buyPrice) * quantity - charges.totalCharges;
	}

	function findPriceForProfit(requiredProfit) {
		let low = 0;
		let high = maxSearchPrice;

		if (netProfitAt(high) < requiredProfit) {
			throw new Error(
			    "Unable to find required selling price within maxSearchPrice"
			);
		}

		for (let i = 0; i < 100; i++) {
			const mid = (low + high) / 2;

			if (netProfitAt(mid) >= requiredProfit) {
				high = mid;
			} else {
				low = mid;
			}
		}

		return roundMoney(high);
	}

	const breakEvenPrice = findPriceForProfit(0);
	const targetSellingPrice = findPriceForProfit(targetProfit);

	return {
		breakEvenPrice,
targetProfit:
		roundMoney(targetProfit),
		targetSellingPrice
	};
}

// ------------------------------
// 4. Risk / Reward calculator
// ------------------------------

/*
For a long trade:
risk per unit = entry - stopLoss
reward per unit = target - entry

For a short trade:
risk per unit = stopLoss - entry
reward per unit = entry - target
*/

export function calculateRiskReward({
	entryPrice,
	stopLoss,
	targetPrice,
	quantity,
	capital,
	maxRiskPercent,
	direction = "LONG"
}) {
	entryPrice = positiveNumber(entryPrice, "entryPrice");
	stopLoss = positiveNumber(stopLoss, "stopLoss");
	targetPrice = positiveNumber(targetPrice, "targetPrice");

	const normalizedDirection = String(direction).toUpperCase();

	if (!["LONG", "SHORT"].includes(normalizedDirection)) {
		throw new Error("direction must be LONG or SHORT");
	}

	let riskPerUnit;
	let rewardPerUnit;

	if (normalizedDirection === "LONG") {
		riskPerUnit = entryPrice - stopLoss;
		rewardPerUnit = targetPrice - entryPrice;
	} else {
		riskPerUnit = stopLoss - entryPrice;
		rewardPerUnit = entryPrice - targetPrice;
	}

	if (riskPerUnit <= 0) {
		throw new Error("Stop-loss must be on the risk side of entry price");
	}

	if (rewardPerUnit <= 0) {
		throw new Error("Target price must be on the reward side of entry price");
	}

	const riskAmount =
	    quantity == null
	    ? null
	    : riskPerUnit * positiveNumber(quantity, "quantity");

	const rewardAmount =
	    quantity == null
	    ? null
	    : rewardPerUnit * positiveNumber(quantity, "quantity");

	const riskRewardRatio = rewardPerUnit / riskPerUnit;

	let maximumRiskAmount = null;
	let recommendedQuantity = null;

	if (capital != null && maxRiskPercent != null) {
		const capitalValue = positiveNumber(capital, "capital");
		const riskPercent = positiveNumber(maxRiskPercent, "maxRiskPercent");

		maximumRiskAmount = capitalValue * (riskPercent / 100);
		recommendedQuantity = Math.floor(maximumRiskAmount / riskPerUnit);
	}

	return {
direction:
		normalizedDirection,
riskPerUnit:
		roundMoney(riskPerUnit),
rewardPerUnit:
		roundMoney(rewardPerUnit),
riskAmount:
		riskAmount == null ? null : roundMoney(riskAmount),
		rewardAmount: rewardAmount == null ? null : roundMoney(rewardAmount),

		riskRewardRatio: roundQuantity(riskRewardRatio),
		ratioText: `1:${roundQuantity(riskRewardRatio)}`,

maximumRiskAmount:
		maximumRiskAmount == null
		? null
		: roundMoney(maximumRiskAmount),

		recommendedQuantity
	};
}

// ------------------------------
// 5. Position calculator (FIFO)
// ------------------------------

/*
Calculates positions by matching BUY and SELL executions in FIFO order.

Assumptions:
- Each trade is an executed fill, not merely an order request.
- Trades are for the same instrument/account/product when grouped together.
- Supports long and short positions.
- For exact broker parity, reconcile these results against broker positions.
*/

export function calculatePosition(trades = []) {
	if (!Array.isArray(trades)) {
		throw new Error("trades must be an array");
	}

	const sortedTrades = [...trades].sort(
	                         (a, b) => getDate(a.tradeTime) - getDate(b.tradeTime)
	                     );

	const positions = new Map();

	for (const trade of sortedTrades) {
		const key = getTradeKey(trade);

		if (!positions.has(key)) {
			positions.set(key, {
brokerAccountId: trade.brokerAccountId || null,
symbol: trade.symbol || null,
exchange: trade.exchange || null,
segment: trade.segment || null,
productType: trade.productType || null,

				netQuantity: 0,
				averagePrice: 0,
				realizedPnL: 0,
openLots: [],
				totalBuyQuantity: 0,
				totalSellQuantity: 0
			});
		}

		const position = positions.get(key);

		const side = normalizeSide(trade.transactionType);
		const quantity = positiveNumber(trade.quantity, "trade.quantity");
		const price = positiveNumber(trade.executedPrice, "trade.executedPrice");

		if (side === "BUY") {
			position.totalBuyQuantity += quantity;
		} else {
			position.totalSellQuantity += quantity;
		}

		let remainingQuantity = quantity;

		// BUY closes existing short lots first.
		// SELL closes existing long lots first.
		const closingSide = side === "BUY" ? "SHORT" : "LONG";

		while (
		    remainingQuantity > EPSILON &&
		    position.openLots.length > 0 &&
		    position.openLots[0].side === closingSide
		) {
			const lot = position.openLots[0];
			const matchedQuantity = Math.min(remainingQuantity, lot.remainingQuantity);

			if (lot.side === "LONG") {
				position.realizedPnL +=
				    (price - lot.price) * matchedQuantity;
			} else {
				position.realizedPnL +=
				    (lot.price - price) * matchedQuantity;
			}

			lot.remainingQuantity -= matchedQuantity;
			remainingQuantity -= matchedQuantity;

			if (lot.remainingQuantity <= EPSILON) {
				position.openLots.shift();
			}
		}

		// Any remaining quantity opens a new position in this trade's direction.
		if (remainingQuantity > EPSILON) {
			position.openLots.push({
side: side === "BUY" ? "LONG" : "SHORT",
				price,
				remainingQuantity,
				tradeId: trade.tradeId || null,
				tradeTime: trade.tradeTime || null
			});
		}

		// Net quantity is recalculated from remaining open lots.
		position.netQuantity = position.openLots.reduce((total, lot) => {
			return total + (lot.side === "LONG" ? lot.remainingQuantity : -lot.remainingQuantity);
		}, 0);

		const openQuantity = position.openLots.reduce(
		                         (total, lot) => total + lot.remainingQuantity,
		                         0
		                     );

		const weightedOpenValue = position.openLots.reduce(
		                              (total, lot) => total + lot.price * lot.remainingQuantity,
		                              0
		                          );

		position.averagePrice =
		    openQuantity > EPSILON ? weightedOpenValue / openQuantity : 0;
	}

	return [...positions.values()].map((position) => {
		const openQuantity = Math.abs(position.netQuantity);

		return {
			...position,
netQuantity:
			roundQuantity(position.netQuantity),
averagePrice:
			roundMoney(position.averagePrice),
realizedPnL:
			roundMoney(position.realizedPnL),
totalBuyQuantity:
			roundQuantity(position.totalBuyQuantity),
totalSellQuantity:
			roundQuantity(position.totalSellQuantity),
openQuantity:
			roundQuantity(openQuantity),
openLots:
			position.openLots.map((lot) => ({
				...lot,
remainingQuantity: roundQuantity(lot.remainingQuantity)
			}))
		};
	});
}

// ------------------------------
// 6. Dashboard statistics
// ------------------------------

/*
Calculates summary statistics from completed trade records.

Expected fields per item:
{
  tradeTime,
  netPnL,
  grossPnL,
  totalCharges,
  brokerAccountId,
  broker,
  symbol
}

Important:
Pass completed round-trip trades or trade-level P&L summaries here.
Do not pass individual BUY/SELL fills and expect this function to infer
realized P&L from them.
*/

export function calculateDashboardStats(trades = [], now = new Date()) {
	if (!Array.isArray(trades)) {
		throw new Error("trades must be an array");
	}

	const currentDate = getDate(now);

	const startOfDay = new Date(
	    currentDate.getFullYear(),
	    currentDate.getMonth(),
	    currentDate.getDate()
	);

	const startOfWeek = new Date(startOfDay);
	const dayOfWeek = (startOfWeek.getDay() + 6) % 7; // Monday = 0
	startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);

	const startOfMonth = new Date(
	    currentDate.getFullYear(),
	    currentDate.getMonth(),
	    1
	);

	const normalizedTrades = trades.map((trade) => ( {
		...trade,
_date:
		getDate(trade.tradeTime),
_netPnL:
		toNumber(trade.netPnL ?? 0, "netPnL"),
		_grossPnL:
		toNumber(trade.grossPnL ?? 0, "grossPnL"),
		_charges:
		nonNegativeNumber(trade.totalCharges ?? 0, "totalCharges")
	}));

	function summarize(items) {
		const totalTrades = items.length;

		const wins = items.filter((trade) => trade._netPnL > 0);
		const losses = items.filter((trade) => trade._netPnL < 0);
		const breakeven = items.filter((trade) => trade._netPnL === 0);

		const netPnL = items.reduce((sum, trade) => sum + trade._netPnL, 0);
		const grossPnL = items.reduce((sum, trade) => sum + trade._grossPnL, 0);
		const totalCharges = items.reduce((sum, trade) => sum + trade._charges, 0);

		const averageWin =
		    wins.length > 0
		    ? wins.reduce((sum, trade) => sum + trade._netPnL, 0) / wins.length
		    : 0;

		const averageLoss =
		    losses.length > 0
		    ? losses.reduce((sum, trade) => sum + trade._netPnL, 0) / losses.length
		    : 0;

		return {
			totalTrades,
winningTrades:
			wins.length,
losingTrades:
			losses.length,
breakevenTrades:
			breakeven.length,

winRate:
			totalTrades > 0
			? roundMoney((wins.length / totalTrades) * 100)
			: 0,

			grossPnL: roundMoney(grossPnL),
			totalCharges: roundMoney(totalCharges),
			netPnL: roundMoney(netPnL),

			averageWin: roundMoney(averageWin),
			averageLoss: roundMoney(averageLoss)
		};
	}

	const dailyTrades = normalizedTrades.filter(
	                        (trade) => trade._date >= startOfDay && trade._date <= currentDate
	                    );

	const weeklyTrades = normalizedTrades.filter(
	                         (trade) => trade._date >= startOfWeek && trade._date <= currentDate
	                     );

	const monthlyTrades = normalizedTrades.filter(
	                          (trade) => trade._date >= startOfMonth && trade._date <= currentDate
	                      );

	// Broker-wise summary
	const brokerGroups = new Map();

	for (const trade of normalizedTrades) {
		const brokerName =
		    trade.broker ||
		    trade.brokerName ||
		    String(trade.brokerAccountId || "UNKNOWN");

		if (!brokerGroups.has(brokerName)) {
			brokerGroups.set(brokerName, []);
		}

		brokerGroups.get(brokerName).push(trade);
	}

	const brokerWise = [...brokerGroups.entries()].map(
	([broker, brokerTrades]) => ( {
		broker,
		...summarize(brokerTrades)
	})
	                   );

	return {
daily:
		summarize(dailyTrades),
weekly:
		summarize(weeklyTrades),
monthly:
		summarize(monthlyTrades),
overall:
		summarize(normalizedTrades),
		brokerWise
	};
}