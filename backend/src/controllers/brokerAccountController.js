import mongoose from "mongoose";
import axios from "axios";
import BrokerAccount from "../models/BrokerAccount.js";
import TradeRecord from "../models/TradeRecord.js";
import { syncUpstoxHistoricalTrades, syncUpstoxTodayTrades } from "../brokers/upstox/UpstoxSyncService.js";
import { syncDhanHistoricalTrades, syncDhanTodayTrades } from "../brokers/dhan/DhanSyncService.js";
import DhanAdapter from "../brokers/dhan/DhanAdapter.js";
import { syncAngelOneHistoricalTrades, syncAngelOneTodayTrades } from "../brokers/angelOne/AngelOneSyncService.js";
import AngelOneAdapter from "../brokers/angelOne/AngelOneAdapter.js";
import { syncKotakNeoHistoricalTrades, syncKotakNeoTodayTrades } from "../brokers/kotakNeo/KotakNeoSyncService.js";
import KotakNeoAdapter from "../brokers/kotakNeo/KotakNeoAdapter.js";
import GrowwAdapter from "../brokers/groww/GrowwAdapter.js";
import { syncGrowwTrades, syncGrowwHistoricalTrades, syncGrowwTodayTrades } from "../brokers/groww/GrowwSyncService.js";
import ZerodhaAdapter from "../brokers/zerodha/ZerodhaAdapter.js";
import { syncZerodhaTrades, syncZerodhaHistoricalTrades, syncZerodhaTodayTrades } from "../brokers/zerodha/ZerodhaSyncService.js";
import { decrypt, encrypt } from "../utils/encryption.js";

/**
 * Validates broker credentials against live broker API.
 * For Upstox, queries /user/profile with decrypted access token.
 * Updates isConnected in DB and returns boolean.
 */
