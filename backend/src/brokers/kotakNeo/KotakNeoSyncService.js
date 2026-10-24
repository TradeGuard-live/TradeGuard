import KotakNeoAdapter from "./KotakNeoAdapter.js";
import { mapKotakNeoTrade } from "./KotakNeoMapper.js";
import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";
import { decrypt, encrypt } from "../../utils/encryption.js";
import pnlEngine from "../../services/pnl/PnLEngine.js";

/**
 * Safely decrypt a field or return as-is
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
 * Instantiates a KotakNeoAdapter for a given BrokerAccount document.
 * If accessToken is missing or expired, automatically initiates TOTP + MPIN login.
 */
export const getKotakNeoAdapterForAccount = async (brokerAccount) => {
    const apiKey = safeDecrypt(brokerAccount.credentials?.apiKey);
    const clientId = brokerAccount.credentials?.clientId || "";
    const mobileNumber = safeDecrypt(brokerAccount.credentials?.mobileNumber);
    const password = safeDecrypt(brokerAccount.credentials?.password || brokerAccount.credentials?.apiSecret);
    const totpSecret = safeDecrypt(brokerAccount.credentials?.totpSecret);
    const accessToken = safeDecrypt(brokerAccount.credentials?.accessToken);
    const sid = safeDecrypt(brokerAccount.credentials?.sid || brokerAccount.credentials?.feedToken);
    const baseUrl = brokerAccount.credentials?.baseUrl || "https://cis.kotaksecurities.com";

    const adapter = new KotakNeoAdapter({
        apiKey,
        clientId,
        mobileNumber,
        password,
        totpSecret,
        accessToken,
        sid,
        baseUrl
    });

    // If we don't have an active trading token and we have login credentials, login now
    if ((!accessToken || accessToken.length < 10) && clientId && password && mobileNumber && (totpSecret || apiKey)) {
        try {
            console.log(`[KotakNeoSync] Performing automated TOTP + MPIN login for ${clientId}...`);
            const session = await adapter.login();
            if (session?.tradingToken) {
                brokerAccount.credentials.accessToken = session.tradingToken;
                if (session.tradingSid) {
                    brokerAccount.credentials.sid = session.tradingSid;
                }
                if (session.baseUrl) {
                    brokerAccount.credentials.baseUrl = session.baseUrl;
                }
                brokerAccount.isConnected = true;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
            }
        } catch (authErr) {
            console.warn(`[KotakNeoSync] Auto-login notice for ${clientId}:`, authErr.message);
        }
    }

    return adapter;
};

/**
 * Syncs Kotak Neo trades for today from Trade Book and Order Book into TradeRecord.
 */
