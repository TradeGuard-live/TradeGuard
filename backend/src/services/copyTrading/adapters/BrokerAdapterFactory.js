/**
 * BrokerAdapterFactory.js
 * 
 * Factory resolving unified IBrokerAdapter instances for any configured broker account.
 * Decrypts credentials stored securely in BrokerAccount documents and ensures all
 * adapters expose placeOrder, modifyOrder, cancelOrder, getOrders, and getTrades.
 */

import BrokerAccount from "../../../models/BrokerAccount.js";
import { decrypt } from "../../../utils/encryption.js";
import MockBrokerAdapter from "./MockBrokerAdapter.js";
import UpstoxAdapter from "../../../brokers/upstox/UpstoxAdaptor.js";
import ZerodhaAdapter from "../../../brokers/zerodha/ZerodhaAdapter.js";
import KotakNeoAdapter from "../../../brokers/kotakNeo/KotakNeoAdapter.js";
import DhanAdapter from "../../../brokers/dhan/DhanAdapter.js";
import AngelOneAdapter from "../../../brokers/angelOne/AngelOneAdapter.js";
import GrowwAdapter from "../../../brokers/groww/GrowwAdapter.js";
import upstoxInstrumentService from "../../marketData/upstoxInstrumentService.js";
import { IBrokerAdapter } from "../contracts/BrokerAdapterContract.js";
import { getBrokerCapabilities } from "../contracts/BrokerCapabilityRegistry.js";

// Active in-memory mock adapters for simulation
const mockAdapterStore = new Map(); // accountId -> MockBrokerAdapter

export class BrokerAdapterFactory {
    /**
     * Retrieves or creates a MockBrokerAdapter for simulation
     * @param {string} accountId
     * @returns {MockBrokerAdapter}
     */
    static getMockAdapter(accountId = "MOCK_MASTER") {
        if (!mockAdapterStore.has(accountId)) {
            mockAdapterStore.set(accountId, new MockBrokerAdapter({ accountId }));
        }
        return mockAdapterStore.get(accountId);
    }