export const verifyBrokerCredentials = async (brokerAccount) => {
    if (!brokerAccount) return false;

    // Handle Mock simulation broker
    if (brokerAccount.broker === "MOCK") {
        brokerAccount.isConnected = true;
        brokerAccount.verificationError = null;
        brokerAccount.lastConnectedAt = new Date();
        await brokerAccount.save();
        return true;
    }

    if (brokerAccount.broker === "UPSTOX") {
        if (!brokerAccount.credentials?.accessToken) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Upstox access token is missing. Please generate or enter a valid access token.";
            await brokerAccount.save();
            return false;
        }

        let token = null;
        try {
            token = decrypt(brokerAccount.credentials.accessToken);
        } catch (e) {
            token = brokerAccount.credentials.accessToken;
        }

        if (!token) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Failed to decrypt Upstox access token.";
            await brokerAccount.save();
            return false;
        }

        try {
            const response = await axios.get("https://api.upstox.com/v2/user/profile", {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json"
                },
                timeout: 5000
            });

            if (response.status === 200 && response.data?.status === "success") {
                brokerAccount.isConnected = true;
                brokerAccount.verificationError = null;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
                return true;
            } else {
                brokerAccount.isConnected = false;
                brokerAccount.verificationError = response.data?.message || "Upstox profile verification failed.";
                await brokerAccount.save();
                return false;
            }
        } catch (error) {
            brokerAccount.isConnected = false;
            const errMsg = error.response?.data?.message || error.response?.data?.errors?.[0]?.message || error.message;
            brokerAccount.verificationError = `Upstox API Error: ${errMsg}`;
            await brokerAccount.save();
            return false;
        }
    }

    if (brokerAccount.broker === "DHAN") {
        if (!brokerAccount.credentials?.accessToken || !brokerAccount.credentials?.clientId) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Dhan Client ID and Access Token are required.";
            await brokerAccount.save();
            return false;
        }

        let token = null;
        try {
            token = decrypt(brokerAccount.credentials.accessToken);
        } catch {
            token = brokerAccount.credentials.accessToken;
        }

        if (!token) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Failed to decrypt Dhan access token.";
            await brokerAccount.save();
            return false;
        }

        try {
            const dhan = new DhanAdapter({
                clientId: brokerAccount.credentials.clientId,
                accessToken: token
            });
            await dhan.getFundLimits();

            brokerAccount.isConnected = true;
            brokerAccount.verificationError = null;
            brokerAccount.lastConnectedAt = new Date();
            await brokerAccount.save();
            return true;
        } catch (error) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = error.message;
            await brokerAccount.save();
            return false;
        }
    }

    if (brokerAccount.broker === "ANGEL_ONE") {
        let token = null;
        if (brokerAccount.credentials?.accessToken) {
            try {
                token = decrypt(brokerAccount.credentials.accessToken);
            } catch {
                token = brokerAccount.credentials.accessToken;
            }
        }

        const apiKey = brokerAccount.credentials?.apiKey ? decrypt(brokerAccount.credentials.apiKey) : "";
        const clientCode = brokerAccount.credentials?.clientId || "";
        const password = brokerAccount.credentials?.password 
            ? decrypt(brokerAccount.credentials.password) 
            : (brokerAccount.credentials?.apiSecret ? decrypt(brokerAccount.credentials.apiSecret) : "");
        const totpSecret = brokerAccount.credentials?.totpSecret 
            ? decrypt(brokerAccount.credentials.totpSecret) 
            : "";
        const refreshToken = brokerAccount.credentials?.refreshToken 
            ? decrypt(brokerAccount.credentials.refreshToken) 
            : "";

        // If no token and not enough credentials to perform login, set disconnected
        if (!token && (!clientCode || !password || (!totpSecret && !apiKey))) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Missing required Angel One credentials (Client Code, Password, and API Key / TOTP).";
            await brokerAccount.save();
            return false;
        }

        try {
            const adapter = new AngelOneAdapter({
                apiKey,
                clientCode,
                password,
                totpSecret,
                accessToken: token,
                refreshToken
            });

            // If token exists, test via getRMS with noAutoLogin
            let tokenValid = false;
            if (token) {
                try {
                    await adapter.getRMS({ noAutoLogin: true });
                    tokenValid = true;
                    brokerAccount.isConnected = true;
                    brokerAccount.verificationError = null;
                    brokerAccount.lastConnectedAt = new Date();
                    await brokerAccount.save();
                    return true;
                } catch {
                    // Token expired or invalid, continue below to attempt login if credentials exist
                }
            }

            // Attempt login if credentials are present and token was invalid
            if (!tokenValid && clientCode && password && (totpSecret || apiKey)) {
                await adapter.login();
                if (adapter.jwtToken) {
                    brokerAccount.credentials.accessToken = adapter.jwtToken;
                    if (adapter.refreshToken) brokerAccount.credentials.refreshToken = adapter.refreshToken;
                    if (adapter.feedToken) brokerAccount.credentials.feedToken = adapter.feedToken;
                    brokerAccount.isConnected = true;
                    brokerAccount.verificationError = null;
                    brokerAccount.lastConnectedAt = new Date();
                    await brokerAccount.save();
                    return true;
                }
            }

            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Angel One session is expired or credentials are invalid.";
            await brokerAccount.save();
            return false;
        } catch (error) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = error.message;
            await brokerAccount.save();
            return false;
        }
    }

    if (brokerAccount.broker === "KOTAK_NEO") {
        let token = null;
        if (brokerAccount.credentials?.accessToken) {
            try {
                token = decrypt(brokerAccount.credentials.accessToken);
            } catch {
                token = brokerAccount.credentials.accessToken;
            }
        }

        const apiKey = brokerAccount.credentials?.apiKey ? (decrypt(brokerAccount.credentials.apiKey) || (!brokerAccount.credentials.apiKey.startsWith("v1:") && !brokerAccount.credentials.apiKey.startsWith("U2FsdGVk") ? brokerAccount.credentials.apiKey : "")) : "";
        const clientCode = brokerAccount.credentials?.clientId || "";
        const mobileNumber = brokerAccount.credentials?.mobileNumber ? (decrypt(brokerAccount.credentials.mobileNumber) || (!brokerAccount.credentials.mobileNumber.startsWith("v1:") && !brokerAccount.credentials.mobileNumber.startsWith("U2FsdGVk") ? brokerAccount.credentials.mobileNumber : "")) : "";
        const rawPass = brokerAccount.credentials?.password || brokerAccount.credentials?.apiSecret || "";
        const password = rawPass ? (decrypt(rawPass) || (!rawPass.startsWith("v1:") && !rawPass.startsWith("U2FsdGVk") ? rawPass : "")) : "";
        const rawTotp = brokerAccount.credentials?.totpSecret || "";
        const totpSecret = rawTotp ? (decrypt(rawTotp) || (!rawTotp.startsWith("v1:") && !rawTotp.startsWith("U2FsdGVk") ? rawTotp : "")) : "";
        const rawSid = brokerAccount.credentials?.sid || brokerAccount.credentials?.feedToken || "";
        const sid = rawSid ? (decrypt(rawSid) || (!rawSid.startsWith("v1:") && !rawSid.startsWith("U2FsdGVk") ? rawSid : "")) : "";
        const baseUrl = brokerAccount.credentials?.baseUrl || "https://cis.kotaksecurities.com";

        // If no token and not enough credentials to perform login, set disconnected
        if (!token && (!clientCode || !password || !mobileNumber || (!totpSecret && !apiKey))) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Missing required credentials for Kotak Neo login (Client ID, Password, Mobile, TOTP/API Key).";
            await brokerAccount.save();
            return false;
        }

        try {
            const adapter = new KotakNeoAdapter({
                apiKey,
                clientId: clientCode,
                mobileNumber,
                password,
                totpSecret,
                accessToken: token,
                sid,
                baseUrl
            });

            // If token exists, test via getFundLimits with noAutoLogin: true
            let tokenValid = false;
            if (token) {
                try {
                    await adapter.getFundLimits({ noAutoLogin: true });
                    tokenValid = true;
                    brokerAccount.isConnected = true;
                    brokerAccount.verificationError = null;
                    brokerAccount.lastConnectedAt = new Date();
                    await brokerAccount.save();
                    return true;
                } catch (tErr) {
                    // Token expired, continue to login attempt below
                    console.log("[Kotak Neo] Session token expired/invalid, attempting fresh login:", tErr.message);
                }
            }

            // Attempt login if credentials are present and token was not valid
            if (!tokenValid && clientCode && password && mobileNumber && (totpSecret || apiKey)) {
                try {
                    await adapter.login();
                    if (adapter.tradingToken) {
                        brokerAccount.credentials.accessToken = adapter.tradingToken;
                        if (adapter.tradingSid) brokerAccount.credentials.sid = adapter.tradingSid;
                        if (adapter.baseUrl) brokerAccount.credentials.baseUrl = adapter.baseUrl;
                        brokerAccount.isConnected = true;
                        brokerAccount.verificationError = null;
                        brokerAccount.lastConnectedAt = new Date();
                        await brokerAccount.save();
                        return true;
                    }
                } catch (loginErr) {
                    console.warn("[Kotak Neo] Login failed:", loginErr.message);
                    const isStaticOtp = totpSecret && /^\d{6}$/.test(String(totpSecret).trim());
                    brokerAccount.isConnected = false;
                    if (isStaticOtp && (loginErr.message.includes("10506") || /totp|otp|expired|invalid/i.test(loginErr.message))) {
                        brokerAccount.verificationError = "Kotak Neo login failed: The 6-digit TOTP code from Google Authenticator has expired or is invalid. Please enter a fresh 6-digit code from your app, or use your permanent Base32 Setup Secret Key.";
                    } else {
                        brokerAccount.verificationError = loginErr.message;
                    }
                    await brokerAccount.save();
                    return false;
                }
            }

            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Missing required credentials for Kotak Neo login (Client ID, MPIN, Mobile, and TOTP code / Neo API Token).";
            await brokerAccount.save();
            return false;
        } catch (error) {
            console.error("Kotak Neo verify error:", error.message);
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = error.message;
            await brokerAccount.save();
            return false;
        }
    }


    // ✅ GROWW CREDENTIAL VERIFICATION & SESSION VALIDATION
    if (brokerAccount.broker === "GROWW") {
        let token = null;
        if (brokerAccount.credentials?.accessToken) {
            try {
                token = decrypt(brokerAccount.credentials.accessToken);
            } catch {
                token = brokerAccount.credentials.accessToken;
            }
        }

        const apiKey = brokerAccount.credentials?.apiKey ? decrypt(brokerAccount.credentials.apiKey) : "";
        const apiSecret = brokerAccount.credentials?.apiSecret ? decrypt(brokerAccount.credentials.apiSecret) : "";

        // If accessToken is missing or expired, attempt auto-generation via API Key + API Secret (approval flow)
        const isTokenExpired = brokerAccount.credentials?.tokenExpiresAt && new Date(brokerAccount.credentials.tokenExpiresAt) < new Date();
        if ((!token || isTokenExpired) && apiKey && apiSecret) {
            try {
                const tokenRes = await GrowwAdapter.generateAccessToken({ apiKey, apiSecret });
                token = tokenRes.accessToken;
                brokerAccount.credentials.accessToken = encrypt(token);
                brokerAccount.credentials.tokenExpiresAt = tokenRes.expiresAt;
            } catch (authGenErr) {
                console.warn("[Groww] Auto token exchange failed:", authGenErr.message);
                if (!token) {
                    brokerAccount.isConnected = false;
                    brokerAccount.verificationError = authGenErr.message;
                    await brokerAccount.save();
                    return false;
                }
            }
        }

        if (!token) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Groww Access Token or API Key & Secret are required.";
            await brokerAccount.save();
            return false;
        }

        try {
            const groww = new GrowwAdapter({
                clientId: brokerAccount.credentials?.clientId,
                accessToken: token,
                apiKey,
                apiSecret
            });

            // ✅ Verify session against live Groww profile endpoint GET /v1/user/detail
            const profile = await groww.getProfile();
            if (profile && (profile.ucc || profile.vendor_user_id || profile.nse_enabled !== undefined)) {
                brokerAccount.isConnected = true;
                brokerAccount.verificationError = null;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
                return true;
            }

            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Groww profile verification returned incomplete data.";
            await brokerAccount.save();
            return false;
        } catch (error) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = error.message;
            await brokerAccount.save();
            return false;
        }
    }

    // ✅ ZERODHA (Kite Connect v3) CREDENTIAL VERIFICATION & SESSION VALIDATION
    if (brokerAccount.broker === "ZERODHA") {
        let token = null;
        if (brokerAccount.credentials?.accessToken) {
            try {
                token = decrypt(brokerAccount.credentials.accessToken);
            } catch {
                token = brokerAccount.credentials.accessToken;
            }
        }

        const apiKey = brokerAccount.credentials?.apiKey ? decrypt(brokerAccount.credentials.apiKey) : "";
        const apiSecret = brokerAccount.credentials?.apiSecret ? decrypt(brokerAccount.credentials.apiSecret) : "";
        let requestToken = brokerAccount.credentials?.totpSecret ? decrypt(brokerAccount.credentials.totpSecret) : "";

        // If accessToken is missing or expired, but apiKey, apiSecret, and requestToken are provided, attempt auto-exchange
        const isTokenExpired = brokerAccount.credentials?.tokenExpiresAt && new Date(brokerAccount.credentials.tokenExpiresAt) < new Date();
        if ((!token || isTokenExpired) && apiKey && apiSecret && requestToken) {
            try {
                const tokenRes = await ZerodhaAdapter.generateAccessToken({ apiKey, apiSecret, requestToken });
                token = tokenRes.accessToken;
                brokerAccount.credentials.accessToken = encrypt(token);
                const tomorrow6AM = new Date();
                tomorrow6AM.setDate(tomorrow6AM.getDate() + 1);
                tomorrow6AM.setHours(6, 0, 0, 0);
                brokerAccount.credentials.tokenExpiresAt = tomorrow6AM;
                brokerAccount.isConnected = true;
                brokerAccount.verificationError = null;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
            } catch (authGenErr) {
                console.warn("[Zerodha] Auto token exchange failed:", authGenErr.message);
                if (!token) {
                    brokerAccount.isConnected = false;
                    brokerAccount.verificationError = authGenErr.message;
                    await brokerAccount.save();
                    return false;
                }
            }
        }

        if (!token && !apiKey) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Zerodha API Key and Access Token (or API Secret + Request Token) are required.";
            await brokerAccount.save();
            return false;
        }

        try {
            const zerodha = new ZerodhaAdapter({
                apiKey,
                accessToken: token,
                apiSecret,
                clientId: brokerAccount.credentials?.clientId
            });

            // ✅ Verify session against live Kite user profile endpoint GET /user/profile
            const profile = await zerodha.getProfile();
            if (profile && (profile.user_id || profile.user_name || profile.broker === "ZERODHA")) {
                brokerAccount.isConnected = true;
                brokerAccount.verificationError = null;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
                return true;
            }

            brokerAccount.isConnected = false;
            brokerAccount.verificationError = "Zerodha Kite profile verification returned invalid data.";
            await brokerAccount.save();
            return false;
        } catch (error) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = error.message;
            await brokerAccount.save();
            return false;
        }
    }

    // For other brokers
    if (!brokerAccount.credentials?.accessToken && !brokerAccount.credentials?.apiKey) {
        brokerAccount.isConnected = false;
        brokerAccount.verificationError = "Missing credentials for broker account.";
        await brokerAccount.save();
        return false;
    }

    return Boolean(brokerAccount.isConnected);
};

