import axios from "axios";
import crypto from "crypto";

/**
 * GrowwAdapter.js
 * ✅ Official Groww Trading API v1 implementation.
 * Official Documentation:
 * - cURL Docs: https://groww.in/trade-api/docs/curl
 * - Python SDK Docs: https://groww.in/trade-api/docs/python-sdk
 */
class GrowwAdapter {
    /**
     * ✅ Computes SHA-256 checksum required for token generation: SHA256(secret + timestamp)
     * @param {string} secret - Groww API Secret
     * @param {string|number} timestamp - 10-digit epoch seconds timestamp
     * @returns {string} Hex encoded SHA256 checksum
     */
    static generateChecksum(secret, timestamp) {
        if (!secret || !timestamp) {
            throw new Error("Groww API secret and timestamp are required for checksum generation");
        }
        return crypto.createHash("sha256").update(String(secret) + String(timestamp)).digest("hex");
    }

    /**
     * ✅ Exchanges API Key & API Secret for an Access Token
     * Endpoint: POST https://api.groww.in/v1/token/api/access
     * @param {Object} params
     * @param {string} params.apiKey - Groww API Key
     * @param {string} params.apiSecret - Groww API Secret
     * @returns {Promise<{ accessToken: string, expiresAt: Date, tokenType: string }>}
     */
    static async generateAccessToken({ apiKey, apiSecret }) {
        if (!apiKey || !apiSecret) {
            throw new Error("Both apiKey and apiSecret are required to generate Groww access token");
        }

        const timestamp = Math.floor(Date.now() / 1000).toString();
        const checksum = GrowwAdapter.generateChecksum(apiSecret, timestamp);

        const url = "https://api.groww.in/v1/token/api/access";
        const headers = {
            "Authorization": `Bearer ${String(apiKey).trim()}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        };

        const payload = {
            key_type: "approval",
            checksum,
            timestamp
        };

        try {
            const response = await axios.post(url, payload, { headers, timeout: 5000 });
            const data = response.data;

            // Handle various possible response wrapping shapes
            const token = data?.access_token || data?.token || data?.payload?.access_token;
            if (!token) {
                const errMsg = data?.message || data?.error || "No access token in response";
                throw new Error(`Groww token exchange failed: ${errMsg}`);
            }

            // Expiry is typically 6:00 AM IST of next day (or specified in expires_at / expires_in)
            let expiresAt = null;
            if (data?.expires_at) {
                expiresAt = new Date(data.expires_at);
            } else if (data?.expires_in) {
                expiresAt = new Date(Date.now() + Number(data.expires_in) * 1000);
            } else {
                // Default to 24 hours from now
                expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            }

            return {
                accessToken: token,
                expiresAt,
                tokenType: data?.token_type || "Bearer",
                raw: data
            };
        } catch (error) {
            const status = error.response?.status;
            const resData = error.response?.data;
            const message = resData?.message || resData?.error || error.message;
            const customError = new Error(`Groww Authentication Error (${status || "Network"}): ${message}`);
            customError.status = status;
            customError.data = resData;
            throw customError;
        }
    }

    constructor({ accessToken, apiKey, apiSecret, clientId } = {}) {
        this.accessToken = String(accessToken || "").trim();
        this.apiKey = String(apiKey || "").trim();
        this.apiSecret = String(apiSecret || "").trim();
        this.clientId = String(clientId || "").trim();

        this.baseURL = "https://api.groww.in";
        this.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-API-VERSION": "1.0"
        };

        if (this.accessToken) {
            this.headers["Authorization"] = `Bearer ${this.accessToken}`;
        }

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 5000,
            headers: this.headers
        });
    }

    /**
     * Centralized request helper with error normalization
     */
    async _request(method, path, options = {}) {
        try {
            const res = await this.client.request({
                method,
                url: path,
                ...options
            });
            return res.data;
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            const message = data?.message || data?.error_description || data?.error || error.message;

            if (status === 401 || status === 403 || String(message).toLowerCase().includes("unauthorized") || String(message).toLowerCase().includes("token")) {
                const err = new Error(`Groww session invalid or expired: ${message}`);
                err.status = status || 401;
                err.data = data;
                throw err;
            }

            const customError = new Error(`Groww API Error (${status || "Network"}): ${message}`);
            customError.status = status;
            customError.data = data;
            throw customError;
        }
    }

    // --------------------------------------------------
    // USER PROFILE / ACCOUNT VERIFICATION
    // Endpoint: GET /v1/user/detail
    // --------------------------------------------------
    /**
     * ✅ Validates Groww session & fetches account capabilities
     * @returns {Promise<Object>}
     */
    async getProfile() {
        const data = await this._request("GET", "/v1/user/detail");
        return data?.payload || data || {};
    }

    // --------------------------------------------------
    // HOLDINGS
    // Endpoint: GET /v1/holdings/user
    // --------------------------------------------------
    /**
     * ✅ Fetches Demat holdings
     * @returns {Promise<Array>}
     */
    async getHoldings() {
        const data = await this._request("GET", "/v1/holdings/user");
        const holdings = data?.payload?.holdings || data?.holdings || [];
        return Array.isArray(holdings) ? holdings : [];
    }

    // --------------------------------------------------
    // POSITIONS
    // Endpoint: GET /v1/positions/user?segment=CASH / FNO
    // --------------------------------------------------
    /**
     * ✅ Fetches open & intraday positions across CASH & FNO segments
     * @param {string} [segment] - 'CASH' or 'FNO'. If omitted, fetches both.
     * @returns {Promise<Array>}
     */
    async getPositions(segment = null) {
        if (segment) {
            const data = await this._request("GET", `/v1/positions/user?segment=${encodeURIComponent(segment)}`);
            const positions = data?.payload?.positions || data?.positions || [];
            return Array.isArray(positions) ? positions : [];
        }

        // Fetch both CASH and FNO positions in parallel
        const [cashRes, fnoRes] = await Promise.allSettled([
            this._request("GET", "/v1/positions/user?segment=CASH"),
            this._request("GET", "/v1/positions/user?segment=FNO")
        ]);

        const allPositions = [];

        if (cashRes.status === "fulfilled") {
            const p = cashRes.value?.payload?.positions || cashRes.value?.positions || [];
            if (Array.isArray(p)) allPositions.push(...p);
        }

        if (fnoRes.status === "fulfilled") {
            const p = fnoRes.value?.payload?.positions || fnoRes.value?.positions || [];
            if (Array.isArray(p)) allPositions.push(...p);
        }

        // If both failed, rethrow error from the first
        if (cashRes.status === "rejected" && fnoRes.status === "rejected") {
            throw cashRes.reason;
        }

        return allPositions;
    }

    // --------------------------------------------------
    // ORDERS
    // Endpoint: GET /v1/order/list?segment=CASH&page=0&page_size=100
    // --------------------------------------------------
    /**
     * ✅ Fetches orders for a given segment and page
     * @param {Object} options
     * @param {string} [options.segment='CASH']
     * @param {number} [options.page=0]
     * @param {number} [options.pageSize=100]
     * @returns {Promise<Array>}
     */
    async getOrders({ segment = "CASH", page = 0, pageSize = 100 } = {}) {
        const data = await this._request("GET", `/v1/order/list?segment=${encodeURIComponent(segment)}&page=${page}&page_size=${pageSize}`);
        const orders = data?.payload?.order_list || data?.order_list || [];
        return Array.isArray(orders) ? orders : [];
    }

    /**
     * ✅ Fetches all orders across CASH & FNO segments
     * @returns {Promise<Array>}
     */
    async getAllOrders() {
        const [cashRes, fnoRes] = await Promise.allSettled([
            this.getOrders({ segment: "CASH" }),
            this.getOrders({ segment: "FNO" })
        ]);

        const allOrders = [];
        if (cashRes.status === "fulfilled" && Array.isArray(cashRes.value)) {
            allOrders.push(...cashRes.value);
        }
        if (fnoRes.status === "fulfilled" && Array.isArray(fnoRes.value)) {
            allOrders.push(...fnoRes.value);
        }

        if (cashRes.status === "rejected" && fnoRes.status === "rejected") {
            throw cashRes.reason;
        }

        return allOrders;
    }

    // --------------------------------------------------
    // ORDER DETAILS & TRADES
    // Endpoint: GET /v1/order/detail/{groww_order_id}?segment=CASH
    // Endpoint: GET /v1/order/trades/{groww_order_id}?segment=CASH
    // --------------------------------------------------
    async getOrderDetails(growwOrderId, segment = "CASH") {
        if (!growwOrderId) throw new Error("growwOrderId is required");
        const data = await this._request("GET", `/v1/order/detail/${encodeURIComponent(growwOrderId)}?segment=${encodeURIComponent(segment)}`);
        return data?.payload || data || {};
    }

    async getOrderTrades(growwOrderId, segment = "CASH", page = 0, pageSize = 50) {
        if (!growwOrderId) throw new Error("growwOrderId is required");
        const data = await this._request("GET", `/v1/order/trades/${encodeURIComponent(growwOrderId)}?segment=${encodeURIComponent(segment)}&page=${page}&page_size=${pageSize}`);
        return data?.payload || data || [];
    }
}

export default GrowwAdapter;
