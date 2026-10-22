/**
 * PnLEngine.js
 * 
 * Financial calculation engine for live trading:
 * - Live Unrealized & Realized P&L
 * - Gross P&L
 * - Total Charges (Combined) including:
 *   1. Brokerage
 *   2. STT
 *   3. GST
 *   4. EXCHANGE CHARGES
 *   5. CTT
 *   6. SEBI CHARGES
 *   7. STAMP DUTY
 *   8. DP CHARGES
 * - Breakeven Price calculation
 * - Risk Amount according to Stop Loss
 * - Live Risk / Reward Ratios
 */

import brokerConfig from "../brokers/brokerConfig.js";

function round2(val) {
    return Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;
}

export class PnLEngine {
    constructor() {
        this.positions = new Map();     // userId -> Array of open positions from PositionEngine
        this.latestPrices = new Map();  // userId -> Map(symbol/instrumentToken -> ltp)
        this.riskSettings = new Map();  // userId -> Map(symbol -> { stopLoss, target })
    }

    /**
     * Store active open positions for a user.
     */
    setPositions(userId, positions) {
        if (!userId) return;
        this.positions.set(String(userId), Array.isArray(positions) ? positions : []);
    }

    /**
     * Update/override user's Stop Loss and Target for a specific symbol.
     */
    updateRiskSettings(userId, symbol, { stopLoss, target }) {
        if (!userId || !symbol) return;
        const uId = String(userId);
        if (!this.riskSettings.has(uId)) {
            this.riskSettings.set(uId, new Map());
        }
        const userSettings = this.riskSettings.get(uId);
        const existing = userSettings.get(symbol) || {};

        userSettings.set(symbol, {
            stopLoss: stopLoss !== undefined ? Number(stopLoss) : existing.stopLoss,
            target: target !== undefined ? Number(target) : existing.target
        });
    }

    /**
     * Updates LTP for an instrument and re-calculates all live metrics for the user.
     */
    updatePrice(userId, instrumentKey, ltp) {
        if (!userId) return null;
        const uId = String(userId);
        if (!this.latestPrices.has(uId)) {
            this.latestPrices.set(uId, new Map());
        }

        const price = Number(ltp);
        if (Number.isFinite(price) && price > 0) {
            this.latestPrices.get(uId).set(instrumentKey, price);
        }

        return this.calculate(uId);
    }