// CREATE BROKER ACCOUNT
// POST /api/broker-accounts


const createBrokerAccount = async (req, res) => {
    try {
        // ✅ Enforce authenticated user identity from verified JWT
        const effectiveUserId = req.user?.userId ? String(req.user.userId) : null;
        if (!effectiveUserId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Valid authentication required"
            });
        }

        // Prevent cross-user account creation via payload injection
        if (req.body.userId && String(req.body.userId) !== effectiveUserId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Cannot create broker accounts for other users"
            });
        }

        const {
            broker,
            credentials
        } = req.body;

        // Basic validation
        if (!broker || !credentials?.clientId) {
            return res.status(400).json({
                success: false,
                message: "broker and clientId are required"
            });
        }

        // ✅ Kotak Neo active integration is deprecated and disabled for new connections
        if (broker === "KOTAK_NEO") {
            return res.status(400).json({
                success: false,
                message: "Kotak Neo active broker integration is deprecated and disabled. Existing historical records remain accessible for reports and analytics."
            });
        }

        // Check whether userId is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(effectiveUserId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid userId"
            });
        }

        // Check if this user already has this broker
        const existingAccount = await BrokerAccount.findOne({
            userId: effectiveUserId,
            broker
        });

        if (existingAccount) {
            return res.status(409).json({
                success: false,
                message: `User already has a ${broker} account`
            });
        }

        const brokerAccount = new BrokerAccount({
            userId: effectiveUserId,
            broker,
            credentials
        });

        // Save through Mongoose
        // This triggers pre("save")
        await brokerAccount.save();

         if (brokerAccount.broker === "UPSTOX") {
        //     console.log(
        //         "Starting Upstox stream for account:",
        //         brokerAccount._id.toString()
        //     );
        //    await startUpstoxStream(brokerAccount._id);
        //    console.log(
        //      "Upstox stream started for account:",
        //      brokerAccount._id.toString()
        //    );
        //    const { startDate, endDate } = getCurrentFinancialYearRange();

        //     console.log(
        //         `Syncing Upstox financial year data: ${startDate} to ${endDate}`
        //     );

            
         }

        // DEBUG
        console.log(
            "BrokerAccount collection:",
            BrokerAccount.collection.name
        );

        console.log(
            "BrokerAccount database:",
            BrokerAccount.db.name
        );

        console.log(
            "BrokerAccount count:",
            await BrokerAccount.countDocuments()
        );

        // Auto-verify/connect credentials if provided
        try {
            await verifyBrokerCredentials(brokerAccount);
        } catch (vErr) {
            console.warn("Auto-verify during create:", vErr.message);
        }

        // Don't send encrypted credentials back to frontend
        const response = brokerAccount.toObject();

        if (response.credentials) {
            delete response.credentials.apiKey;
            delete response.credentials.apiSecret;
            delete response.credentials.accessToken;
            delete response.credentials.refreshToken;
            delete response.credentials.password;
            delete response.credentials.totpSecret;
            delete response.credentials.feedToken;
            delete response.credentials.mobileNumber;
            delete response.credentials.sid;
        }

        return res.status(201).json({
            success: true,
            message: "Broker account created successfully",
            data: response
        });

    } catch (error) {

        console.error("Create Broker Account Error:", error);

        return res.status(500).json({
            success: false,
            message: error.message,
            error: error.name
        });
    }
};