    /**
     * Resolves an IBrokerAdapter instance for an account
     * 
     * @param {string} accountId - Mongo ObjectId or "MOCK_..."
     * @param {string} [brokerType] - Optional broker hint
     * @returns {Promise<IBrokerAdapter>}
     */
    static async getAdapter(accountId, brokerType = null) {
        if (!accountId) {
            throw new Error("accountId is required to resolve broker adapter");
        }

        const idStr = String(accountId);

        // Simulation / Mock accounts
        if (idStr.startsWith("MOCK") || brokerType === "MOCK") {
            return BrokerAdapterFactory.getMockAdapter(idStr);
        }

        const account = await BrokerAccount.findById(accountId);
        if (!account) {
            // Check if it's a registered mock account ID
            if (mockAdapterStore.has(idStr)) {
                return mockAdapterStore.get(idStr);
            }
            throw new Error(`Broker account ${accountId} not found`);
        }

        const broker = account.broker;

        if (broker === "MOCK") {
            return BrokerAdapterFactory.getMockAdapter(account._id.toString());
        }

        if (broker === "UPSTOX") {
            const rawToken = account.credentials?.accessToken || account.credentials?.apiKey;
            const token = decrypt(rawToken);
            if (!token) throw new Error("Upstox access token missing or decryption failed");

            const rawAdapter = new UpstoxAdapter(token);
            return BrokerAdapterFactory._wrapUpstoxAdapter(rawAdapter, account._id.toString());
        }

        if (broker === "ZERODHA") {
            const apiKey = decrypt(account.credentials?.apiKey);
            const accessToken = decrypt(account.credentials?.accessToken);
            if (!apiKey || !accessToken) throw new Error("Zerodha credentials missing or decryption failed");

            const rawAdapter = new ZerodhaAdapter({ apiKey, accessToken, clientId: account.credentials?.clientId });
            return BrokerAdapterFactory._wrapZerodhaAdapter(rawAdapter, account._id.toString());
        }

        if (broker === "KOTAK_NEO") {
            const consumerKey = decrypt(account.credentials?.apiKey);
            const consumerSecret = decrypt(account.credentials?.apiSecret);
            const mobileNumber = decrypt(account.credentials?.mobileNumber);
            const password = decrypt(account.credentials?.password);

            const rawAdapter = new KotakNeoAdapter({ consumerKey, consumerSecret, mobileNumber, password });
            return BrokerAdapterFactory._wrapKotakNeoAdapter(rawAdapter, account._id.toString());
        }

        if (broker === "DHAN") {
            const clientId = account.credentials?.clientId;
            let accessToken = decrypt(account.credentials?.accessToken);
            if (!accessToken) accessToken = account.credentials?.accessToken;
            if (!accessToken) throw new Error("Dhan access token missing or decryption failed");

            const rawAdapter = new DhanAdapter({ clientId, accessToken });
            return BrokerAdapterFactory._wrapDhanAdapter(rawAdapter, account._id.toString());
        }

        if (broker === "ANGEL_ONE") {
            const apiKey = decrypt(account.credentials?.apiKey) || account.credentials?.apiKey;
            const clientCode = decrypt(account.credentials?.clientId) || account.credentials?.clientId;
            const password = decrypt(account.credentials?.password) || account.credentials?.password;
            const totpSecret = decrypt(account.credentials?.totpSecret) || account.credentials?.totpSecret;
            const accessToken = decrypt(account.credentials?.accessToken) || account.credentials?.accessToken;
            const refreshToken = decrypt(account.credentials?.refreshToken) || account.credentials?.refreshToken;
            const feedToken = decrypt(account.credentials?.feedToken) || account.credentials?.feedToken;

            const rawAdapter = new AngelOneAdapter({
                apiKey,
                clientCode,
                password,
                totpSecret,
                accessToken,
                refreshToken,
                feedToken
            });
            return BrokerAdapterFactory._wrapAngelOneAdapter(rawAdapter, account._id.toString());
        }

        if (broker === "GROWW") {
            const apiKey = decrypt(account.credentials?.apiKey) || account.credentials?.apiKey;
            const apiSecret = decrypt(account.credentials?.apiSecret) || account.credentials?.apiSecret;
            let accessToken = decrypt(account.credentials?.accessToken) || account.credentials?.accessToken;

            const rawAdapter = new GrowwAdapter({
                apiKey,
                apiSecret,
                accessToken
            });
            return BrokerAdapterFactory._wrapGrowwAdapter(rawAdapter, account._id.toString());
        }

        throw new Error(`Broker ${broker} is not configured with an automated trading adapter`);
    }