    /**
     * Calculates the 8 statutory & broker charges for a position leg / round-trip:
     * 1. Brokerage
     * 2. STT
     * 3. GST
     * 4. Exchange Charges
     * 5. CTT
     * 6. SEBI Charges
     * 7. Stamp Duty
     * 8. DP Charges
     */
    calculateChargesForPosition({
        symbol,
        exchange = "NSE",
        segment = "EQUITY",
        productType = "INTRADAY",
        quantity,
        entryPrice,
        exitPrice,
        broker = "UPSTOX"
    }) {
        const qty = Math.abs(Number(quantity) || 0);
        const buyPrice = Number(entryPrice) || 0;
        const sellPrice = Number(exitPrice) || buyPrice;

        const buyTurnover = buyPrice * qty;
        const sellTurnover = sellPrice * qty;
        const totalTurnover = buyTurnover + sellTurnover;

        const isDelivery = String(productType).toUpperCase().includes("DELIV") ||
                           String(productType).toUpperCase() === "CNC";
        const isOptions = String(segment).toUpperCase().includes("OPT");
        const isFutures = String(segment).toUpperCase().includes("FUT");
        const isCommodity = String(segment).toUpperCase().includes("COMM") ||
                            String(segment).toUpperCase().includes("MCX");

        // 1. BROKERAGE (Upstox: ₹20 or 0.05% whichever is lower for intraday/fno; flat ₹20 for delivery/options)
        let buyBrokerage = 0;
        let sellBrokerage = 0;

        if (isOptions) {
            buyBrokerage = 20;
            sellBrokerage = 20;
        } else if (isDelivery) {
            buyBrokerage = Math.min(20, buyTurnover * 0.025);
            sellBrokerage = Math.min(20, sellTurnover * 0.025);
        } else {
            // Intraday & Futures
            buyBrokerage = Math.min(20, buyTurnover * 0.0005);
            sellBrokerage = Math.min(20, sellTurnover * 0.0005);
        }
        const brokerage = buyBrokerage + sellBrokerage;

        // 2. STT (Securities Transaction Tax)
        let stt = 0;
        if (isDelivery) {
            stt = (buyTurnover * 0.001) + (sellTurnover * 0.001); // 0.1% both sides
        } else if (isOptions) {
            stt = sellTurnover * 0.00125; // 0.125% on sell premium
        } else if (isFutures) {
            stt = sellTurnover * 0.0002; // 0.02% on sell turnover
        } else {
            // Intraday equity: 0.025% on sell side
            stt = sellTurnover * 0.00025;
        }

        // 3. EXCHANGE TRANSACTION CHARGES
        let exchangeRate = 0.000030699; // NSE Equity ~ 0.0030699%
        if (isOptions) exchangeRate = 0.000355299;
        else if (isFutures) exchangeRate = 0.000018299;
        const exchangeCharges = totalTurnover * exchangeRate;

        // 4. CTT (Commodities Transaction Tax)
        let ctt = 0;
        if (isCommodity) {
            ctt = isOptions ? sellTurnover * 0.0005 : sellTurnover * 0.0001;
        }

        // 5. SEBI CHARGES (₹10 per crore = 0.0001% of total turnover)
        const sebiCharges = (totalTurnover / 10000000) * 10;

        // 6. STAMP DUTY (Charged on BUY turnover)
        let stampDutyRate = 0.00003; // Intraday: 0.003%
        if (isDelivery) stampDutyRate = 0.00015; // Delivery: 0.015%
        else if (isFutures) stampDutyRate = 0.00002; // Futures: 0.002%
        else if (isOptions) stampDutyRate = 0.00003; // Options: 0.003%
        const stampDuty = buyTurnover * stampDutyRate;

        // 7. DP CHARGES (Depository Participant fee on delivery sell transactions)
        const dpCharges = isDelivery ? 20.00 : 0.00;

        // 8. GST (18% on Brokerage + Exchange Charges + SEBI Charges)
        const gstBase = brokerage + exchangeCharges + sebiCharges;
        const gst = gstBase * 0.18;

        // COMBINED TOTAL CHARGES
        const total = brokerage + stt + gst + exchangeCharges + ctt + sebiCharges + stampDuty + dpCharges;

        return {
            brokerage: round2(brokerage),
            stt: round2(stt),
            gst: round2(gst),
            exchangeCharges: round2(exchangeCharges),
            ctt: round2(ctt),
            sebiCharges: round2(sebiCharges),
            stampDuty: round2(stampDuty),
            dpCharges: round2(dpCharges),
            total: round2(total)
        };
    }

    /**
     * Calculates all 8 statutory & broker charges for an individual trade execution fill (Buy or Sell).
     */
    calculateTradeFillCharges({
        symbol,
        exchange = "NSE",
        segment = "EQUITY",
        productType = "INTRADAY",
        transactionType = "BUY",
        quantity,
        price,
        broker = "UPSTOX"
    }) {
        const qty = Math.abs(Number(quantity) || 0);
        const execPrice = Number(price) || 0;
        const turnover = qty * execPrice;
        const side = String(transactionType).toUpperCase();
        const isBuy = side === "BUY";

        const isDelivery = String(productType).toUpperCase().includes("DELIV") ||
                           String(productType).toUpperCase() === "CNC";
        const isOptions = String(segment).toUpperCase().includes("OPT");
        const isFutures = String(segment).toUpperCase().includes("FUT");
        const isCommodity = String(segment).toUpperCase().includes("COMM") ||
                            String(segment).toUpperCase().includes("MCX");

        // 1. Brokerage
        let brokerage = 0;
        if (isOptions) {
            brokerage = 20;
        } else if (isDelivery) {
            brokerage = Math.min(20, turnover * 0.025);
        } else {
            brokerage = Math.min(20, turnover * 0.0005);
        }

        // 2. STT (Securities Transaction Tax)
        let stt = 0;
        if (isDelivery) {
            stt = turnover * 0.001; // 0.1% on delivery buy & sell
        } else if (!isBuy) {
            if (isOptions) {
                stt = turnover * 0.00125; // 0.125% on sell premium
            } else if (isFutures) {
                stt = turnover * 0.0002; // 0.02% on sell turnover
            } else {
                stt = turnover * 0.00025; // 0.025% on intraday sell turnover
            }
        }

        // 3. Exchange Transaction Charges
        let exchangeRate = 0.000030699;
        if (isOptions) exchangeRate = 0.000355299;
        else if (isFutures) exchangeRate = 0.000018299;
        const exchangeCharges = turnover * exchangeRate;

        // 4. CTT (Commodities Transaction Tax)
        let ctt = 0;
        if (isCommodity && !isBuy) {
            ctt = isOptions ? turnover * 0.0005 : turnover * 0.0001;
        }

        // 5. SEBI Charges (₹10 per crore)
        const sebiCharges = (turnover / 10000000) * 10;

        // 6. Stamp Duty (Charged on BUY turnover)
        let stampDuty = 0;
        if (isBuy) {
            let stampRate = 0.00003;
            if (isDelivery) stampRate = 0.00015;
            else if (isFutures) stampRate = 0.00002;
            else if (isOptions) stampRate = 0.00003;
            stampDuty = turnover * stampRate;
        }

        // 7. DP Charges (₹20 on delivery sell)
        const dpCharges = (!isBuy && isDelivery) ? 20.00 : 0.00;

        // 8. GST (18% on Brokerage + Exchange Charges + SEBI Charges)
        const gstBase = brokerage + exchangeCharges + sebiCharges;
        const gst = gstBase * 0.18;

        const total = brokerage + stt + gst + exchangeCharges + ctt + sebiCharges + stampDuty + dpCharges;

        return {
            turnover: round2(turnover),
            brokerage: round2(brokerage),
            stt: round2(stt),
            gst: round2(gst),
            exchangeCharges: round2(exchangeCharges),
            ctt: round2(ctt),
            sebiCharges: round2(sebiCharges),
            stampDuty: round2(stampDuty),
            dpCharges: round2(dpCharges),
            total: round2(total)
        };
    }