// GET ALL BROKER ACCOUNTS
// GET /api/broker-accounts

const getBrokerAccounts = async (req, res) => {
    try {
        // ✅ Enforce ownership from verified JWT token to prevent IDOR
        const userId = req.user?.userId ? String(req.user.userId) : null;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Valid authentication required"
            });
        }

        if (req.query.userId && String(req.query.userId) !== userId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Access denied to other users' broker accounts"
            });
        }

        const filter = { userId };

        const brokerAccounts = await BrokerAccount
            .find(filter)
            .sort({ createdAt: -1 });

        // Only verify live connection status if explicitly requested (e.g. ?verify=true)
        if (req.query.verify === "true" || req.query.verify === true) {
            await Promise.all(
                brokerAccounts.map(account => verifyBrokerCredentials(account).catch(() => false))
            );
        }

        // Sanitize sensitive credentials
        const sanitized = brokerAccounts.map(acc => {
            const doc = acc.toObject ? acc.toObject() : { ...acc };
            doc.verificationError = acc.verificationError || acc._verificationError || null;
            if (doc.credentials) {
                delete doc.credentials.apiKey;
                delete doc.credentials.apiSecret;
                delete doc.credentials.accessToken;
                delete doc.credentials.refreshToken;
                delete doc.credentials.password;
                delete doc.credentials.totpSecret;
                delete doc.credentials.feedToken;
                delete doc.credentials.mobileNumber;
                delete doc.credentials.sid;
            }
            return doc;
        });

        return res.status(200).json({
            success: true,
            count: sanitized.length,
            data: sanitized
        });


    } catch (error) {

        console.error("Get Broker Accounts Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch broker accounts"
        });
    }
};