    static _wrapUpstoxAdapter(upstox, accountId) {
        return {
            getBroker: () => "UPSTOX",
            getAccountId: () => accountId,
            getCapabilities: () => getBrokerCapabilities("UPSTOX"),
            checkConnection: async () => {
                try {
                    await upstox.getPositions();
                    return { isConnected: true };
                } catch (e) {
                    return { isConnected: false, message: e.message };
                }
            },
            placeOrder: async (params) => {
                const client = upstox.client;
                const instToken = upstoxInstrumentService.resolveInstrumentKey({
                    symbol: params.symbol,
                    exchange: params.exchange,
                    segment: params.segment,
                    instrumentToken: params.instrumentToken
                }) || params.instrumentToken || `${params.exchange || "NSE"}_EQ|${params.symbol}`;

                const payload = {
                    quantity: params.quantity,
                    product: params.productCode === "DELIVERY" ? "D" : "I",
                    validity: "DAY",
                    price: params.price || 0,
                    tag: String(params.tag || "TG-COPY").slice(0, 20),
                    instrument_token: instToken,
                    order_type: params.orderType || "MARKET",
                    transaction_type: params.transactionType,
                    disclosed_quantity: 0,
                    trigger_price: params.triggerPrice || 0,
                    is_amo: false
                };
                try {
                    const res = await client.post("/order/place", payload);
                    const orderId = res.data?.data?.order_id || res.data?.order_id;
                    return {
                        success: true,
                        orderId: String(orderId),
                        status: "ACKNOWLEDGED",
                        raw: res.data
                    };
                } catch (err) {
                    const msg = err.response?.data?.errors?.[0]?.message ||
                                err.response?.data?.message ||
                                err.message;
                    throw new Error(`Upstox order placement failed: ${msg}`);
                }
            },
            modifyOrder: async (params) => {
                const client = upstox.client;
                const payload = {
                    order_id: params.orderId,
                    quantity: params.quantity,
                    price: params.price || 0,
                    order_type: params.orderType || "LIMIT",
                    trigger_price: params.triggerPrice || 0,
                    validity: "DAY"
                };
                try {
                    const res = await client.put("/order/modify", payload);
                    return {
                        success: true,
                        orderId: params.orderId,
                        status: "ACKNOWLEDGED",
                        raw: res.data
                    };
                } catch (err) {
                    const msg = err.response?.data?.errors?.[0]?.message || err.message;
                    throw new Error(`Upstox order modification failed: ${msg}`);
                }
            },
            cancelOrder: async (params) => {
                const client = upstox.client;
                try {
                    const res = await client.delete("/order/cancel", { params: { order_id: params.orderId } });
                    return {
                        success: true,
                        orderId: params.orderId,
                        status: "CANCELLED",
                        raw: res.data
                    };
                } catch (err) {
                    const msg = err.response?.data?.errors?.[0]?.message || err.message;
                    throw new Error(`Upstox order cancellation failed: ${msg}`);
                }
            },
            getOrder: async (orderId) => {
                return upstox.getOrderDetails(orderId);
            },
            getOrders: async () => {
                try {
                    const res = await upstox.client.get("/order/retrieve-all");
                    return res.data?.data || [];
                } catch {
                    return [];
                }
            },
            getTrades: async () => {
                return upstox.getTradesForDay();
            },
            getPositions: async () => {
                return upstox.getPositions();
            },
            subscribeOrderStream: () => {},
            unsubscribeOrderStream: () => {}
        };
    }