    /**
     * Calculates Breakeven selling price taking all round-trip statutory & broker charges into account.
     */
    calculateBreakevenPrice({
        side,
        averagePrice,
        quantity,
        symbol,
        exchange,
        segment,
        productType
    }) {
        const avgPrice = Number(averagePrice) || 0;
        const qty = Math.abs(Number(quantity) || 0);
        if (avgPrice <= 0 || qty <= 0) return { breakevenPrice: avgPrice, chargesPerUnit: 0 };

        // Initial estimate of charges
        const initialCharges = this.calculateChargesForPosition({
            symbol,
            exchange,
            segment,
            productType,
            quantity: qty,
            entryPrice: avgPrice,
            exitPrice: avgPrice
        });

        // Iterative refinement for exact breakeven
        let bePrice = avgPrice;
        for (let i = 0; i < 3; i++) {
            const estCharges = this.calculateChargesForPosition({
                symbol,
                exchange,
                segment,
                productType,
                quantity: qty,
                entryPrice: avgPrice,
                exitPrice: bePrice
            });
            const chargesPerUnit = estCharges.total / qty;
            if (side === "BUY" || side === "LONG") {
                bePrice = avgPrice + chargesPerUnit;
            } else {
                bePrice = Math.max(0.01, avgPrice - chargesPerUnit);
            }
        }

        return {
            breakevenPrice: round2(bePrice),
            chargesPerUnit: round2(Math.abs(bePrice - avgPrice))
        };
    }

