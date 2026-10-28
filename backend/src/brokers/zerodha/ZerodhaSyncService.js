import ZerodhaAdapter from "./ZerodhaAdapter.js";
import { mapZerodhaTrade } from "./ZerodhaMapper.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";
import { decrypt, encrypt } from "../../utils/encryption.js";

/**
 * ZerodhaSyncService.js
 * ✅ Synchronizes Zerodha Kite Connect v3 executed orders & trades into TradeGuard's TradeRecord database.
 */
export const syncZerodhaTrades = async ({
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

    if (brokerAccount.broker !== "ZERODHA") {
        throw new Error("Broker account is not a Zerodha account");
    }

    if (!brokerAccount.isActive) {
        throw new Error("Zerodha broker account is inactive");
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

    let requestToken = null;
    if (brokerAccount.credentials?.totpSecret) {
        // Can be stored in totpSecret or sid or feedToken if entered via UI
        try {
            requestToken = decrypt(brokerAccount.credentials.totpSecret);
        } catch {
            requestToken = brokerAccount.credentials.totpSecret;
        }
    }

    // If access token is missing or expired, but apiKey, apiSecret, and requestToken are provided, auto-exchange
    const isTokenExpired = brokerAccount.credentials?.tokenExpiresAt && new Date(brokerAccount.credentials.tokenExpiresAt) < new Date();
    if ((!accessToken || isTokenExpired) && apiKey && apiSecret && requestToken) {
        console.log(`[Zerodha Sync] Access token missing or expired for account ${brokerAccountId}. Auto-exchanging via request_token...`);
        try {
            const tokenRes = await ZerodhaAdapter.generateAccessToken({ apiKey, apiSecret, requestToken });
            accessToken = tokenRes.accessToken;
            brokerAccount.credentials.accessToken = encrypt(accessToken);
            // Kite access tokens expire at 6 AM next day
            const tomorrow6AM = new Date();
            tomorrow6AM.setDate(tomorrow6AM.getDate() + 1);
            tomorrow6AM.setHours(6, 0, 0, 0);
            brokerAccount.credentials.tokenExpiresAt = tomorrow6AM;
            brokerAccount.isConnected = true;
            brokerAccount.lastConnectedAt = new Date();
            await brokerAccount.save();
        } catch (tokenErr) {
            console.error("[Zerodha Sync] Auto token exchange failed:", tokenErr.message);
            if (!accessToken) {
                throw new Error(`Zerodha authentication failed: ${tokenErr.message}`);
            }
        }
    }

    if (!accessToken || !apiKey) {
        throw new Error("Valid Zerodha API Key and Access Token (or API Secret + Request Token) are required to sync trades");
    }

    const zerodha = new ZerodhaAdapter({
        apiKey,
        accessToken,
        apiSecret,
        clientId: brokerAccount.credentials?.clientId
    });

    console.log(`[Zerodha Sync] Fetching trades and orders for account ${brokerAccountId}`);

    let trades = [];
    let orders = [];

    const [tradesRes, ordersRes] = await Promise.allSettled([
        zerodha.getTrades(),
        zerodha.getOrders()
    ]);

    if (tradesRes.status === "fulfilled" && Array.isArray(tradesRes.value)) {
        trades = tradesRes.value;
    }
    if (ordersRes.status === "fulfilled" && Array.isArray(ordersRes.value)) {
        orders = ordersRes.value;
    }

    if (tradesRes.status === "rejected" && ordersRes.status === "rejected") {
        throw tradesRes.reason || new Error("Failed to fetch Zerodha trades and orders");
    }

    // Deduplicate records using unique tradeId / orderId
    const tradeMap = new Map();

    // 1. First add executed trades from /trades
    for (const t of trades) {
        const key = String(t.trade_id || t.order_id);
        if (key && !tradeMap.has(key)) {
            tradeMap.set(key, t);
        }
    }

    // 2. Add completed orders from /orders if not already covered by a trade
    for (const ord of orders) {
        const fillQty = Number(ord.filled_quantity ?? ord.quantity ?? 0);
        const isComplete = ord.status === "COMPLETE" || fillQty > 0;
        if (isComplete) {
            const key = String(ord.order_id);
            if (key && !tradeMap.has(key)) {
                tradeMap.set(key, ord);
            }
        }
    }

    const allRecords = Array.from(tradeMap.values());
    console.log(`[Zerodha Sync] Found ${allRecords.length} unique trade/order records to process`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const rawItem of allRecords) {
        try {
            const mapped = mapZerodhaTrade(rawItem);
            mapped.userId = brokerAccount.userId;
            mapped.brokerAccountId = brokerAccount._id;

            // Only sync executed/filled transactions
            if (mapped.quantity <= 0) {
                skipped++;
                continue;
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
            console.warn(`[Zerodha Sync] Error processing record:`, err.message);
            skipped++;
        }
    }

    console.log(`[Zerodha Sync] Sync complete for ${brokerAccountId}: inserted=${inserted}, updated=${updated}, skipped=${skipped}`);

    return {
        inserted,
        updated,
        skipped,
        total: allRecords.length
    };
};

export const syncZerodhaTodayTrades = async ({ brokerAccountId }) => {
    return syncZerodhaTrades({ brokerAccountId });
};

export const syncZerodhaHistoricalTrades = async ({ brokerAccountId, startDate, endDate }) => {
    return syncZerodhaTrades({ brokerAccountId, startDate, endDate });
};
