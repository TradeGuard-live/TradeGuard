import AngelOneAdapter from "./AngelOneAdapter.js";
import { mapAngelOneTrade } from "./AngelOneMapper.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";
import { decrypt, encrypt } from "../../utils/encryption.js";

/**
 * Helper to safely decrypt a credential field or return it as-is if unencrypted.
 */
const safeDecrypt = (field) => {
    if (!field) return "";
    try {
        const d = decrypt(field);
        return d || field;
    } catch {
        return field;
    }
};

/**
 * Instantiates an AngelOneAdapter from a BrokerAccount document,
 * refreshing or logging in automatically if credentials allow.
 */
export const getAngelOneAdapterForAccount = async (brokerAccount) => {
    const apiKey = safeDecrypt(brokerAccount.credentials?.apiKey);
    const clientCode = brokerAccount.credentials?.clientId || "";
    const accessToken = safeDecrypt(brokerAccount.credentials?.accessToken);
    const refreshToken = safeDecrypt(brokerAccount.credentials?.refreshToken);
    const feedToken = safeDecrypt(brokerAccount.credentials?.feedToken);
    const password = safeDecrypt(brokerAccount.credentials?.password || brokerAccount.credentials?.apiSecret);
    const totpSecret = safeDecrypt(brokerAccount.credentials?.totpSecret);

    const adapter = new AngelOneAdapter({
        apiKey,
        clientCode,
        password,
        totpSecret,
        accessToken,
        refreshToken,
        feedToken
    });

    // If we have no accessToken, or token is expired, and we have login credentials, login now
    if ((!accessToken || accessToken.length < 10) && clientCode && password && (totpSecret || apiKey)) {
        try {
            console.log(`[AngelOneSync] Generating initial session for ${clientCode}...`);
            const session = await adapter.login();
            if (session?.jwtToken) {
                brokerAccount.credentials.accessToken = encrypt(adapter.jwtToken);
                if (adapter.refreshToken) brokerAccount.credentials.refreshToken = encrypt(adapter.refreshToken);
                if (adapter.feedToken) brokerAccount.credentials.feedToken = encrypt(adapter.feedToken);
                brokerAccount.isConnected = true;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
            }
        } catch (authErr) {
            console.warn(`[AngelOneSync] Login attempt notice for ${clientCode}:`, authErr.message);
        }
    }

    return adapter;
};

/**
 * Sync Angel One trades into TradeRecord collection.
 * 
 * NOTE: Angel One SmartAPI only provides current-day trade/order book.
 * Unlike Upstox which has GET /v2/charges/historical-trades for any date range,
 * Angel One flushes trade/order books at the start of each new trading day.
 *
 * This function fetches:
 * 1. Today's trade book
 * 2. Today's order book (completed orders as backup)
 * 3. Positions (for P&L)
 * 4. Holdings (for portfolio view)
 * 
 * For historical trades, use the CSV import endpoint:
 *   POST /api/webhooks/angelone/import-csv/:brokerAccountId
 *
 * For real-time trade capture, configure the Angel One postback URL:
 *   POST /api/webhooks/angelone/postback
 */
