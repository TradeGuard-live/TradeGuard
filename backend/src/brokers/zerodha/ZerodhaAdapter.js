import axios from "axios";
import crypto from "crypto";

/**
 * ZerodhaAdapter.js
 * ✅ Official Zerodha Kite Connect v3 API implementation.
 * Official Documentation: https://kite.trade/docs/connect/v3/
 */
class ZerodhaAdapter {
    /**
     * ✅ Computes SHA-256 checksum required for Kite token exchange:
     * Checksum = SHA256(api_key + request_token + api_secret)
     * Reference: https://kite.trade/docs/connect/v3/user/#authentication-and-token-exchange
     * @param {Object} params
     * @param {string} params.apiKey - Zerodha Kite API Key
     * @param {string} params.requestToken - Request token received from login redirect
     * @param {string} params.apiSecret - Zerodha Kite API Secret
     * @returns {string} Hex encoded SHA-256 checksum
     */
    static generateChecksum({ apiKey, requestToken, apiSecret }) {
        if (!apiKey || !requestToken || !apiSecret) {
            throw new Error("apiKey, requestToken, and apiSecret are all required to compute Zerodha checksum");
        }
        const message = String(apiKey).trim() + String(requestToken).trim() + String(apiSecret).trim();
        return crypto.createHash("sha256").update(message).digest("hex");
    }