export const syncKotakNeoTodayTrades = async ({ brokerAccountId }) => {
    if (!brokerAccountId) {
        throw new Error("brokerAccountId is required");
    }

    const brokerAccount = await BrokerAccount.findById(brokerAccountId);
    if (!brokerAccount) {
        throw new Error("Broker account not found");
    }

    if (brokerAccount.broker !== "KOTAK_NEO") {
        throw new Error("Broker account is not a Kotak Neo account");
    }

    if (!brokerAccount.isActive) {
        throw new Error("Kotak Neo broker account is inactive");
    }

    const adapter = await getKotakNeoAdapterForAccount(brokerAccount);

    console.log(`[KotakNeoSync] Syncing trades for account ${brokerAccountId}`);

    let rawTrades = [];

    // 1. Fetch executed trades from Trade Book
    try {
        const tradeBook = await adapter.getTradeBook();
        if (Array.isArray(tradeBook) && tradeBook.length > 0) {
            rawTrades.push(...tradeBook);
            console.log(`[KotakNeoSync] TradeBook: ${tradeBook.length} executed trades found`);
        } else {
            console.log("[KotakNeoSync] TradeBook: empty for today");
        }
    } catch (err) {
        console.warn("[KotakNeoSync] Notice reading trade book:", err.message);
    }

    // 2. Fetch completed orders from Order Book as a secondary source / safety net
    try {
        const orders = await adapter.getOrderBook();
        if (Array.isArray(orders)) {
            const executedOrders = orders.filter(o => {
                const filledQty = Number(o.qty || o.flQty || o.quantity || 0);
                const status = String(o.ordSt || o.stat || "").toLowerCase();
                return filledQty > 0 || status === "complete" || status === "traded" || status === "executed";
            });

            let added = 0;
            for (const eo of executedOrders) {
                const orderId = String(eo.nOrdNo || eo.orderNo || "");
                const exists = rawTrades.some(t => String(t.nOrdNo || t.orderNo || "") === orderId);
                if (!exists) {
                    rawTrades.push(eo);
                    added++;
                }
            }
            console.log(`[KotakNeoSync] OrderBook: ${orders.length} orders total, ${added} added from completed orders`);
        }
    } catch (err) {
        console.warn("[KotakNeoSync] Notice inspecting order book:", err.message);
    }

    // 3. Fallback: If trade book and order book are empty (e.g. intraday books cleared after market hours), check position book
    if (rawTrades.length === 0) {
        try {
            const positions = await adapter.getPositions();
            if (Array.isArray(positions) && positions.length > 0) {
                for (const pos of positions) {
                    const buyQty = Number(pos.buyQty || pos.flBuyQty || pos.bQty || 0);
                    const sellQty = Number(pos.sellQty || pos.flSellQty || pos.sQty || 0);
                    const sym = String(pos.trdSym || pos.sym || pos.symbol || "").trim();
                    if (!sym) continue;

                    if (buyQty > 0) {
                        const buyPrc = Number(pos.buyAvgPrc || pos.buyAvg || (pos.buyAmt ? pos.buyAmt / buyQty : 0));
                        rawTrades.push({
                            trdId: `POS-B-${sym}-${pos.prod || "MIS"}`,
                            trdSym: sym,
                            exSeg: pos.exSeg || pos.segment || "nse_cm",
                            prod: pos.prod || pos.productCode || "MIS",
                            trnsTp: "B",
                            flQty: buyQty,
                            avgPrc: buyPrc,
                            flDtTm: new Date().toISOString()
                        });
                    }

                    if (sellQty > 0) {
                        const sellPrc = Number(pos.sellAvgPrc || pos.sellAvg || (pos.sellAmt ? pos.sellAmt / sellQty : 0));
                        rawTrades.push({
                            trdId: `POS-S-${sym}-${pos.prod || "MIS"}`,
                            trdSym: sym,
                            exSeg: pos.exSeg || pos.segment || "nse_cm",
                            prod: pos.prod || pos.productCode || "MIS",
                            trnsTp: "S",
                            flQty: sellQty,
                            avgPrc: sellPrc,
                            flDtTm: new Date().toISOString()
                        });
                    }
                }
                if (rawTrades.length > 0) {
                    console.log(`[KotakNeoSync] Positions fallback: extracted ${rawTrades.length} executed trades from positions`);
                }
            }
        } catch (posErr) {
            console.warn("[KotakNeoSync] Notice inspecting positions for trades:", posErr.message);
        }
    }

    if (rawTrades.length === 0) {
        return {
            inserted: 0,
            updated: 0,
            skipped: 0,
            total: 0,
            message: "No trades found for today"
        };
    }

    // Deduplicate by trade ID or order ID
    const seen = new Set();
    const uniqueRawTrades = [];
    for (const item of rawTrades) {
        const key = String(item.trdId || item.nOrdNo || item.orderNo || JSON.stringify(item));
        if (!seen.has(key)) {
            seen.add(key);
            uniqueRawTrades.push(item);
        }
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const raw of uniqueRawTrades) {
        try {
            const mapped = mapKotakNeoTrade(raw);

            if (!mapped.symbol || mapped.quantity <= 0) {
                skipped++;
                continue;
            }

            // Calculate statutory & brokerage charges using TradeGuard PnLEngine
            let calculatedCharges = {};
            try {
                calculatedCharges = pnlEngine.calculateTradeFillCharges({
                    symbol: mapped.symbol,
                    exchange: mapped.exchange,
                    segment: mapped.segment,
                    productType: mapped.productCode,
                    transactionType: mapped.transactionType,
                    quantity: mapped.quantity,
                    price: mapped.executedPrice,
                    broker: "KOTAK_NEO"
                });
            } catch (chargeErr) {
                console.warn("[KotakNeoSync] Charges calc notice:", chargeErr.message);
            }

            const recordData = {
                userId: brokerAccount.userId,
                brokerAccountId: brokerAccount._id,
                broker: "KOTAK_NEO",
                tradeId: mapped.tradeId,
                orderId: mapped.orderId,
                symbol: mapped.symbol,
                exchange: mapped.exchange,
                segment: mapped.segment,
                transactionType: mapped.transactionType,
                quantity: mapped.quantity,
                executedPrice: mapped.executedPrice,
                orderType: mapped.orderType,
                status: mapped.status,
                productCode: mapped.productCode,
                tradeTime: mapped.tradeTime,
                charges: calculatedCharges || {},
                brokerResponse: mapped.brokerResponse
            };

            const existing = await TradeRecord.findOne({
                brokerAccountId: brokerAccount._id,
                $or: [
                    { tradeId: mapped.tradeId },
                    ...(mapped.orderId ? [{ orderId: mapped.orderId }] : [])
                ]
            });

            if (existing) {
                Object.assign(existing, recordData);
                await existing.save();
                updated++;
            } else {
                await TradeRecord.create(recordData);
                inserted++;
            }
        } catch (itemErr) {
            console.error("[KotakNeoSync] Error mapping/saving trade item:", itemErr.message);
            skipped++;
        }
    }

    // Refresh last connected timestamp
    brokerAccount.lastConnectedAt = new Date();
    await brokerAccount.save();

    return {
        inserted,
        updated,
        skipped,
        total: uniqueRawTrades.length
    };
};

/**
 * Historical trades sync handler.
 * Kotak Neo APIs provide current-day trades via TradeBook and OrderBook.
 * For extended past date ranges, it synchronizes available trades and returns summary.
 */
export const syncKotakNeoHistoricalTrades = async ({ brokerAccountId, startDate, endDate }) => {
    return await syncKotakNeoTodayTrades({ brokerAccountId });
};

export default {
    getKotakNeoAdapterForAccount,
    syncKotakNeoTodayTrades,
    syncKotakNeoHistoricalTrades
};
