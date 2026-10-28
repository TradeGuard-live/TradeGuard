import GrowwAdapter from "./GrowwAdapter.js";
import { mapGrowwTrade } from "./GrowwMapper.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";
import { decrypt, encrypt } from "../../utils/encryption.js";

/**
 * GrowwSyncService.js
 * ✅ Synchronizes Groww executed orders & trades into TradeGuard's TradeRecord database.
 */
export const syncGrowwTrades = async ({
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

    if (brokerAccount.broker !== "GROWW") {
        throw new Error("Broker account is not a Groww account");
    }

    if (!brokerAccount.isActive) {
        throw new Error("Groww broker account is inactive");
    }

    // Decrypt credentials
    let accessToken = null;
    if (brokerAccount.credentials?.accessToken) {
        try {
            accessToken = decrypt(brokerAccount.credentials.accessToken);
        } catch {
            accessToken = brokerAccount.credentials.accessToken;
        }
    }

    let apiKey = null;
    if (brokerAccount.credentials?.apiKey) {
        try {
            apiKey = decrypt(brokerAccount.credentials.apiKey);
        } catch {
            apiKey = brokerAccount.credentials.apiKey;
        }
    }

    let apiSecret = null;
    if (brokerAccount.credentials?.apiSecret) {
        try {
            apiSecret = decrypt(brokerAccount.credentials.apiSecret);
        } catch {
            apiSecret = brokerAccount.credentials.apiSecret;
        }
    }

    // If access token is missing or expired, but apiKey & apiSecret are provided, auto-generate token
    const isTokenExpired = brokerAccount.credentials?.tokenExpiresAt && new Date(brokerAccount.credentials.tokenExpiresAt) < new Date();
    if ((!accessToken || isTokenExpired) && apiKey && apiSecret) {
        console.log(`[Groww Sync] Access token missing or expired for account ${brokerAccountId}. Auto-generating via API Key...`);
        try {
            const tokenRes = await GrowwAdapter.generateAccessToken({ apiKey, apiSecret });
            accessToken = tokenRes.accessToken;
            brokerAccount.credentials.accessToken = encrypt(accessToken);
            brokerAccount.credentials.tokenExpiresAt = tokenRes.expiresAt;
            brokerAccount.isConnected = true;
            brokerAccount.lastConnectedAt = new Date();
            await brokerAccount.save();
        } catch (tokenErr) {
            console.error("[Groww Sync] Auto token generation failed:", tokenErr.message);
            if (!accessToken) {
                throw new Error(`Groww authentication failed: ${tokenErr.message}`);
            }
        }
    }

    if (!accessToken) {
        throw new Error("Valid Groww access token or API Key & Secret is required to sync trades");
    }

    const groww = new GrowwAdapter({
        clientId: brokerAccount.credentials?.clientId,
        accessToken,
        apiKey,
        apiSecret
    });

    console.log(`[Groww Sync] Fetching orders for account ${brokerAccountId}`);

    let orders = [];
    try {
        orders = await groww.getAllOrders();
    } catch (orderErr) {
        console.error("[Groww Sync] Failed to fetch orders:", orderErr.message);
        throw orderErr;
    }

    if (!Array.isArray(orders)) {
        orders = [];
    }

    // Filter and deduplicate orders by groww_order_id
    const uniqueMap = new Map();
    for (const ord of orders) {
        const id = String(ord.groww_order_id || ord.order_reference_id || `TMP-${Date.now()}-${Math.random()}`);
        if (!uniqueMap.has(id)) {
            uniqueMap.set(id, ord);
        }
    }

    const dedupedOrders = Array.from(uniqueMap.values());
    console.log(`[Groww Sync] Retrieved ${dedupedOrders.length} unique orders from Groww`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const rawOrder of dedupedOrders) {
        try {
            const mapped = mapGrowwTrade(rawOrder);
            mapped.userId = brokerAccount.userId;
            mapped.brokerAccountId = brokerAccount._id;

            // Only sync executed / filled orders or valid open orders
            const fillQty = Number(rawOrder.filled_quantity ?? rawOrder.quantity ?? 0);
            if (rawOrder.order_status === "CANCELLED" || rawOrder.order_status === "REJECTED") {
                if (fillQty <= 0) {
                    skipped++;
                    continue;
                }
            }

            const existing = await TradeRecord.findOne({
                userId: brokerAccount.userId,
                tradeId: mapped.tradeId
            });

            if (existing) {
                await TradeRecord.updateOne(
                    { _id: existing._id },
                    { $set: mapped }
                );
                updated++;
            } else {
                await TradeRecord.create(mapped);
                inserted++;
            }
        } catch (err) {
            console.warn(`[Groww Sync] Error processing order ${rawOrder.groww_order_id}:`, err.message);
            skipped++;
        }
    }

    console.log(`[Groww Sync] Sync complete for ${brokerAccountId}: inserted=${inserted}, updated=${updated}, skipped=${skipped}`);

    return {
        inserted,
        updated,
        skipped,
        total: dedupedOrders.length
    };
};

export const syncGrowwTodayTrades = async ({ brokerAccountId }) => {
    return syncGrowwTrades({ brokerAccountId });
};

export const syncGrowwHistoricalTrades = async ({ brokerAccountId, startDate, endDate }) => {
    return syncGrowwTrades({ brokerAccountId, startDate, endDate });
};
