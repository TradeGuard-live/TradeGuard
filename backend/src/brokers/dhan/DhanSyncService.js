import DhanAdapter from "./DhanAdapter.js";
import { mapDhanTrade } from "./DhanMapper.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";
import CopyConfig from "../../models/CopyConfig.js";
import { masterOrderEventStream } from "../../services/copyTrading/engine/MasterOrderEventStream.js";
import { decrypt } from "../../utils/encryption.js";

/**
 * Sync Dhan trades (historical or today) into TradeGuard's TradeRecord collection.
 */
const syncDhanHistoricalTrades = async ({
    brokerAccountId,
    startDate,
    endDate,
    isTodaySync = false
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

    let trades = [];

    if (isTodaySync) {
        // Real-time / today sync: Query today's active trade book directly
        try {
            trades = await dhan.getTrades();
        } catch (tErr) {
            const isTodayAuth = tErr.status === 401 || tErr.status === 403 || /401|403|token|unauthorized|expired|invalid/i.test(tErr.message);
            if (isTodayAuth) {
                brokerAccount.isConnected = false;
                brokerAccount.verificationError = tErr.message;
                await brokerAccount.save().catch(() => {});
            }
            throw tErr;
        }
    } else {
        const now = new Date();
        const curFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const defaultStart = `${curFY - 1}-04-01`;
        const defaultEnd = now.toISOString().split("T")[0];

        const start = startDate || defaultStart;
        const end = endDate || defaultEnd;

        console.log(`[Dhan Sync] Fetching trades for account ${brokerAccountId} (${start} - ${end})`);

        // Fetch historical trades using the financial year / specified date range
        try {
            trades = await dhan.getAllHistoricalTrades({ startDate: start, endDate: end });
        } catch (histError) {
            const isAuthError = histError.status === 401 || histError.status === 403 || /401|403|token|unauthorized|expired|invalid/i.test(histError.message);
            if (isAuthError) {
                brokerAccount.isConnected = false;
                brokerAccount.verificationError = histError.message;
                await brokerAccount.save().catch(() => {});
                throw histError;
            }
            console.warn("[Dhan Sync] Historical trades error, attempting today trades fallback:", histError.message);
            try {
                trades = await dhan.getTrades();
            } catch (todayErr) {
                const isTodayAuth = todayErr.status === 401 || todayErr.status === 403 || /401|403|token|unauthorized|expired|invalid/i.test(todayErr.message);
                if (isTodayAuth) {
                    brokerAccount.isConnected = false;
                    brokerAccount.verificationError = todayErr.message;
                    await brokerAccount.save().catch(() => {});
                }
                throw todayErr;
            }
        }

        // Also fetch today's trade book to ensure executions from the current session are captured
        try {
            const todayTrades = await dhan.getTrades();
            if (Array.isArray(todayTrades) && todayTrades.length > 0) {
                trades.push(...todayTrades);
            }
        } catch (tErr) {
            const isTodayAuth = tErr.status === 401 || tErr.status === 403 || /401|403|token|unauthorized|expired|invalid/i.test(tErr.message);
            if (isTodayAuth) {
                brokerAccount.isConnected = false;
                brokerAccount.verificationError = tErr.message;
                await brokerAccount.save().catch(() => {});
                throw tErr;
            }
        }
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

    if (!isTodaySync && deduplicatedTrades.length > 0) {
        console.log(`[Dhan Sync] Processing ${deduplicatedTrades.length} trades for Dhan account ${brokerAccountId}`);
    }

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

            const existing = await TradeRecord.findOne({
                brokerAccountId: brokerAccount._id,
                tradeId: mappedTrade.tradeId
            }).lean();

            if (!existing) {
                await TradeRecord.create({
                    ...mappedTrade,
                    brokerAccountId: brokerAccount._id,
                    userId: brokerAccount.userId
                });
                inserted++;
            } else {
                const hasChanged =
                    Number(existing.quantity) !== Number(mappedTrade.quantity) ||
                    Number(existing.executedPrice) !== Number(mappedTrade.executedPrice) ||
                    String(existing.status || "") !== String(mappedTrade.status || "");

                if (hasChanged) {
                    await TradeRecord.updateOne(
                        { _id: existing._id },
                        { $set: mappedTrade }
                    );
                    updated++;
                } else {
                    skipped++;
                }
            }

            // If this Dhan account is a master account in an active copy config, forward to copy trading engine
            try {
                const isMaster = await CopyConfig.exists({
                    userId: brokerAccount.userId,
                    masterAccountId: brokerAccount._id,
                    isEnabled: true,
                    emergencyStop: false
                });
                if (isMaster) {
                    await masterOrderEventStream.notifyNewMasterTrade({
                        userId: brokerAccount.userId,
                        brokerAccountId: brokerAccount._id,
                        trade: mappedTrade
                    });
                }
            } catch (notifyErr) {
                console.warn("[Dhan Sync] Failed to notify master trade to copy trading engine:", notifyErr.message);
            }
        } catch (itemError) {
            console.warn("[Dhan Sync] Error processing trade item:", itemError.message);
            skipped++;
        }
    }

    // Update last sync on broker account if changes were made or in historical mode
    if (!isTodaySync || inserted > 0 || updated > 0) {
        brokerAccount.lastSync = new Date();
        await brokerAccount.save().catch(() => {});
        console.log(`[Dhan Sync] Completed: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
    }

    return {
        inserted,
        updated,
        skipped,
        total: deduplicatedTrades.length
    };
};

const syncDhanTodayTrades = async ({ brokerAccountId }) => {
    return syncDhanHistoricalTrades({ brokerAccountId, isTodaySync: true });
};

export {
    syncDhanHistoricalTrades,
    syncDhanTodayTrades
};