// GET ONE BROKER ACCOUNT
// GET /api/broker-accounts/:id

const getBrokerAccount = async (req, res) => {
    try {

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid broker account ID"
            });
        }

        const brokerAccount = await BrokerAccount
            .findById(id)
            .select(
                "-credentials.apiKey " +
                "-credentials.apiSecret " +
                "-credentials.accessToken " +
                "-credentials.refreshToken " +
                "-credentials.password " +
                "-credentials.totpSecret " +
                "-credentials.feedToken"
            );

        if (!brokerAccount) {
            return res.status(404).json({
                success: false,
                message: "Broker account not found"
            });
        }

        // ✅ Verify account ownership
        const userId = req.user?.userId ? String(req.user.userId) : null;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Valid authentication required"
            });
        }
        if (String(brokerAccount.userId) !== userId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Access denied"
            });
        }

        return res.status(200).json({
            success: true,
            data: brokerAccount
        });

    } catch (error) {

        console.error("Get Broker Account Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch broker account"
        });
    }
};


// UPDATE BROKER ACCOUNT
// PUT /api/broker-accounts/:id

const updateBrokerAccount = async (req, res) => {
    try {

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid broker account ID"
            });
        }

        const brokerAccount = await BrokerAccount.findById(id);

        if (!brokerAccount) {
            return res.status(404).json({
                success: false,
                message: "Broker account not found"
            });
        }

        // ✅ Verify account ownership
        const userId = req.user?.userId ? String(req.user.userId) : null;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Valid authentication required"
            });
        }
        if (String(brokerAccount.userId) !== userId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Access denied"
            });
        }

        const {
            broker,
            credentials,
            isActive,
            isConnected,
            lastConnectedAt
        } = req.body;

        // Update broker
        if (broker) {
            brokerAccount.broker = broker;
        }

        // Update credentials
        if (credentials) {

            if (credentials.clientId !== undefined) {
                brokerAccount.credentials.clientId =
                    credentials.clientId;
            }

            if (credentials.apiKey !== undefined) {
                brokerAccount.credentials.apiKey =
                    credentials.apiKey;
            }

            if (credentials.apiSecret !== undefined) {
                brokerAccount.credentials.apiSecret =
                    credentials.apiSecret;
            }

            if (credentials.accessToken !== undefined) {
                brokerAccount.credentials.accessToken =
                    credentials.accessToken;
            }

            if (credentials.refreshToken !== undefined) {
                brokerAccount.credentials.refreshToken =
                    credentials.refreshToken;
            }

            if (credentials.tokenExpiresAt !== undefined) {
                brokerAccount.credentials.tokenExpiresAt =
                    credentials.tokenExpiresAt;
            }

            if (credentials.password !== undefined) {
                brokerAccount.credentials.password =
                    credentials.password;
            }

            if (credentials.totpSecret !== undefined) {
                brokerAccount.credentials.totpSecret =
                    credentials.totpSecret;
                // If user entered a new TOTP or 6-digit code and did not supply a manual accessToken,
                // clear stale accessToken so fresh login with the new TOTP executes immediately
                if (!credentials.accessToken) {
                    brokerAccount.credentials.accessToken = "";
                }
            }


            if (credentials.mobileNumber !== undefined) {
                brokerAccount.credentials.mobileNumber =
                    credentials.mobileNumber;
            }

            if (credentials.sid !== undefined) {
                brokerAccount.credentials.sid =
                    credentials.sid;
            }
        }

        // Update active status
        if (isActive !== undefined) {
            brokerAccount.isActive = isActive;
        }

        // Update connection status
        if (isConnected !== undefined) {
            brokerAccount.isConnected = isConnected;
        }

        // Update last connected timestamp
        if (lastConnectedAt !== undefined) {
            brokerAccount.lastConnectedAt = lastConnectedAt;
        }

        // save() triggers encryption middleware
        await brokerAccount.save();

        // Auto-verify connection if credentials are present
        try {
            await verifyBrokerCredentials(brokerAccount);
        } catch (vErr) {
            console.warn("Auto-verify during update:", vErr.message);
        }

        const response = brokerAccount.toObject();
        response.isConnected = brokerAccount.isConnected;
        response.verificationError = brokerAccount._verificationError || null;

        if (response.credentials) {
            delete response.credentials.apiKey;
            delete response.credentials.apiSecret;
            delete response.credentials.accessToken;
            delete response.credentials.refreshToken;
            delete response.credentials.password;
            delete response.credentials.totpSecret;
            delete response.credentials.feedToken;
            delete response.credentials.mobileNumber;
            delete response.credentials.sid;
        }

        return res.status(200).json({
            success: true,
            message: brokerAccount.isConnected
                ? "Broker account updated and connected successfully!"
                : (brokerAccount._verificationError
                    ? `Broker account updated, but connection failed: ${brokerAccount._verificationError}`
                    : "Broker account updated successfully"),
            data: response
        });

    } catch (error) {

        console.error("Update Broker Account Error:", error);

        // Duplicate user + broker
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "User already has this broker account"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to update broker account"
        });
    }
};


