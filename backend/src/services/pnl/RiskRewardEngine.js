/**
 * RiskRewardEngine.js
 * 
 * Standalone risk/reward calculator module (ES Modules).
 */

export class RiskRewardEngine {
    calculate({
        side = "BUY",
        entryPrice,
        stopLoss,
        target,
        ltp,
        quantity = 1
    }) {
        const entry = Number(entryPrice);
        const sl = Number(stopLoss);
        const tgt = Number(target);
        const currentPrice = Number(ltp ?? entryPrice);
        const qty = Math.abs(Number(quantity) || 1);

        if (!entry || !sl || !tgt) {
            return null;
        }

        const isLong = side === "BUY" || side === "LONG";
        let riskPerUnit = 0;
        let rewardPerUnit = 0;

        if (isLong) {
            riskPerUnit = entry - sl;
            rewardPerUnit = tgt - entry;
        } else {
            riskPerUnit = sl - entry;
            rewardPerUnit = entry - tgt;
        }

        if (riskPerUnit <= 0) riskPerUnit = 0.01;
        if (rewardPerUnit <= 0) rewardPerUnit = 0.01;

        const initialRR = Math.round((rewardPerUnit / riskPerUnit + Number.EPSILON) * 100) / 100;
        const riskAmount = Math.round((riskPerUnit * qty + Number.EPSILON) * 100) / 100;
        const rewardAmount = Math.round((rewardPerUnit * qty + Number.EPSILON) * 100) / 100;

        let distanceToStopLoss = isLong ? currentPrice - sl : sl - currentPrice;
        let distanceToTarget = isLong ? tgt - currentPrice : currentPrice - tgt;

        return {
            entryPrice: entry,
            stopLoss: sl,
            target: tgt,
            ltp: currentPrice,
            quantity: qty,
            initialRisk: Math.round((riskPerUnit + Number.EPSILON) * 100) / 100,
            initialReward: Math.round((rewardPerUnit + Number.EPSILON) * 100) / 100,
            riskAmount,
            rewardAmount,
            initialRiskReward: initialRR,
            ratioText: `1:${initialRR}`,
            distanceToStopLoss: Math.round((distanceToStopLoss + Number.EPSILON) * 100) / 100,
            distanceToTarget: Math.round((distanceToTarget + Number.EPSILON) * 100) / 100
        };
    }
}

export default new RiskRewardEngine();