    static _wrapZerodhaAdapter(zerodha, accountId) {
        return {
            getBroker: () => "ZERODHA",
            getAccountId: () => accountId,
            getCapabilities: () => getBrokerCapabilities("ZERODHA"),
            checkConnection: async () => {
                try {
                    await zerodha.getProfile();
                    return { isConnected: true };
                } catch (e) {
                    return { isConnected: false, message: e.message };
                }
            },
            placeOrder: async (params) => {
                const variety = "regular";
                const form = new URLSearchParams();
                form.append("exchange", params.exchange || "NSE");
                form.append("tradingsymbol", params.symbol);
                form.append("transaction_type", params.transactionType);
                form.append("order_type", params.orderType || "MARKET");
                form.append("quantity", String(params.quantity));
                form.append("product", params.productCode === "DELIVERY" ? "CNC" : "MIS");
                form.append("price", String(params.price || 0));
                form.append("trigger_price", String(params.triggerPrice || 0));
                form.append("tag", String(params.tag || "TG-COPY").slice(0, 20));

                const res = await zerodha._request("POST", `/orders/${variety}`, {
                    data: form.toString(),
                    headers: { "Content-Type": "application/x-www-form-urlencoded" }
                });
                const orderId = res?.data?.order_id || res?.order_id;
                return {
                    success: true,
                    orderId,
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            modifyOrder: async (params) => {
                const variety = "regular";
                const form = new URLSearchParams();
                if (params.quantity) form.append("quantity", String(params.quantity));
                if (params.price !== undefined) form.append("price", String(params.price));
                if (params.triggerPrice !== undefined) form.append("trigger_price", String(params.triggerPrice));
                if (params.orderType) form.append("order_type", params.orderType);

                const res = await zerodha._request("PUT", `/orders/${variety}/${encodeURIComponent(params.orderId)}`, {
                    data: form.toString(),
                    headers: { "Content-Type": "application/x-www-form-urlencoded" }
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            cancelOrder: async (params) => {
                const variety = "regular";
                const res = await zerodha._request("DELETE", `/orders/${variety}/${encodeURIComponent(params.orderId)}`);
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "CANCELLED",
                    raw: res
                };
            },
            getOrder: async (orderId) => {
                const history = await zerodha.getOrderHistory(orderId);
                return Array.isArray(history) && history.length > 0 ? history[history.length - 1] : null;
            },
            getOrders: async () => {
                return zerodha.getOrders();
            },
            getTrades: async () => {
                return zerodha.getTrades();
            },
            subscribeOrderStream: () => {},
            unsubscribeOrderStream: () => {}
        };
    }

    static _wrapKotakNeoAdapter(kotak, accountId) {
        return {
            getBroker: () => "KOTAK_NEO",
            getAccountId: () => accountId,
            getCapabilities: () => getBrokerCapabilities("KOTAK_NEO"),
            checkConnection: async () => {
                return { isConnected: true };
            },
            placeOrder: async (params) => {
                const ex = (params.exchange || "NSE").toLowerCase();
                const seg = String(params.segment || "EQUITY").toUpperCase();
                let es;
                if (seg.includes("FO") || seg.includes("FUT") || seg.includes("OPT")) {
                    es = ex === "bse" ? "bse_fo" : "nse_fo";
                } else {
                    es = ex === "bse" ? "bse_cm" : "nse_cm";
                }

                let sym = String(params.symbol || "").trim();
                if (sym.includes("|")) sym = sym.split("|").pop().trim();
                else if (sym.includes(":")) sym = sym.split(":").pop().trim();
                sym = sym.replace(/_EQ$/i, "-EQ");
                if (es.endsWith("_cm") && !sym.includes("-") && !sym.includes(" ")) {
                    sym = `${sym}-EQ`;
                }

                const ordType = String(params.orderType || "MARKET").toUpperCase();
                const isLimit = ordType === "LIMIT" || ordType === "L";
                const isSL = ordType === "SL" || ordType === "STOP_LOSS";

                const res = await kotak.placeOrder({
                    symbol: sym,
                    exchangeSegment: es,
                    transactionType: params.transactionType === "BUY" ? "B" : "S",
                    orderType: isLimit ? "L" : isSL ? "SL" : "MKT",
                    productCode: params.productCode === "DELIVERY" || params.productCode === "CNC" ? "CNC" : params.productCode === "NRML" ? "NRML" : "MIS",
                    quantity: params.quantity,
                    price: isLimit ? params.price : "0",
                    triggerPrice: isSL ? params.triggerPrice : "0"
                });
                const orderId = res?.nOrdNo || res?.orderNo || res?.data?.nOrdNo;
                return {
                    success: true,
                    orderId: String(orderId),
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            modifyOrder: async (params) => {
                const res = await kotak.modifyOrder({
                    orderNo: params.orderId,
                    quantity: params.quantity,
                    price: params.price || "0",
                    triggerPrice: params.triggerPrice || "0"
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            cancelOrder: async (params) => {
                const res = await kotak.cancelOrder({
                    orderNo: params.orderId
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "CANCELLED",
                    raw: res
                };
            },
            getOrder: async (orderId) => {
                try {
                    const orders = await kotak.getOrderBook();
                    return Array.isArray(orders) ? orders.find(o => String(o.nOrdNo || o.orderNo) === String(orderId)) : null;
                } catch {
                    return null;
                }
            },
            getOrders: async () => {
                try {
                    return await kotak.getOrderBook();
                } catch {
                    return [];
                }
            },
            getTrades: async () => {
                try {
                    return await kotak.getTradeBook();
                } catch {
                    return [];
                }
            },
            getPositions: async () => {
                try {
                    return await kotak.getPositions();
                } catch {
                    return [];
                }
            },
            subscribeOrderStream: () => {},
            unsubscribeOrderStream: () => {}
        };
    }

    static _wrapDhanAdapter(dhan, accountId) {
        return {
            getBroker: () => "DHAN",
            getAccountId: () => accountId,
            getCapabilities: () => getBrokerCapabilities("DHAN"),
            checkConnection: async () => {
                try {
                    await dhan.getProfile();
                    return { isConnected: true };
                } catch (e) {
                    return { isConnected: false, message: e.message };
                }
            },
            placeOrder: async (params) => {
                const exSegment = (params.exchange || "NSE").toUpperCase() === "BSE"
                    ? (params.segment === "FUTURES" || params.segment === "OPTIONS" ? "BSE_FNO" : "BSE_EQ")
                    : (params.segment === "FUTURES" || params.segment === "OPTIONS" ? "NSE_FNO" : "NSE_EQ");
                
                let resolvedSecurityId = params.securityId;
                if (!resolvedSecurityId && params.instrumentToken) {
                    const tokenStr = String(params.instrumentToken);
                    const parts = tokenStr.split("|");
                    const sec = parts.length > 1 ? parts[1] : parts[0];
                    if (/^\d+$/.test(sec)) {
                        resolvedSecurityId = sec;
                    }
                }
                if (!resolvedSecurityId && params.symbol) {
                    try {
                        const openPos = await dhan.getPositions().catch(() => []);
                        const match = openPos.find(p => 
                            p.tradingSymbol === params.symbol || 
                            p.customSymbol === params.symbol ||
                            String(p.securityId) === String(params.symbol)
                        );
                        if (match?.securityId) {
                            resolvedSecurityId = String(match.securityId);
                        }
                    } catch {}
                }
                if (!resolvedSecurityId) {
                    resolvedSecurityId = params.symbol;
                }

                const res = await dhan.placeOrder({
                    transactionType: params.transactionType,
                    exchangeSegment: exSegment,
                    productType: params.productCode === "DELIVERY" || params.productCode === "CNC" ? "CNC" : "INTRADAY",
                    orderType: params.orderType || "MARKET",
                    validity: "DAY",
                    securityId: String(resolvedSecurityId),
                    quantity: params.quantity,
                    price: params.price || 0,
                    triggerPrice: params.triggerPrice || 0,
                    correlationId: String(params.tag || `TG-${Date.now()}`).slice(0, 25)
                });

                const orderId = res?.orderId || res?.data?.orderId;
                return {
                    success: true,
                    orderId: String(orderId),
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            modifyOrder: async (params) => {
                const res = await dhan.modifyOrder({
                    orderId: params.orderId,
                    quantity: params.quantity,
                    price: params.price || 0,
                    triggerPrice: params.triggerPrice || 0,
                    orderType: params.orderType || "LIMIT"
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            cancelOrder: async (params) => {
                const res = await dhan.cancelOrder(params.orderId);
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "CANCELLED",
                    raw: res
                };
            },
            getOrder: async (orderId) => {
                return dhan.getOrder(orderId);
            },
            getOrders: async () => {
                return dhan.getOrders();
            },
            getTrades: async () => {
                return dhan.getTrades();
            },
            getPositions: async () => {
                return dhan.getPositions();
            },
            subscribeOrderStream: () => {},
            unsubscribeOrderStream: () => {}
        };
    }

    static _wrapAngelOneAdapter(angelOne, accountId) {
        return {
            getBroker: () => "ANGEL_ONE",
            getAccountId: () => accountId,
            getCapabilities: () => getBrokerCapabilities("ANGEL_ONE"),
            checkConnection: async () => {
                try {
                    await angelOne.getProfile();
                    return { isConnected: true };
                } catch (e) {
                    return { isConnected: false, message: e.message };
                }
            },
            placeOrder: async (params) => {
                const res = await angelOne.placeOrder({
                    symbol: params.symbol,
                    symbolToken: params.instrumentToken || params.symbolToken,
                    transactionType: params.transactionType,
                    exchange: params.exchange || "NSE",
                    orderType: params.orderType || "MARKET",
                    productType: params.productCode === "DELIVERY" || params.productCode === "CNC" ? "DELIVERY" : params.productCode === "NRML" ? "CARRYFORWARD" : "INTRADAY",
                    price: params.price || 0,
                    triggerPrice: params.triggerPrice || 0,
                    quantity: params.quantity
                });
                return {
                    success: true,
                    orderId: String(res.orderId || res?.data?.orderid || res?.data?.uniqueorderid || `AO-${Date.now()}`),
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            modifyOrder: async (params) => {
                const res = await angelOne.modifyOrder({
                    orderId: params.orderId,
                    orderType: params.orderType || "LIMIT",
                    productType: params.productCode || "INTRADAY",
                    price: params.price || 0,
                    triggerPrice: params.triggerPrice || 0,
                    quantity: params.quantity
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            cancelOrder: async (params) => {
                const res = await angelOne.cancelOrder({
                    orderId: params.orderId
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "CANCELLED",
                    raw: res
                };
            },
            getOrder: async (orderId) => {
                try {
                    const orders = await angelOne.getOrderBook();
                    return Array.isArray(orders) ? orders.find(o => String(o.orderid) === String(orderId)) : null;
                } catch {
                    return null;
                }
            },
            getOrders: async () => {
                return angelOne.getOrderBook();
            },
            getTrades: async () => {
                return angelOne.getTradeBook();
            },
            getPositions: async () => {
                return angelOne.getPositions();
            },
            subscribeOrderStream: () => {},
            unsubscribeOrderStream: () => {}
        };
    }

    static _wrapGrowwAdapter(groww, accountId) {
        return {
            getBroker: () => "GROWW",
            getAccountId: () => accountId,
            getCapabilities: () => getBrokerCapabilities("GROWW"),
            checkConnection: async () => {
                try {
                    await groww.getProfile();
                    return { isConnected: true };
                } catch (e) {
                    return { isConnected: false, message: e.message };
                }
            },
            placeOrder: async (params) => {
                const res = await groww.placeOrder({
                    symbol: params.symbol,
                    exchange: params.exchange || "NSE",
                    transactionType: params.transactionType,
                    orderType: params.orderType || "MARKET",
                    productCode: params.productCode || "INTRADAY",
                    quantity: params.quantity,
                    price: params.price || 0,
                    triggerPrice: params.triggerPrice || 0
                });
                return {
                    success: true,
                    orderId: String(res.orderId || `GW-${Date.now()}`),
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            modifyOrder: async (params) => {
                const res = await groww.modifyOrder({
                    orderId: params.orderId,
                    quantity: params.quantity,
                    price: params.price || 0,
                    triggerPrice: params.triggerPrice || 0,
                    orderType: params.orderType || "LIMIT"
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "ACKNOWLEDGED",
                    raw: res
                };
            },
            cancelOrder: async (params) => {
                const res = await groww.cancelOrder({
                    orderId: params.orderId
                });
                return {
                    success: true,
                    orderId: params.orderId,
                    status: "CANCELLED",
                    raw: res
                };
            },
            getOrder: async (orderId) => {
                return groww.getOrderDetails(orderId);
            },
            getOrders: async () => {
                return groww.getAllOrders();
            },
            getTrades: async () => {
                return [];
            },
            getPositions: async () => {
                return groww.getPositions();
            },
            subscribeOrderStream: () => {},
            unsubscribeOrderStream: () => {}
        };
    }
}

export default BrokerAdapterFactory;