    /**
     * Main calculation function:
     * Computes Live P&L, Gross P&L, Net P&L, Breakeven, Combined Charges, Stop Loss Risk Amount, and Live R:R
     */
    calculate(userId) {
        const uId = String(userId);
        const positions = this.positions.get(uId) || [];
        const prices = this.latestPrices.get(uId) || new Map();
        const userRiskSettings = this.riskSettings.get(uId) || new Map();

        let totalGrossPnL = 0;
        let totalUnrealizedPnL = 0;
        let totalRealizedPnL = 0;
        let totalNetPnL = 0;
        let totalRiskAmount = 0;

        const combinedPortfolioCharges = {
            brokerage: 0,
            stt: 0,
            gst: 0,
            exchangeCharges: 0,
            ctt: 0,
            sebiCharges: 0,
            stampDuty: 0,
            dpCharges: 0,
            total: 0
        };

        const calculatedPositions = positions.map(pos => {
            const symbol = pos.symbol || "UNKNOWN";
            const instrumentKey = pos.instrumentToken || symbol;

            // Resolve LTP: from latest prices Map -> last broker price -> avg price
            const ltp = prices.get(instrumentKey) ??
                        prices.get(symbol) ??
                        pos.lastBrokerPrice ??
                        pos.averagePrice ?? 0;

            const quantity = Number(pos.openQuantity || Math.abs(pos.netQuantity) || 0);
            const averagePrice = Number(pos.averagePrice || 0);
            const side = pos.side === "SELL" || pos.netQuantity < 0 ? "SELL" : "BUY";
            const isLong = side === "BUY";

            // Gross Unrealized P&L
            let unrealizedGrossPnL = 0;
            if (isLong) {
                unrealizedGrossPnL = (ltp - averagePrice) * quantity;
            } else {
                unrealizedGrossPnL = (averagePrice - ltp) * quantity;
            }
            unrealizedGrossPnL = round2(unrealizedGrossPnL);

            // Gross Realized P&L from squared lots
            const realizedGrossPnL = round2(Number(pos.realizedPnL || 0));

            // Gross P&L (Total)
            const grossPnL = round2(unrealizedGrossPnL + realizedGrossPnL);

            // Charges (all 8 combined)
            const charges = this.calculateChargesForPosition({
                symbol,
                exchange: pos.exchange,
                segment: pos.segment,
                productType: pos.productType,
                quantity,
                entryPrice: averagePrice,
                exitPrice: ltp
            });

            // Net P&L = Gross P&L - Total Charges
            const netPnL = round2(grossPnL - charges.total);

            // Breakeven Price
            const { breakevenPrice } = this.calculateBreakevenPrice({
                side,
                averagePrice,
                quantity,
                symbol,
                exchange: pos.exchange,
                segment: pos.segment,
                productType: pos.productType
            });

            const distanceToBreakeven = isLong
                ? round2(ltp - breakevenPrice)
                : round2(breakevenPrice - ltp);

            const distanceToBreakevenPct = breakevenPrice > 0
                ? round2((distanceToBreakeven / breakevenPrice) * 100)
                : 0;

            // Stop Loss & Target Settings
            const savedRisk = userRiskSettings.get(symbol) || {};

            // Default Stop Loss (1.5% from entry if not specified)
            const defaultStopLoss = isLong
                ? round2(averagePrice * 0.985)
                : round2(averagePrice * 1.015);
            const stopLoss = Number(savedRisk.stopLoss ?? pos.stopLoss ?? defaultStopLoss);

            // Default Target (3.0% from entry for a 1:2 R:R if not specified)
            const defaultTarget = isLong
                ? round2(averagePrice * 1.03)
                : round2(averagePrice * 0.97);
            const target = Number(savedRisk.target ?? pos.target ?? defaultTarget);

            // Risk Amount (According to Stop Loss)
            let riskPerUnit = 0;
            if (isLong) {
                riskPerUnit = Math.max(0.01, averagePrice - stopLoss);
            } else {
                riskPerUnit = Math.max(0.01, stopLoss - averagePrice);
            }
            const riskAmount = round2(quantity * riskPerUnit);

            // Reward Amount
            let rewardPerUnit = 0;
            if (isLong) {
                rewardPerUnit = Math.max(0.01, target - averagePrice);
            } else {
                rewardPerUnit = Math.max(0.01, averagePrice - target);
            }
            const rewardAmount = round2(quantity * rewardPerUnit);

            // Initial Risk / Reward Ratio
            const initialRiskRewardRatio = riskPerUnit > 0
                ? round2(rewardPerUnit / riskPerUnit)
                : 1;

            // Live Dynamic Risk / Reward Ratio (as LTP changes)
            let liveRiskDistance = 0;
            let liveRewardDistance = 0;
            let liveRiskRewardRatio = initialRiskRewardRatio;
            let liveStatus = "IN_PROGRESS";

            if (isLong) {
                liveRiskDistance = ltp - stopLoss;
                liveRewardDistance = target - ltp;
                if (ltp <= stopLoss) {
                    liveStatus = "SL_TRIGGERED";
                    liveRiskRewardRatio = 0;
                } else if (ltp >= target) {
                    liveStatus = "TARGET_REACHED";
                    liveRiskRewardRatio = round2(rewardPerUnit / riskPerUnit);
                } else {
                    liveRiskRewardRatio = liveRiskDistance > 0
                        ? round2(liveRewardDistance / liveRiskDistance)
                        : 0;
                }
            } else {
                liveRiskDistance = stopLoss - ltp;
                liveRewardDistance = ltp - target;
                if (ltp >= stopLoss) {
                    liveStatus = "SL_TRIGGERED";
                    liveRiskRewardRatio = 0;
                } else if (ltp <= target) {
                    liveStatus = "TARGET_REACHED";
                    liveRiskRewardRatio = round2(rewardPerUnit / riskPerUnit);
                } else {
                    liveRiskRewardRatio = liveRiskDistance > 0
                        ? round2(liveRewardDistance / liveRiskDistance)
                        : 0;
                }
            }

            // Accumulate portfolio aggregates
            totalGrossPnL += grossPnL;
            totalUnrealizedPnL += unrealizedGrossPnL;
            totalRealizedPnL += realizedGrossPnL;
            totalNetPnL += netPnL;
            totalRiskAmount += riskAmount;

            combinedPortfolioCharges.brokerage += charges.brokerage;
            combinedPortfolioCharges.stt += charges.stt;
            combinedPortfolioCharges.gst += charges.gst;
            combinedPortfolioCharges.exchangeCharges += charges.exchangeCharges;
            combinedPortfolioCharges.ctt += charges.ctt;
            combinedPortfolioCharges.sebiCharges += charges.sebiCharges;
            combinedPortfolioCharges.stampDuty += charges.stampDuty;
            combinedPortfolioCharges.dpCharges += charges.dpCharges;
            combinedPortfolioCharges.total += charges.total;

            return {
                id: pos.key || `${symbol}_${pos.productType}`,
                symbol,
                exchange: pos.exchange || "NSE",
                segment: pos.segment || "EQUITY",
                productType: pos.productType || "INTRADAY",
                instrumentToken: instrumentKey,
                side,
                status: pos.status || "OPEN", // "OPEN" or "PARTIALLY_SQUARED"
                openQuantity: quantity,
                netQuantity: pos.netQuantity || quantity,
                averagePrice,
                ltp: round2(ltp),
                previousLtp: prices.get(`${instrumentKey}_prev`) ?? ltp,
                unrealizedGrossPnL,
                realizedGrossPnL,
                grossPnL,
                netPnL,
                pnlPercentage: averagePrice > 0
                    ? round2((unrealizedGrossPnL / (averagePrice * quantity)) * 100)
                    : 0,
                // Breakeven metrics
                breakevenPrice,
                distanceToBreakeven,
                distanceToBreakevenPct,
                isAboveBreakeven: distanceToBreakeven >= 0,
                // Charges breakdown & combined total
                charges: {
                    ...charges,
                    chargesPerUnit: round2(charges.total / (quantity || 1))
                },
                // Risk / Reward metrics
                stopLoss,
                target,
                riskPerUnit: round2(riskPerUnit),
                rewardPerUnit: round2(rewardPerUnit),
                riskAmount,
                rewardAmount,
                initialRiskRewardRatio,
                initialRiskRewardText: `1:${initialRiskRewardRatio}`,
                liveRiskRewardRatio,
                liveRiskRewardText: `1:${liveRiskRewardRatio}`,
                liveStatus,
                // Position Engine detailed lots
                openLots: pos.openLots || [],
                squaredLots: pos.squaredLots || []
            };
        });

        // Round portfolio charges
        for (const k of Object.keys(combinedPortfolioCharges)) {
            combinedPortfolioCharges[k] = round2(combinedPortfolioCharges[k]);
        }

        const avgRR = calculatedPositions.length > 0
            ? round2(calculatedPositions.reduce((s, p) => s + p.liveRiskRewardRatio, 0) / calculatedPositions.length)
            : 0;

        return {
            userId: uId,
            positions: calculatedPositions,
            portfolioSummary: {
                totalGrossPnL: round2(totalGrossPnL),
                totalUnrealizedPnL: round2(totalUnrealizedPnL),
                totalRealizedPnL: round2(totalRealizedPnL),
                totalNetPnL: round2(totalNetPnL),
                totalRiskAmount: round2(totalRiskAmount),
                portfolioRiskReward: avgRR,
                portfolioRiskRewardText: `1:${avgRR}`,
                totalCharges: combinedPortfolioCharges,
                openPositionsCount: calculatedPositions.length
            },
            timestamp: Date.now()
        };
    }
}

export default new PnLEngine();