export const syncAngelOneHistoricalTrades = async ({
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

    if (brokerAccount.broker !== "ANGEL_ONE") {
        throw new Error("Broker account is not an Angel One account");
    }

    if (!brokerAccount.isActive) {
        throw new Error("Angel One broker account is inactive");
    }

    const adapter = await getAngelOneAdapterForAccount(brokerAccount);

    console.log(`[AngelOne Sync] Fetching trades for account ${brokerAccountId}`);

    let rawTrades = [];

    // 1. Fetch from trade book (today's trades)
    try {
        const tradeBook = await adapter.getTradeBook();
        if (Array.isArray(tradeBook) && tradeBook.length > 0) {
            rawTrades.push(...tradeBook);
            console.log(`[AngelOne Sync] TradeBook: ${tradeBook.length} trades`);
        } else {
            console.log("[AngelOne Sync] TradeBook: empty (no trades today or market closed)");
        }
    } catch (err) {
        console.warn("[AngelOne Sync] Notice fetching tradebook:", err.message);
    }

    // 2. Also inspect executed orders from the order book to ensure all fills are captured
    try {
        const orders = await adapter.getOrderBook();
        if (Array.isArray(orders)) {
            const executedOrders = orders.filter(o => {
                const filledQty = Number(o.filledshares || o.fillsize || o.quantity || 0);
                const status = String(o.orderstatus || o.status || "").toLowerCase();
                return filledQty > 0 || status === "complete" || status === "traded";
            });

            let added = 0;
            for (const eo of executedOrders) {
                // If this order isn't already represented in rawTrades
                const orderId = String(eo.orderid || "");
                const exists = rawTrades.some(t => String(t.orderid || "") === orderId);
                if (!exists) {
                    rawTrades.push(eo);
                    added++;
                }
            }
            console.log(`[AngelOne Sync] OrderBook: ${orders.length} orders, ${executedOrders.length} completed, ${added} new`);
        }
    } catch (err) {
        console.warn("[AngelOne Sync] Notice inspecting order book:", err.message);
    }

    // Deduplicate by trade/order ID
    const uniqueMap = new Map();
    for (const t of rawTrades) {
        const id = String(
            (t.tradeid && t.tradeid !== "0") 
                ? t.tradeid 
                : (t.fillid || t.orderid || `AO-${Date.now()}-${Math.random()}`)
        );
        if (!uniqueMap.has(id)) {
            uniqueMap.set(id, t);
        }
    }

    const trades = Array.from(uniqueMap.values());
    console.log(`[AngelOne Sync] Total ${trades.length} unique trades to process`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const rawTrade of trades) {
        try {
            const mappedTrade = mapAngelOneTrade(rawTrade);
            mappedTrade.userId = brokerAccount.userId;
            mappedTrade.brokerAccountId = brokerAccount._id;
            mappedTrade.broker = "ANGEL_ONE";

            // Filter by date range if provided
            if (startDate || endDate) {
                const tradeDate = mappedTrade.tradeTime;
                if (startDate && new Date(tradeDate) < new Date(startDate)) {
                    skipped++;
                    continue;
                }
                if (endDate && new Date(tradeDate) > new Date(`${endDate}T23:59:59.999Z`)) {
                    skipped++;
                    continue;
                }
            }

            const result = await TradeRecord.updateOne(
                {
                    brokerAccountId: brokerAccount._id,
                    tradeId: mappedTrade.tradeId
                },
                { $set: mappedTrade },
                { upsert: true }
            );

            if (result.upsertedCount === 1) {
                inserted++;
            } else if (result.modifiedCount === 1) {
                updated++;
            } else {
                updated++;
            }
        } catch (itemErr) {
            if (itemErr.code === 11000) {
                skipped++;
            } else {
                console.warn("[AngelOne Sync] Item error:", itemErr.message);
                skipped++;
            }
        }
    }

    // 3. Fetch positions for P&L (like Upstox does)
    let positions = [];
    let totalUnrealised = 0;
    let totalRealised = 0;

    try {
        positions = await adapter.getPositions();
        if (Array.isArray(positions) && positions.length > 0) {
            console.log(`[AngelOne Sync] Positions: ${positions.length} open/closed`);
            
            for (const pos of positions) {
                const unrealised = Number(pos.unrealised || pos.pnl || 0);
                const realised = Number(pos.realised || 0);
                totalUnrealised += unrealised;
                totalRealised += realised;
            }
        }
    } catch (err) {
        console.warn("[AngelOne Sync] Notice fetching positions:", err.message);
    }

    // 4. Fetch holdings
    let holdings = [];
    try {
        holdings = await adapter.getHoldings();
        if (Array.isArray(holdings) && holdings.length > 0) {
            console.log(`[AngelOne Sync] Holdings: ${holdings.length} instruments`);
        }
    } catch (err) {
        console.warn("[AngelOne Sync] Notice fetching holdings:", err.message);
    }

    const totalPnl = totalUnrealised + totalRealised;

    // Print P&L snapshot (like Upstox sync does)
    console.log("");
    console.log("====================================");
    console.log("ANGEL ONE SYNC COMPLETED");
    console.log("====================================");
    console.log("Trades fetched:", trades.length);
    console.log("Inserted:", inserted);
    console.log("Updated:", updated);
    console.log("Skipped:", skipped);
    console.log("Positions:", positions.length);
    console.log("Holdings:", holdings.length);
    if (positions.length > 0) {
        console.log(`Total Unrealised P&L: ₹ ${totalUnrealised}`);
        console.log(`Total Realised P&L:   ₹ ${totalRealised}`);
        console.log(`Total P&L:            ₹ ${totalPnl}`);
    }
    console.log("====================================");

    // Update tokens if adapter re-authenticated during the sync
    if (adapter.jwtToken) {
        try {
            const currentToken = safeDecrypt(brokerAccount.credentials?.accessToken);
            if (adapter.jwtToken !== currentToken) {
                brokerAccount.credentials.accessToken = encrypt(adapter.jwtToken);
                if (adapter.refreshToken) brokerAccount.credentials.refreshToken = encrypt(adapter.refreshToken);
                if (adapter.feedToken) brokerAccount.credentials.feedToken = encrypt(adapter.feedToken);
                brokerAccount.isConnected = true;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
                console.log("[AngelOne Sync] Tokens updated after re-authentication");
            }
        } catch {
            // Token update is best-effort
        }
    }

    return {
        broker: "ANGEL_ONE",
        brokerAccountId: brokerAccount._id,
        totalFetched: trades.length,
        inserted,
        updated,
        skipped,
        total: trades.length,
        positionsFetched: positions.length,
        holdingsFetched: holdings.length,
        totalUnrealised,
        totalRealised,
        totalPnl,
        note: trades.length === 0
            ? "Angel One API only returns today's trades. For historical trades, use 'Import CSV' from the Angel One web portal."
            : undefined
    };
};

/**
 * Sync today's executed trades for Angel One.
 */
export const syncAngelOneTodayTrades = async ({ brokerAccountId }) => {
    return await syncAngelOneHistoricalTrades({ brokerAccountId });
};

export default {
    syncAngelOneHistoricalTrades,
    syncAngelOneTodayTrades,
    getAngelOneAdapterForAccount
};