// DELETE BROKER ACCOUNT
// DELETE /api/broker-accounts/:id

const deleteBrokerAccount = async (req, res) => {
    try {
        const brokerAccountId = req.params.brokerAccountId || req.params.id;

        if (!brokerAccountId) {
            return res.status(400).json({
                message: "brokerAccountId is required"
            });
        }

        // Find broker account first
        const brokerAccount = await BrokerAccount.findById(
            brokerAccountId
        );

        if (!brokerAccount) {
            return res.status(404).json({
                message: "Broker account not found"
            });
        }

        // ✅ Verify account ownership before deletion
        const userId = req.user?.userId ? String(req.user.userId) : null;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Valid authentication required"
            });
        }
        if (String(brokerAccount.userId) !== userId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Access denied"
            });
        }

        // IMPORTANT:
        // Delete all TradeRecords belonging to this broker account
        const deletedTrades = await TradeRecord.deleteMany({
            brokerAccountId: brokerAccount._id
        });

        console.log(
            `Deleted ${deletedTrades.deletedCount} trade records`
        );

        // Delete broker account
        await BrokerAccount.findByIdAndDelete(
            brokerAccount._id
        );

        return res.status(200).json({
            success: true,
            message: "Broker account and its trade records deleted successfully",
            deletedTradeRecords: deletedTrades.deletedCount
        });

    } catch (error) {
        console.error(
            "Delete broker account error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to delete broker account",
            error: error.message
        });
    }
};

