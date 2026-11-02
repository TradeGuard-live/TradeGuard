import mongoose from "mongoose";
import BrokerAccount from "../../models/BrokerAccount.js";
import { syncUpstoxTodayTrades } from "../../brokers/upstox/UpstoxSyncService.js";
import UpstoxAdapter from "../../brokers/upstox/UpstoxAdaptor.js";
import { mapUpstoxPosition } from "../../brokers/upstox/UpstoxMapper.js";
import { syncDhanTodayTrades } from "../../brokers/dhan/DhanSyncService.js";
import DhanAdapter from "../../brokers/dhan/DhanAdapter.js";
import { mapDhanPosition } from "../../brokers/dhan/DhanMapper.js";
import { syncKotakNeoTodayTrades, getKotakNeoAdapterForAccount } from "../../brokers/kotakNeo/KotakNeoSyncService.js";
import { mapKotakNeoPosition } from "../../brokers/kotakNeo/KotakNeoMapper.js";
import { syncZerodhaTodayTrades } from "../../brokers/zerodha/ZerodhaSyncService.js";
import ZerodhaAdapter from "../../brokers/zerodha/ZerodhaAdapter.js";
import { mapZerodhaPosition } from "../../brokers/zerodha/ZerodhaMapper.js";
import { syncGrowwTodayTrades } from "../../brokers/groww/GrowwSyncService.js";
import GrowwAdapter from "../../brokers/groww/GrowwAdapter.js";
import { mapGrowwPosition } from "../../brokers/groww/GrowwMapper.js";
import { syncAngelOneTodayTrades } from "../../brokers/angelOne/AngelOneSyncService.js";
import AngelOneAdapter from "../../brokers/angelOne/AngelOneAdapter.js";
import { mapAngelOnePosition } from "../../brokers/angelOne/AngelOneMapper.js";
import { decrypt, encrypt } from "../../utils/encryption.js";

/**
 * BrokerSyncManager
 * Unified orchestrator for synchronizing today's live trades and fetching live positions
 * across ALL supported brokers (Upstox, Dhan, Kotak Neo, Zerodha, Groww, Angel One).
 */
export class BrokerSyncManager {
    /**
     * Synchronizes today's live trades for all active broker accounts belonging to a user.
     * @param {string} userId
     * @returns {Promise<{ inserted: number, updated: number, skipped: number, total: number }>}
     */
    async syncAllBrokersTodayTrades(userId) {
        if (!userId) return { inserted: 0, updated: 0, skipped: 0, total: 0 };

        let query = { isActive: true };
        if (mongoose.Types.ObjectId.isValid(userId)) {
            query.userId = new mongoose.Types.ObjectId(userId);
        } else {
            query.userId = userId;
        }

        const accounts = await BrokerAccount.find(query);
        let totalInserted = 0;
        let totalUpdated = 0;
        let totalSkipped = 0;

        for (const acc of accounts) {
            try {
                let res = null;
                const broker = String(acc.broker || "").toUpperCase();

                if (broker === "UPSTOX" && acc.credentials?.accessToken) {
                    res = await syncUpstoxTodayTrades({ brokerAccountId: acc._id });
                } else if (broker === "DHAN" && acc.credentials?.accessToken) {
                    res = await syncDhanTodayTrades({ brokerAccountId: acc._id });
                } else if (broker === "KOTAK_NEO") {
                    let totp = "";
                    try { totp = decrypt(acc.credentials?.totpSecret); } catch { totp = acc.credentials?.totpSecret; }
                    const isReusable = totp && !/^\d{6}$/.test(String(totp).trim());
                    if (acc.isConnected || isReusable) {
                        res = await syncKotakNeoTodayTrades({ brokerAccountId: acc._id });
                    }
                } else if (broker === "ZERODHA") {
                    res = await syncZerodhaTodayTrades({ brokerAccountId: acc._id });
                } else if (broker === "GROWW") {
                    res = await syncGrowwTodayTrades({ brokerAccountId: acc._id });
                } else if (broker === "ANGEL_ONE") {
                    res = await syncAngelOneTodayTrades({ brokerAccountId: acc._id });
                }

                if (res) {
                    totalInserted += res.inserted || 0;
                    totalUpdated += res.updated || 0;
                    totalSkipped += res.skipped || 0;
                }
            } catch (err) {
                console.warn(`[BrokerSyncManager] Notice syncing today trades for broker ${acc.broker} (${acc._id}):`, err.message);
                const isAuth = err.status === 401 || err.status === 403 || /401|403|token|unauthorized|expired|invalid/i.test(err.message);
                if (isAuth) {
                    acc.isConnected = false;
                    acc.verificationError = err.message;
                    await acc.save().catch(() => {});
                }
            }
        }

        return {
            inserted: totalInserted,
            updated: totalUpdated,
            skipped: totalSkipped,
            total: totalInserted + totalUpdated + totalSkipped
        };
    }

