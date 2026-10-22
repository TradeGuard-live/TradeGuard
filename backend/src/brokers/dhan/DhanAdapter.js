import axios from "axios";

/**
 * DhanAdapter.js
 * Official DhanHQ API v2 Client implementation.
 * Supports both Production (https://api.dhan.co/v2) and Sandbox (https://sandbox.dhan.co/v2).
 */
class DhanAdapter {
    constructor({ clientId, accessToken }) {
        if (!accessToken) {
            throw new Error("Dhan access token is required");
        }

        this.accessToken = String(accessToken).trim();
        let effectiveClientId = String(clientId || "").trim();

        // Automatically extract dhanClientId from JWT token payload if available
        try {
            const parts = this.accessToken.split(".");
            if (parts.length >= 2) {
                const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
                if (payload?.dhanClientId) {
                    effectiveClientId = String(payload.dhanClientId).trim();
                }
            }
        } catch {
            // Keep provided clientId
        }

        this.clientId = effectiveClientId || String(clientId).trim();
        this.baseURL = "https://api.dhan.co/v2";
        this.sandboxURL = "https://sandbox.dhan.co/v2";

        this.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "access-token": this.accessToken,
            "client-id": this.clientId,
            "dhanClientId": this.clientId
        };

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 10000,
            headers: this.headers
        });
    }

    async _request(method, path, options = {}) {
        try {
            return await this.client.request({
                method,
                url: path,
                ...options
            });
        } catch (error) {
            // Check if live rejected the token with DH-906 or auth error, and retry against sandbox
            const isInvalidToken = 
                error.response?.data?.errorCode === "DH-906" || 
                error.response?.status === 400 || 
                error.response?.status === 401;

            if (isInvalidToken && !options._retriedSandbox) {
                try {
                    const sandboxClient = axios.create({
                        baseURL: this.sandboxURL,
                        timeout: 10000,
                        headers: this.headers
                    });
                    const res = await sandboxClient.request({
                        method,
                        url: path,
                        ...options,
                        _retriedSandbox: true
                    });
                    this.baseURL = this.sandboxURL;
                    this.client = sandboxClient;
                    return res;
                } catch (sandboxErr) {
                    if (sandboxErr.response?.data?.errorType || (sandboxErr.response?.status && sandboxErr.response.status !== 401 && sandboxErr.response.status !== 400)) {
                        this.baseURL = this.sandboxURL;
                        const sStatus = sandboxErr.response?.status;
                        const sData = sandboxErr.response?.data;
                        const sMsg = sData?.errorMessage || sData?.message || sData?.errorType || sandboxErr.message;
                        const customError = new Error(`Dhan API Error (${sStatus || "Network"}): ${sMsg}`);
                        customError.status = sStatus;
                        customError.data = sData;
                        throw customError;
                    }
                }
            }

            const status = error.response?.status;
            const data = error.response?.data;
            const message = data?.errorMessage || data?.message || data?.errorType || error.message;

            if (status === 401 || status === 403 || message?.toLowerCase().includes("unauthorized")) {
                const err = new Error(`Dhan session invalid or expired: ${message}`);
                err.status = status || 401;
                err.data = data;
                throw err;
            }

            const customError = new Error(`Dhan API Error (${status || "Network"}): ${message}`);
            customError.status = status;
            customError.data = data;
            throw customError;
        }
    }

    // --------------------------------------------------
    // USER PROFILE / ACCOUNT VERIFICATION
    // Endpoint: GET /profile
    // --------------------------------------------------
    async getProfile() {
        const response = await this._request("GET", "/profile");
        return response?.data || {};
    }

    // --------------------------------------------------
    // FUND LIMITS / VERIFICATION
    // Endpoint: GET /fundlimit
    // --------------------------------------------------
    async getFundLimits() {
        try {
            const response = await this._request("GET", "/fundlimit");
            return response?.data || {};
        } catch (error) {
            // In Sandbox environment, /fundlimit may return 500 FUND_LIMIT_ERROR.
            // Fall back to /profile which reliably verifies credentials.
            return await this.getProfile();
        }
    }

    // --------------------------------------------------
    // TODAY'S TRADES / ORDER TRADES
    // Endpoint: GET /trades or GET /trades/{orderId}
    // --------------------------------------------------
    async getTrades(orderId = "") {
        const endpoint = orderId ? `/trades/${orderId}` : "/trades";
        try {
            const response = await this._request("GET", endpoint);
            const data = response?.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.data)) return data.data;
            return [];
        } catch (err) {
            if (err.data?.errorType === "TRADE_RESOURCE_ERROR") {
                return [];
            }
            throw err;
        }
    }

    // --------------------------------------------------
    // HISTORICAL TRADES (PAGINATED)
    // Endpoint: GET /trades/{from-date}/{to-date}/{page}
    // Format: YYYY-MM-DD
    // --------------------------------------------------
    async getHistoricalTrades({ startDate, endDate, page = 0 }) {
        if (!startDate || !endDate) {
            return await this.getTrades();
        }

        const formatDate = (d) => {
            if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
            const dateObj = new Date(d);
            return dateObj.toISOString().split("T")[0];
        };

        const fromDate = formatDate(startDate);
        const toDate = formatDate(endDate);

        try {
            const response = await this._request("GET", `/trades/${fromDate}/${toDate}/${page}`);
            const data = response?.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.data)) return data.data;
            return [];
        } catch (err) {
            if (err.data?.errorType === "TRADE_RESOURCE_ERROR") {
                return [];
            }
            throw err;
        }
    }

    // --------------------------------------------------
    // GET ALL HISTORICAL TRADES (ALL PAGES)
    // --------------------------------------------------
    async getAllHistoricalTrades({ startDate, endDate }) {
        let allTrades = [];
        let page = 0;
        const maxPages = 50;

        while (page < maxPages) {
            const pageTrades = await this.getHistoricalTrades({ startDate, endDate, page });
            if (!Array.isArray(pageTrades) || pageTrades.length === 0) {
                break;
            }
            allTrades.push(...pageTrades);
            if (pageTrades.length < 50) {
                break;
            }
            page++;
        }

        return allTrades;
    }

    // --------------------------------------------------
    // POSITIONS
    // Endpoint: GET /positions
    // --------------------------------------------------
    async getPositions() {
        try {
            const response = await this._request("GET", "/positions");
            const data = response?.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.data)) return data.data;
            return [];
        } catch (err) {
            if (err.data?.errorType === "CONVERT_POSITION_ERROR") {
                return [];
            }
            throw err;
        }
    }

    // --------------------------------------------------
    // ORDERS
    // Endpoint: GET /orders
    // --------------------------------------------------
    async getOrders() {
        try {
            const response = await this._request("GET", "/orders");
            const data = response?.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.data)) return data.data;
            return [];
        } catch {
            return [];
        }
    }

    // --------------------------------------------------
    // HOLDINGS
    // Endpoint: GET /holdings
    // --------------------------------------------------
    async getHoldings() {
        try {
            const response = await this._request("GET", "/holdings");
            const data = response?.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.data)) return data.data;
            return [];
        } catch {
            return [];
        }
    }

    // --------------------------------------------------
    // MARKET FEED / LTP
    // Endpoint: POST /marketfeed/ltp
    // Payload: { "NSE_EQ": [11536], "NSE_FNO": [49081] }
    // --------------------------------------------------
    async getLtp(securities) {
        if (!securities || Object.keys(securities).length === 0) {
            return {};
        }
        const response = await this._request("POST", "/marketfeed/ltp", {
            data: securities
        });
        return response?.data?.data || {};
    }

    // --------------------------------------------------
    // MARKET FEED / QUOTE
    // Endpoint: POST /marketfeed/quote
    // --------------------------------------------------
    async getQuotes(securities) {
        if (!securities || Object.keys(securities).length === 0) {
            return {};
        }
        const response = await this._request("POST", "/marketfeed/quote", {
            data: securities
        });
        return response?.data?.data || {};
    }
}

export default DhanAdapter;