// SYNC BROKER TRADES
// POST /api/broker-accounts/:id/sync

const syncBrokerTrades = async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid broker account ID"
            });
        }

        const brokerAccount = await BrokerAccount.findById(id);

        if (!brokerAccount) {
            return res.status(404).json({
                success: false,
                message: "Broker account not found"
            });
        }

        // ✅ Verify account ownership
        const userId = req.user?.userId ? String(req.user.userId) : null;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Valid authentication required"
            });
        }
        if (String(brokerAccount.userId) !== userId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Access denied"
            });
        }

        if (!brokerAccount.isConnected) {
            return res.status(400).json({
                success: false,
                message: "Broker account is not connected"
            });
        }

        let result;

        if (brokerAccount.broker === "UPSTOX") {
            if (startDate && endDate) {
                result = await syncUpstoxHistoricalTrades({
                    brokerAccountId: id,
                    startDate,
                    endDate
                });
            } else {
                const now = new Date();
                const curFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
                // Query both current and previous financial years so historical trades across years are fetched
                const ranges = [
                    { start: `${curFY - 1}-04-01`, end: `${curFY}-03-31` },
                    { start: `${curFY}-04-01`, end: `${curFY + 1}-03-31` }
                ];
                let totalInserted = 0;
                let totalUpdated = 0;
                let totalSkipped = 0;
                let totalFetched = 0;

                for (const r of ranges) {
                    try {
                        const rRes = await syncUpstoxHistoricalTrades({
                            brokerAccountId: id,
                            startDate: r.start,
                            endDate: r.end
                        });
                        totalInserted += rRes?.inserted || 0;
                        totalUpdated += rRes?.updated || 0;
                        totalSkipped += rRes?.skipped || 0;
                        totalFetched += rRes?.totalFetched || rRes?.total || 0;
                    } catch (rErr) {
                        console.warn(`[Upstox Sync] Notice for FY ${r.start} - ${r.end}:`, rErr.message);
                    }
                }
                // Also sync today's live trades from Upstox
                try {
                    const todayRes = await syncUpstoxTodayTrades({ brokerAccountId: id });
                    totalInserted += todayRes?.inserted || 0;
                    totalUpdated += todayRes?.updated || 0;
                    totalSkipped += todayRes?.skipped || 0;
                    totalFetched += todayRes?.todayFetched || 0;
                } catch (tErr) {
                    console.warn(`[Upstox Sync] Notice for today's trades:`, tErr.message);
                }

                result = {
                    inserted: totalInserted,
                    updated: totalUpdated,
                    skipped: totalSkipped,
                    total: totalFetched
                };
            }
        } else if (brokerAccount.broker === "DHAN") {
            const now = new Date();
            const curFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
            const start = startDate || `${curFY - 1}-04-01`;
            const end = endDate || now.toISOString().split("T")[0];

            result = await syncDhanHistoricalTrades({
                brokerAccountId: id,
                startDate: start,
                endDate: end
            });
        } else if (brokerAccount.broker === "ANGEL_ONE") {
            if (startDate && endDate) {
                result = await syncAngelOneHistoricalTrades({
                    brokerAccountId: id,
                    startDate,
                    endDate
                });
            } else {
                result = await syncAngelOneTodayTrades({
                    brokerAccountId: id
                });
            }
        } else if (brokerAccount.broker === "KOTAK_NEO") {
            if (startDate && endDate) {
                result = await syncKotakNeoHistoricalTrades({
                    brokerAccountId: id,
                    startDate,
                    endDate
                });
            } else {
                result = await syncKotakNeoTodayTrades({
                    brokerAccountId: id
                });
            }
        } else if (brokerAccount.broker === "GROWW") {
            // ✅ Sync trades from Groww CASH and FNO segments
            result = await syncGrowwTrades({
                brokerAccountId: id,
                startDate,
                endDate
            });
        } else if (brokerAccount.broker === "ZERODHA") {
            // ✅ Sync trades from Zerodha Kite Connect v3
            result = await syncZerodhaTrades({
                brokerAccountId: id,
                startDate,
                endDate
            });
        } else {
            return res.status(400).json({
                success: false,
                message: `Sync not implemented for broker: ${brokerAccount.broker}`
            });
        }

        // Update last connected timestamp
        brokerAccount.lastConnectedAt = new Date();
        await brokerAccount.save();

        return res.status(200).json({
            success: true,
            message: "Trades synced successfully",
            data: result
        });

    } catch (error) {
        console.error("Sync Broker Trades Error:", error);

        // If the error is an auth / token / 401 / 403 error, mark account disconnected immediately
        const isAuthError =
            error.status === 401 ||
            error.status === 403 ||
            error.response?.status === 401 ||
            error.response?.status === 403 ||
            /401|403|token|unauthorized|expired|invalid.*token|session.*expired|access.*token.*invalid/i.test(error.message);

        if (brokerAccount && isAuthError) {
            brokerAccount.isConnected = false;
            brokerAccount.verificationError = error.message;
            await brokerAccount.save().catch(() => {});
        }

        return res.status(isAuthError ? 401 : 500).json({
            success: false,
            message: error.message || "Failed to sync trades",
            isConnected: false,
            verificationError: brokerAccount?.verificationError || error.message
        });
    }
};