    /**
     * Fetches live positions and auth credentials from all connected active broker accounts.
     * @param {string} userId
     * @returns {Promise<{ brokerPositions: Array, brokerAuth: Object }>}
     */
    async fetchAllBrokerPositions(userId) {
        const brokerPositions = [];
        const brokerAuth = {};

        if (!userId) return { brokerPositions, brokerAuth };

        let query = { isActive: true };
        if (mongoose.Types.ObjectId.isValid(userId)) {
            query.userId = new mongoose.Types.ObjectId(userId);
        } else {
            query.userId = userId;
        }

        const accounts = await BrokerAccount.find(query);

        for (const acc of accounts) {
            const broker = String(acc.broker || "").toUpperCase();
            try {
                if (broker === "UPSTOX" && acc.credentials?.accessToken) {
                    const token = decrypt(acc.credentials.accessToken);
                    if (token) {
                        brokerAuth.upstoxToken = token;
                        const upstox = new UpstoxAdapter(token);
                        const pos = await upstox.getPositions().catch(uErr => {
                            if (uErr.response?.status === 401 || /401|token|expired|invalid/i.test(uErr.message)) {
                                acc.isConnected = false;
                                acc.verificationError = uErr.message;
                                acc.save().catch(() => {});
                            }
                            return [];
                        });
                        if (Array.isArray(pos)) {
                            brokerPositions.push(...pos.map(mapUpstoxPosition).filter(Boolean).map(p => ({
                                ...p,
                                broker: "UPSTOX",
                                brokerAccountId: acc._id
                            })));
                        }
                    }
                } else if (broker === "DHAN" && acc.credentials?.accessToken) {
                    const token = decrypt(acc.credentials.accessToken);
                    const clientId = acc.credentials?.clientId;
                    if (token && clientId) {
                        brokerAuth.dhanToken = token;
                        brokerAuth.dhanClientId = clientId;
                        const dhan = new DhanAdapter({ clientId, accessToken: token });
                        const pos = await dhan.getPositions().catch(dErr => {
                            if (dErr.status === 401 || /401|token|expired|invalid/i.test(dErr.message)) {
                                acc.isConnected = false;
                                acc.verificationError = dErr.message;
                                acc.save().catch(() => {});
                            }
                            return [];
                        });
                        if (Array.isArray(pos)) {
                            brokerPositions.push(...pos.map(mapDhanPosition).filter(Boolean).map(p => ({
                                ...p,
                                broker: "DHAN",
                                brokerAccountId: acc._id
                            })));
                        }
                    }
                } else if (broker === "KOTAK_NEO") {
                    let totp = "";
                    try { totp = decrypt(acc.credentials?.totpSecret); } catch { totp = acc.credentials?.totpSecret; }
                    const isReusable = totp && !/^\d{6}$/.test(String(totp).trim());
                    if (acc.isConnected || isReusable) {
                        try {
                            const adapter = await getKotakNeoAdapterForAccount(acc);
                            if (adapter.tradingToken) {
                                brokerAuth.kotakToken = adapter.tradingToken;
                                const pos = await adapter.getPositions({ noAutoLogin: true }).catch(async (kErr) => {
                                    if (kErr.status === 401 || /401|session|token|unauthorized/i.test(kErr.message)) {
                                        acc.isConnected = false;
                                        acc.credentials.accessToken = "";
                                        acc.verificationError = kErr.message;
                                        await acc.save().catch(() => {});
                                    }
                                    return [];
                                });
                                if (Array.isArray(pos)) {
                                    brokerPositions.push(...pos.map(mapKotakNeoPosition).filter(Boolean).map(p => ({
                                        ...p,
                                        broker: "KOTAK_NEO",
                                        brokerAccountId: acc._id
                                    })));
                                }
                            }
                        } catch (kErr) {
                            console.warn("[BrokerSyncManager] Kotak Neo positions notice:", kErr.message);
                        }
                    }
                } else if (broker === "ZERODHA" && (acc.credentials?.accessToken || (acc.credentials?.apiKey && acc.credentials?.apiSecret))) {
                    let token = acc.credentials?.accessToken ? decrypt(acc.credentials.accessToken) : "";
                    const apiKey = acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey) : "";
                    const apiSecret = acc.credentials?.apiSecret ? decrypt(acc.credentials.apiSecret) : "";
                    const requestToken = acc.credentials?.totpSecret ? decrypt(acc.credentials.totpSecret) : "";

                    const isTokenExpired = acc.credentials?.tokenExpiresAt && new Date(acc.credentials.tokenExpiresAt) < new Date();
                    if ((!token || isTokenExpired) && apiKey && apiSecret && requestToken) {
                        try {
                            const tokenRes = await ZerodhaAdapter.generateAccessToken({ apiKey, apiSecret, requestToken });
                            token = tokenRes.accessToken;
                            acc.credentials.accessToken = encrypt(token);
                            acc.isConnected = true;
                            await acc.save().catch(() => {});
                        } catch {}
                    }

                    if (token && apiKey) {
                        brokerAuth.zerodhaToken = token;
                        brokerAuth.zerodhaApiKey = apiKey;
                        const zerodha = new ZerodhaAdapter({ apiKey, accessToken: token, apiSecret, clientId: acc.credentials?.clientId });
                        const posRes = await zerodha.getPositions().catch(() => null);
                        if (Array.isArray(posRes?.net)) {
                            brokerPositions.push(...posRes.net.map(mapZerodhaPosition).filter(Boolean).map(p => ({
                                ...p,
                                broker: "ZERODHA",
                                brokerAccountId: acc._id
                            })));
                        }
                    }
                } else if (broker === "GROWW" && (acc.credentials?.accessToken || (acc.credentials?.apiKey && acc.credentials?.apiSecret))) {
                    let token = acc.credentials?.accessToken ? decrypt(acc.credentials.accessToken) : "";
                    const apiKey = acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey) : "";
                    const apiSecret = acc.credentials?.apiSecret ? decrypt(acc.credentials.apiSecret) : "";

                    const isTokenExpired = acc.credentials?.tokenExpiresAt && new Date(acc.credentials.tokenExpiresAt) < new Date();
                    if ((!token || isTokenExpired) && apiKey && apiSecret) {
                        try {
                            const tokenRes = await GrowwAdapter.generateAccessToken({ apiKey, apiSecret });
                            token = tokenRes.accessToken;
                            acc.credentials.accessToken = encrypt(token);
                            acc.credentials.tokenExpiresAt = tokenRes.expiresAt;
                            acc.isConnected = true;
                            await acc.save().catch(() => {});
                        } catch {}
                    }

                    if (token) {
                        brokerAuth.growwToken = token;
                        const groww = new GrowwAdapter({ clientId: acc.credentials?.clientId, accessToken: token, apiKey, apiSecret });
                        const pos = await groww.getPositions().catch(() => []);
                        if (Array.isArray(pos)) {
                            brokerPositions.push(...pos.map(mapGrowwPosition).filter(Boolean).map(p => ({
                                ...p,
                                broker: "GROWW",
                                brokerAccountId: acc._id
                            })));
                        }
                    }
                } else if (broker === "ANGEL_ONE") {
                    const token = acc.credentials?.accessToken ? decrypt(acc.credentials.accessToken) : "";
                    const apiKey = acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey) : "";
                    const clientCode = acc.credentials?.clientId || "";
                    const password = acc.credentials?.password ? decrypt(acc.credentials.password) : (acc.credentials?.apiSecret ? decrypt(acc.credentials.apiSecret) : "");
                    const totpSecret = acc.credentials?.totpSecret ? decrypt(acc.credentials.totpSecret) : "";

                    if (token) {
                        brokerAuth.angelToken = token;
                        brokerAuth.angelApiKey = apiKey;
                        const angel = new AngelOneAdapter({ apiKey, clientCode, password, totpSecret, accessToken: token });
                        const pos = await angel.getPositions({ noAutoLogin: true }).catch(() => []);
                        if (Array.isArray(pos)) {
                            brokerPositions.push(...pos.map(mapAngelOnePosition).filter(Boolean).map(p => ({
                                ...p,
                                broker: "ANGEL_ONE",
                                brokerAccountId: acc._id
                            })));
                        }
                    }
                }
            } catch (err) {
                console.warn(`[BrokerSyncManager] Position fetch notice for ${broker}:`, err.message);
            }
        }

        return { brokerPositions, brokerAuth };
    }
}

export const brokerSyncManager = new BrokerSyncManager();
export default brokerSyncManager;