    /**
     * ✅ Constructs public Kite login URL for OAuth flow
     * Endpoint: https://kite.zerodha.com/connect/login?v=3&api_key=xxx
     * @param {Object} params
     * @param {string} params.apiKey - Zerodha Kite API Key
     * @param {string} [params.redirectParams] - Optional URL encoded redirect params
     * @returns {string}
     */
    static getLoginUrl({ apiKey, redirectParams = "" }) {
        if (!apiKey) {
            throw new Error("apiKey is required to generate Zerodha login URL");
        }
        let url = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(String(apiKey).trim())}`;
        if (redirectParams) {
            url += `&redirect_params=${encodeURIComponent(String(redirectParams))}`;
        }
        return url;
    }

    /**
     * ✅ Exchanges request_token & checksum for an access_token
     * Endpoint: POST https://api.kite.trade/session/token
     * Headers: X-Kite-Version: 3, Content-Type: application/x-www-form-urlencoded
     * Body: api_key=xxx&request_token=yyy&checksum=zzz
     * @param {Object} params
     * @param {string} params.apiKey
     * @param {string} params.apiSecret
     * @param {string} params.requestToken
     * @returns {Promise<{ accessToken: string, publicToken: string, user: Object, raw: Object }>}
     */
    static async generateAccessToken({ apiKey, apiSecret, requestToken }) {
        if (!apiKey || !apiSecret || !requestToken) {
            throw new Error("apiKey, apiSecret, and requestToken are required to exchange for Zerodha access token");
        }

        const cleanApiKey = String(apiKey).trim();
        const cleanApiSecret = String(apiSecret).trim();
        const cleanRequestToken = String(requestToken).trim();

        const checksum = ZerodhaAdapter.generateChecksum({
            apiKey: cleanApiKey,
            requestToken: cleanRequestToken,
            apiSecret: cleanApiSecret
        });

        const url = "https://api.kite.trade/session/token";
        const formParams = new URLSearchParams();
        formParams.append("api_key", cleanApiKey);
        formParams.append("request_token", cleanRequestToken);
        formParams.append("checksum", checksum);

        const headers = {
            "X-Kite-Version": "3",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json"
        };

        try {
            const response = await axios.post(url, formParams.toString(), { headers, timeout: 7000 });
            const data = response.data;

            if (data?.status !== "success" || !data?.data?.access_token) {
                const errMsg = data?.message || "Invalid response from Zerodha session token endpoint";
                throw new Error(errMsg);
            }

            const sessionData = data.data;

            return {
                accessToken: sessionData.access_token,
                publicToken: sessionData.public_token || "",
                userId: sessionData.user_id,
                userName: sessionData.user_name,
                email: sessionData.email,
                broker: sessionData.broker || "ZERODHA",
                loginTime: sessionData.login_time,
                raw: sessionData
            };
        } catch (error) {
            const status = error.response?.status;
            const resData = error.response?.data;
            const message = resData?.message || error.message;
            const customError = new Error(`Zerodha Authentication Error (${status || "Network"}): ${message}`);
            customError.status = status;
            customError.data = resData;
            throw customError;
        }
    }

    /**
     * @param {Object} config
     * @param {string} config.apiKey - Zerodha Kite API Key
     * @param {string} [config.accessToken] - Session Access Token
     * @param {string} [config.apiSecret] - Optional API Secret
     * @param {string} [config.clientId] - Zerodha User ID (e.g. AB1234)
     */
    constructor({ apiKey, accessToken = "", apiSecret = "", clientId = "" } = {}) {
        this.apiKey = String(apiKey || "").trim();
        this.accessToken = String(accessToken || "").trim();
        this.apiSecret = String(apiSecret || "").trim();
        this.clientId = String(clientId || "").trim();

        this.baseURL = "https://api.kite.trade";
        this.headers = {
            "Accept": "application/json",
            "X-Kite-Version": "3"
        };

        if (this.apiKey && this.accessToken) {
            // ✅ Signing requests: Authorization: token api_key:access_token
            this.headers["Authorization"] = `token ${this.apiKey}:${this.accessToken}`;
        }

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 7000,
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
            const message = data?.message || data?.error_type || error.message;

            if (status === 401 || status === 403 || data?.error_type === "TokenException" || String(message).toLowerCase().includes("token")) {
                const err = new Error(`Zerodha session invalid or expired: ${message}`);
                err.status = status || 401;
                err.data = data;
                throw err;
            }

            const customError = new Error(`Zerodha API Error (${status || "Network"}): ${message}`);
            customError.status = status;
            customError.data = data;
            throw customError;
        }
    }

    // --------------------------------------------------
    // USER PROFILE
    // Endpoint: GET /user/profile
    // --------------------------------------------------
    /**
     * ✅ Validates Zerodha session & fetches user profile
     * @returns {Promise<Object>}
     */
    async getProfile() {
        const data = await this._request("GET", "/user/profile");
        return data?.data || data || {};
    }

    // --------------------------------------------------
    // FUNDS & MARGINS
    // Endpoint: GET /user/margins or GET /user/margins/:segment
    // --------------------------------------------------
    /**
     * ✅ Fetches funds and margins for equity & commodity
     * @param {string} [segment] - 'equity' or 'commodity'. If omitted, returns both.
     * @returns {Promise<Object>}
     */
    async getMargins(segment = null) {
        const path = segment ? `/user/margins/${encodeURIComponent(segment.toLowerCase())}` : "/user/margins";
        const data = await this._request("GET", path);
        return data?.data || data || {};
    }

    // --------------------------------------------------
    // PORTFOLIO - HOLDINGS
    // Endpoint: GET /portfolio/holdings
    // --------------------------------------------------
    /**
     * ✅ Retrieves user's Demat equity delivery holdings
     * @returns {Promise<Array>}
     */
    async getHoldings() {
        const data = await this._request("GET", "/portfolio/holdings");
        const holdings = data?.data || [];
        return Array.isArray(holdings) ? holdings : [];
    }

    // --------------------------------------------------
    // PORTFOLIO - POSITIONS
    // Endpoint: GET /portfolio/positions
    // --------------------------------------------------
    /**
     * ✅ Retrieves current open positions (net and day portfolios)
     * @returns {Promise<{ net: Array, day: Array }>}
     */
    async getPositions() {
        const data = await this._request("GET", "/portfolio/positions");
        const payload = data?.data || {};
        return {
            net: Array.isArray(payload.net) ? payload.net : [],
            day: Array.isArray(payload.day) ? payload.day : []
        };
    }

    // --------------------------------------------------
    // ORDERS
    // Endpoint: GET /orders
    // --------------------------------------------------
    /**
     * ✅ Retrieves list of all orders (open, executed, cancelled) for the day
     * @returns {Promise<Array>}
     */
    async getOrders() {
        const data = await this._request("GET", "/orders");
        const orders = data?.data || [];
        return Array.isArray(orders) ? orders : [];
    }

    /**
     * ✅ Retrieves the history of a specific order
     * Endpoint: GET /orders/:order_id
     * @param {string} orderId
     * @returns {Promise<Array>}
     */
    async getOrderHistory(orderId) {
        if (!orderId) throw new Error("orderId is required");
        const data = await this._request("GET", `/orders/${encodeURIComponent(orderId)}`);
        return data?.data || [];
    }

    // --------------------------------------------------
    // TRADES
    // Endpoint: GET /trades
    // --------------------------------------------------
    /**
     * ✅ Retrieves all executed trades for the day
     * @returns {Promise<Array>}
     */
    async getTrades() {
        const data = await this._request("GET", "/trades");
        const trades = data?.data || [];
        return Array.isArray(trades) ? trades : [];
    }

    /**
     * ✅ Retrieves trades generated by a specific order
     * Endpoint: GET /orders/:order_id/trades
     * @param {string} orderId
     * @returns {Promise<Array>}
     */
    async getOrderTrades(orderId) {
        if (!orderId) throw new Error("orderId is required");
        const data = await this._request("GET", `/orders/${encodeURIComponent(orderId)}/trades`);
        return data?.data || [];
    }

    // --------------------------------------------------
    // LOGOUT
    // Endpoint: DELETE /session/token?api_key=xxx&access_token=yyy
    // --------------------------------------------------
    /**
     * ✅ Invalidates access_token and destroys API session
     * @returns {Promise<boolean>}
     */
    async logout() {
        if (!this.apiKey || !this.accessToken) return true;
        try {
            await this._request("DELETE", `/session/token?api_key=${encodeURIComponent(this.apiKey)}&access_token=${encodeURIComponent(this.accessToken)}`);
            return true;
        } catch {
            return false;
        }
    }
}

export default ZerodhaAdapter;