// VERIFY LIVE BROKER ACCOUNT STATUS ON DEMAND
// POST /api/broker-accounts/:id/verify
const verifyBrokerAccount = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid broker account ID"
            });
        }

        const brokerAccount = await BrokerAccount.findById(id);
        if (!brokerAccount) {
            return res.status(404).json({
                success: false,
                message: "Broker account not found"
            });
        }

        // ✅ Verify account ownership
        const userId = req.user?.userId ? String(req.user.userId) : null;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Valid authentication required"
            });
        }
        if (String(brokerAccount.userId) !== userId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Access denied"
            });
        }

        // ✅ Allow passing fresh TOTP code in verify request body
        if (req.body?.totp || req.body?.totpSecret) {
            brokerAccount.credentials.totpSecret = String(req.body.totp || req.body.totpSecret).trim();
            brokerAccount.credentials.accessToken = "";
            await brokerAccount.save();
        }


        const isConnected = await verifyBrokerCredentials(brokerAccount);


        return res.status(200).json({
            success: true,
            isConnected,
            verificationError: brokerAccount.verificationError || brokerAccount._verificationError || null,
            message: isConnected
                ? "Broker account credentials are valid and connected!"
                : (brokerAccount.verificationError || brokerAccount._verificationError || "Broker access token is expired or invalid. Please update credentials.")
        });
    } catch (error) {
        console.error("Verify broker account error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to verify broker account"
        });
    }
};

// ES MODULE EXPORTS
export {
    createBrokerAccount,
    getBrokerAccounts,
    getBrokerAccount,
    updateBrokerAccount,
    deleteBrokerAccount,
    syncBrokerTrades,
    verifyBrokerAccount
};