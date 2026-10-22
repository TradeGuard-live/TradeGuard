import mongoose from "mongoose";
import axios from "axios";
import BrokerAccount from "../models/BrokerAccount.js";
import { syncUpstoxHistoricalTrades, syncUpstoxTodayTrades } from "../brokers/upstox/UpstoxSyncService.js";
import { syncDhanHistoricalTrades, syncDhanTodayTrades } from "../brokers/dhan/DhanSyncService.js";
import DhanAdapter from "../brokers/dhan/DhanAdapter.js";
import { syncAngelOneHistoricalTrades, syncAngelOneTodayTrades } from "../brokers/angelOne/AngelOneSyncService.js";
import AngelOneAdapter from "../brokers/angelOne/AngelOneAdapter.js";
import { decrypt, encrypt } from "../utils/encryption.js";

/**
 * Validates broker credentials against live broker API.
 * For Upstox, queries /user/profile with decrypted access token.
 * Updates isConnected in DB and returns boolean.
 */
export const verifyBrokerCredentials = async (brokerAccount) => {
    if (!brokerAccount) return false;

    if (brokerAccount.broker === "UPSTOX") {
        if (!brokerAccount.credentials?.accessToken) {
            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
            return false;
        }

        let token = null;
        try {
            token = decrypt(brokerAccount.credentials.accessToken);
        } catch (e) {
            token = brokerAccount.credentials.accessToken;
        }

        if (!token) {
            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
            return false;
        }

        try {
            const response = await axios.get("https://api.upstox.com/v2/user/profile", {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json"
                },
                timeout: 3000
            });

            if (response.status === 200 && response.data?.status === "success") {
                if (!brokerAccount.isConnected) {
                    brokerAccount.isConnected = true;
                    brokerAccount.lastConnectedAt = new Date();
                    await brokerAccount.save();
                }
                return true;
            } else {
                if (brokerAccount.isConnected) {
                    brokerAccount.isConnected = false;
                    await brokerAccount.save();
                }
                return false;
            }
        } catch (error) {
            // Token is invalid/expired (e.g. 401, 403, UDAPI100050)
            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
            return false;
        }
    }

    if (brokerAccount.broker === "DHAN") {
        if (!brokerAccount.credentials?.accessToken || !brokerAccount.credentials?.clientId) {
            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
            return false;
        }

        let token = null;
        try {
            token = decrypt(brokerAccount.credentials.accessToken);
        } catch {
            token = brokerAccount.credentials.accessToken;
        }

        if (!token) {
            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
            return false;
        }

        try {
            const dhan = new DhanAdapter({
                clientId: brokerAccount.credentials.clientId,
                accessToken: token
            });
            await dhan.getFundLimits();

            if (!brokerAccount.isConnected) {
                brokerAccount.isConnected = true;
                brokerAccount.lastConnectedAt = new Date();
                await brokerAccount.save();
            }
            return true;
        } catch (error) {
            const isAuthError =
                error.status === 401 ||
                error.status === 403 ||
                error.message?.toLowerCase().includes("token") ||
                error.message?.toLowerCase().includes("unauthorized") ||
                error.message?.toLowerCase().includes("session");

            if (isAuthError) {
                if (brokerAccount.isConnected) {
                    brokerAccount.isConnected = false;
                    await brokerAccount.save();
                }
                return false;
            }

            if (token && token.length >= 10 && brokerAccount.isActive) {
                if (!brokerAccount.isConnected) {
                    brokerAccount.isConnected = true;
                    brokerAccount.lastConnectedAt = new Date();
                    await brokerAccount.save();
                }
                return true;
            }

            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
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
            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
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

            // If token exists, test via getRMS or getProfile
            if (token) {
                try {
                    await adapter.getRMS();
                    if (!brokerAccount.isConnected) {
                        brokerAccount.isConnected = true;
                        brokerAccount.lastConnectedAt = new Date();
                        await brokerAccount.save();
                    }
                    return true;
                } catch {
                    // Token expired or invalid, continue below to attempt login if credentials exist
                }
            }

            // Attempt login if credentials are present
            if (clientCode && password && (totpSecret || apiKey)) {
                await adapter.login();
                if (adapter.jwtToken) {
                    brokerAccount.credentials.accessToken = adapter.jwtToken;
                    if (adapter.refreshToken) brokerAccount.credentials.refreshToken = adapter.refreshToken;
                    if (adapter.feedToken) brokerAccount.credentials.feedToken = adapter.feedToken;
                    brokerAccount.isConnected = true;
                    brokerAccount.lastConnectedAt = new Date();
                    await brokerAccount.save();
                    return true;
                }
            }

            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
            return false;
        } catch (error) {
            if (brokerAccount.isConnected) {
                brokerAccount.isConnected = false;
                await brokerAccount.save();
            }
            return false;
        }
    }

    // For other brokers
    if (!brokerAccount.credentials?.accessToken && !brokerAccount.credentials?.apiKey) {
        if (brokerAccount.isConnected) {
            brokerAccount.isConnected = false;
            await brokerAccount.save();
        }
        return false;
    }

    return Boolean(brokerAccount.isConnected);
};

// CREATE BROKER ACCOUNT
// POST /api/broker-accounts


const createBrokerAccount = async (req, res) => {
    try {
        const {
            userId,
            broker,
            credentials
        } = req.body;

        // Basic validation
        if (!userId || !broker || !credentials?.clientId) {
            return res.status(400).json({
                success: false,
                message: "userId, broker and clientId are required"
            });
        }

        // Check whether userId is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid userId"
            });
        }

        // Check if this user already has this broker
        const existingAccount = await BrokerAccount.findOne({
            userId,
            broker
        });

        if (existingAccount) {
            return res.status(409).json({
                success: false,
                message: `User already has a ${broker} account`
            });
        }

        const brokerAccount = new BrokerAccount({
            userId,
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

        const { userId } = req.query;

        const filter = {};

        if (userId) {
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid userId"
                });
            }

            filter.userId = userId;
        }

        const brokerAccounts = await BrokerAccount
            .find(filter)
            .sort({ createdAt: -1 });

        // Actively verify live connection status with broker API
        await Promise.all(
            brokerAccounts.map(account => verifyBrokerCredentials(account).catch(() => false))
        );

        // Sanitize sensitive credentials
        const sanitized = brokerAccounts.map(acc => {
            const doc = acc.toObject ? acc.toObject() : { ...acc };
            if (doc.credentials) {
                delete doc.credentials.apiKey;
                delete doc.credentials.apiSecret;
                delete doc.credentials.accessToken;
                delete doc.credentials.refreshToken;
                delete doc.credentials.password;
                delete doc.credentials.totpSecret;
                delete doc.credentials.feedToken;
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
            }

            if (credentials.feedToken !== undefined) {
                brokerAccount.credentials.feedToken =
                    credentials.feedToken;
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

        if (response.credentials) {
            delete response.credentials.apiKey;
            delete response.credentials.apiSecret;
            delete response.credentials.accessToken;
            delete response.credentials.refreshToken;
            delete response.credentials.password;
            delete response.credentials.totpSecret;
            delete response.credentials.feedToken;
        }

        return res.status(200).json({
            success: true,
            message: "Broker account updated successfully",
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
        const { brokerAccountId } = req.params;

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
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to sync trades"
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

        const isConnected = await verifyBrokerCredentials(brokerAccount);

        return res.status(200).json({
            success: true,
            isConnected,
            message: isConnected
                ? "Broker account credentials are valid and connected!"
                : "Broker access token is expired or invalid. Please update credentials."
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