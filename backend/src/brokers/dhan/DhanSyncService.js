import DhanAdapter from "./DhanAdapter.js";
import { mapDhanTrade } from "./DhanMapper.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";
import { decrypt } from "../../utils/encryption.js";

/**
 * Sync Dhan trades (historical or today) into TradeGuard's TradeRecord collection.
 */
const syncDhanHistoricalTrades = async ({
    brokerAccountId,
    startDate,
    endDate
}) => {
    if (!brokerAccountId) {
        throw new Error("brokerAccountId is required");
    }

    const brokerAccount = await BrokerAccount.findById(brokerAccountId);
    if (!brokerAccount) {
        throw new Error("Broker account not found");
    }

    if (brokerAccount.broker !== "DHAN") {
        throw new Error("Broker account is not a Dhan account");
    }

    if (!brokerAccount.isActive) {
        throw new Error("Dhan broker account is inactive");
    }

    if (!brokerAccount.credentials?.accessToken) {
        throw new Error("Dhan access token not found");
    }

    let accessToken = null;
    try {
        accessToken = decrypt(brokerAccount.credentials.accessToken);
    } catch {
        accessToken = brokerAccount.credentials.accessToken;
    }

    if (!accessToken) {
        throw new Error("Failed to decrypt Dhan access token");
    }

    const clientId = brokerAccount.credentials.clientId;
    if (!clientId) {
        throw new Error("Dhan client ID is required");
    }

    const dhan = new DhanAdapter({
        clientId,
        accessToken
    });

    const now = new Date();
    const curFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const defaultStart = `${curFY - 1}-04-01`;
    const defaultEnd = now.toISOString().split("T")[0];

    const start = startDate || defaultStart;
    const end = endDate || defaultEnd;

    console.log(`[Dhan Sync] Fetching trades for account ${brokerAccountId} (${start} - ${end})`);

    let trades = [];

    // Fetch historical trades using the financial year / specified date range
    try {
        trades = await dhan.getAllHistoricalTrades({ startDate: start, endDate: end });
    } catch (histError) {
        console.warn("[Dhan Sync] Historical trades error, attempting today trades fallback:", histError.message);
        trades = await dhan.getTrades();
    }

    // Also fetch today's trade book to ensure executions from the current session are captured
    try {
        const todayTrades = await dhan.getTrades();
        if (Array.isArray(todayTrades) && todayTrades.length > 0) {
            trades.push(...todayTrades);
        }
    } catch (tErr) {
        // Today trades fetch optional if already retrieved
    }

    if (!Array.isArray(trades)) {
        trades = [];
    }

    // Deduplicate by trade identifier, avoiding false matches on exchangeTradeId: "0"
    const uniqueMap = new Map();
    for (const t of trades) {
        const rawId = (t.exchangeTradeId && t.exchangeTradeId !== "0" && t.exchangeTradeId !== 0)
            ? String(t.exchangeTradeId)
            : (t.tradeId || (t.orderId ? `TRD-${t.orderId}` : null));
        if (rawId) {
            uniqueMap.set(String(rawId), t);
        } else {
            uniqueMap.set(`TMP-${Date.now()}-${Math.random()}`, t);
        }
    }
    const deduplicatedTrades = Array.from(uniqueMap.values());

    console.log(`[Dhan Sync] Processing ${deduplicatedTrades.length} trades for Dhan account ${brokerAccountId}`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const rawTrade of deduplicatedTrades) {
        try {
            const mappedTrade = mapDhanTrade(rawTrade);
            mappedTrade.userId = brokerAccount.userId;
            mappedTrade.brokerAccountId = brokerAccount._id;
            mappedTrade.broker = "DHAN";

            if (!mappedTrade.tradeId) {
                skipped++;
                continue;
            }

            const result = await TradeRecord.updateOne(
                {
                    brokerAccountId: brokerAccount._id,
                    tradeId: mappedTrade.tradeId
                },
                {
                    $set: mappedTrade
                },
                {
                    upsert: true
                }
            );

            if (result.upsertedCount === 1) {
                inserted++;
            } else if (result.modifiedCount === 1) {
                updated++;
            } else {
                skipped++;
            }
        } catch (itemError) {
            console.warn("[Dhan Sync] Error processing trade item:", itemError.message);
            skipped++;
        }
    }

    // Update last sync on broker account
    brokerAccount.lastSync = new Date();
    await brokerAccount.save();

    console.log(`[Dhan Sync] Completed: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);

    return {
        inserted,
        updated,
        skipped,
        total: deduplicatedTrades.length
    };
};

const syncDhanTodayTrades = async ({ brokerAccountId }) => {
    return syncDhanHistoricalTrades({ brokerAccountId });
};

export {
    syncDhanHistoricalTrades,
    syncDhanTodayTrades
};
