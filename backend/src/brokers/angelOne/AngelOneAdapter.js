import axios from "axios";
import { generateTOTP, extractSecretFromInput } from "../../utils/totp.js";

/**
 * AngelOneAdapter.js
 * Comprehensive official Angel One SmartAPI client.
 * Base URL: https://apiconnect.angelone.in
 * Handles session generation (TOTP/Google Authenticator), token refresh,
 * order/trade books, RMS limits, positions, holdings, and market data.
 */
class AngelOneAdapter {
    /**
     * @param {Object} params
     * @param {string} [params.apiKey] - SmartAPI App API Key (X-PrivateKey)
     * @param {string} [params.clientCode] - Angel One Client ID (e.g. A123456)
     * @param {string} [params.password] - Trading PIN or Password
     * @param {string} [params.totpSecret] - Base32 TOTP secret from QR code setup
     * @param {string} [params.accessToken] - Active JWT token (Bearer eyJ...)
     * @param {string} [params.refreshToken] - Refresh token
     * @param {string} [params.feedToken] - WebSocket feed token
     * @param {string} [params.clientLocalIp] - Local client IP
     * @param {string} [params.clientPublicIp] - Public IP
     * @param {string} [params.macAddress] - MAC address
     */
    constructor({
        apiKey = "",
        clientCode = "",
        password = "",
        totpSecret = "",
        accessToken = "",
        refreshToken = "",
        feedToken = "",
        clientLocalIp = "192.168.1.1",
        clientPublicIp = "106.193.147.98",
        macAddress = "fe80::1"
    } = {}) {
        this.apiKey = String(apiKey || "").trim();
        this.clientCode = String(clientCode || "").trim().toUpperCase();
        this.password = String(password || "").trim();
        this.totpSecret = extractSecretFromInput(totpSecret);
        
        // Ensure accessToken doesn't duplicate "Bearer "
        let cleanToken = String(accessToken || "").trim();
        if (cleanToken.toLowerCase().startsWith("bearer ")) {
            cleanToken = cleanToken.slice(7).trim();
        }
        this.jwtToken = cleanToken;
        this.refreshToken = String(refreshToken || "").trim();
        this.feedToken = String(feedToken || "").trim();

        this.clientLocalIp = clientLocalIp;
        this.clientPublicIp = clientPublicIp;
        this.macAddress = macAddress;

        this.baseURL = "https://apiconnect.angelone.in";
    }

    /**
     * Constructs default headers required by SmartAPI
     */
    _buildHeaders(includeAuth = true) {
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": this.clientLocalIp,
            "X-ClientPublicIP": this.clientPublicIp,
            "X-MACAddress": this.macAddress
        };

        if (this.apiKey) {
            headers["X-PrivateKey"] = this.apiKey;
        }

        if (includeAuth && this.jwtToken) {
            headers["Authorization"] = `Bearer ${this.jwtToken}`;
        }

        return headers;
    }

    /**
     * Executes HTTP requests against Angel One SmartAPI
     */
    async _request(method, path, data = null, options = {}) {
        const url = `${this.baseURL}${path}`;
        const headers = this._buildHeaders(!options.noAuth);

        try {
            const config = {
                method,
                url,
                headers,
                timeout: 12000,
                ...(data ? { data } : {})
            };

            const response = await axios(config);
            const resData = response.data;

            // Check SmartAPI response envelope
            if (resData && typeof resData === "object") {
                if (resData.status === false && resData.errorcode) {
                    const errMsg = resData.message || `SmartAPI Error code: ${resData.errorcode}`;
                    const err = new Error(errMsg);
                    err.errorCode = resData.errorcode;
                    err.data = resData;
                    throw err;
                }
            }

            return resData;
        } catch (error) {
            const status = error.response?.status;
            const resData = error.response?.data;
            const msg = resData?.message || resData?.error || error.message;

            // If token expired/invalid and we can refresh or re-login, attempt once
            const isAuthExpired = 
                status === 401 || 
                status === 403 || 
                resData?.errorcode === "AG8001" || 
                resData?.errorcode === "AB8050" ||
                String(msg).toLowerCase().includes("token expired") ||
                String(msg).toLowerCase().includes("invalid token");

            if (isAuthExpired && !options._retried) {
                try {
                    console.log("[AngelOneAdapter] Access token expired, attempting automatic session refresh/relogin...");
                    let refreshed = false;

                    // 1. Try refreshToken endpoint first if available
                    if (this.refreshToken) {
                        try {
                            await this.refreshTokens();
                            refreshed = true;
                        } catch (refErr) {
                            console.warn("[AngelOneAdapter] Token refresh failed:", refErr.message);
                        }
                    }

                    // 2. If refresh token wasn't available or failed, try loginByPassword if password and totpSecret are present
                    if (!refreshed && this.clientCode && this.password && (this.totpSecret || options.totp)) {
                        await this.login({
                            clientCode: this.clientCode,
                            password: this.password,
                            totpSecret: this.totpSecret,
                            totp: options.totp
                        });
                        refreshed = true;
                    }

                    if (refreshed) {
                        return await this._request(method, path, data, { ...options, _retried: true });
                    }
                } catch (retryErr) {
                    console.warn("[AngelOneAdapter] Auto-recovery failed:", retryErr.message);
                }
            }

            const customError = new Error(`Angel One SmartAPI Error (${status || "Network"}): ${msg}`);
            customError.status = status;
            customError.errorCode = resData?.errorcode || error.errorCode;
            customError.data = resData;
            throw customError;
        }
    }

    // ----------------------------------------------------------------------
    // AUTHENTICATION & SESSION MANAGEMENT
    // ----------------------------------------------------------------------

    /**
     * Authenticates with Angel One SmartAPI using clientCode, password/PIN, and TOTP.
     * TOTP is either generated from totpSecret (from QR code setup) or passed directly.
     * Endpoint: POST /rest/auth/angelbroking/user/v1/loginByPassword
     */
    async login({ clientCode, password, totpSecret, totp } = {}) {
        const cCode = String(clientCode || this.clientCode).trim().toUpperCase();
        const pwd = String(password || this.password).trim();
        const tSecret = extractSecretFromInput(totpSecret || this.totpSecret);

        if (!cCode || !pwd) {
            throw new Error("clientCode and password (PIN) are required for Angel One login");
        }

        if (!this.apiKey) {
            throw new Error("apiKey (SmartAPI app key) is required for Angel One login");
        }

        let computedTotp = String(totp || "").trim();
        if (!computedTotp && tSecret) {
            computedTotp = generateTOTP(tSecret);
        }

        if (!computedTotp || computedTotp.length !== 6) {
            throw new Error("Valid 6-digit TOTP code or TOTP secret key is required");
        }

        const payload = {
            clientcode: cCode,
            password: pwd,
            totp: computedTotp
        };

        const res = await this._request(
            "POST",
            "/rest/auth/angelbroking/user/v1/loginByPassword",
            payload,
            { noAuth: true }
        );

        if (res && res.data) {
            let token = res.data.jwtToken || "";
            if (token.toLowerCase().startsWith("bearer ")) {
                token = token.slice(7).trim();
            }
            this.jwtToken = token;
            this.refreshToken = res.data.refreshToken || this.refreshToken;
            this.feedToken = res.data.feedToken || this.feedToken;
            this.clientCode = cCode;
            this.password = pwd;
            if (tSecret) this.totpSecret = tSecret;
        }

        return res?.data || res;
    }

    /**
     * Generates a new JWT token using the refresh token.
     * Endpoint: POST /rest/auth/angelbroking/jwt/v1/generateTokens
     */
    async refreshTokens(refreshToken = "") {
        const rToken = String(refreshToken || this.refreshToken).trim();
        if (!rToken) {
            throw new Error("refreshToken is required to renew session");
        }

        const payload = { refreshToken: rToken };
        const res = await this._request(
            "POST",
            "/rest/auth/angelbroking/jwt/v1/generateTokens",
            payload,
            { noAuth: false }
        );

        if (res && res.data) {
            let token = res.data.jwtToken || "";
            if (token.toLowerCase().startsWith("bearer ")) {
                token = token.slice(7).trim();
            }
            this.jwtToken = token;
            this.refreshToken = res.data.refreshToken || this.refreshToken;
            this.feedToken = res.data.feedToken || this.feedToken;
        }

        return res?.data || res;
    }

    // ----------------------------------------------------------------------
    // USER PROFILE & RMS LIMITS
    // ----------------------------------------------------------------------

    /**
     * Fetches user profile information.
     * Endpoint: GET /rest/secure/angelbroking/user/v1/getProfile
     */
    async getProfile() {
        const res = await this._request("GET", "/rest/secure/angelbroking/user/v1/getProfile");
        return res?.data || {};
    }

    /**
     * Fetches RMS / available funds and limits.
     * Endpoint: GET /rest/secure/angelbroking/user/v1/getRMS
     */
    async getRMS() {
        const res = await this._request("GET", "/rest/secure/angelbroking/user/v1/getRMS");
        return res?.data || {};
    }

    /**
     * Alias for getRMS to conform to common broker adapter interface
     */
    async getFundLimits() {
        return await this.getRMS();
    }

    // ----------------------------------------------------------------------
    // ORDERS & TRADES
    // ----------------------------------------------------------------------

    /**
     * Fetches executed trades for the day.
     * Endpoint: GET /rest/secure/angelbroking/order/v1/getTradeBook
     */
    async getTradeBook() {
        try {
            const res = await this._request("GET", "/rest/secure/angelbroking/order/v1/getTradeBook");
            const data = res?.data;
            if (Array.isArray(data)) return data;
            return [];
        } catch (err) {
            // If no trades found, Angel One sometimes returns null or AB2001
            if (err.errorCode === "AB2001" || err.data?.message?.toLowerCase().includes("no data")) {
                return [];
            }
            throw err;
        }
    }

    /**
     * Alias for getTradeBook
     */
    async getTrades() {
        return await this.getTradeBook();
    }

    /**
     * Fetches all orders for the current day.
     * Endpoint: GET /rest/secure/angelbroking/order/v1/getOrderBook
     */
    async getOrderBook() {
        try {
            const res = await this._request("GET", "/rest/secure/angelbroking/order/v1/getOrderBook");
            const data = res?.data;
            if (Array.isArray(data)) return data;
            return [];
        } catch (err) {
            if (err.errorCode === "AB2001" || err.data?.message?.toLowerCase().includes("no data")) {
                return [];
            }
            throw err;
        }
    }

    // ----------------------------------------------------------------------
    // PORTFOLIO: POSITIONS & HOLDINGS
    // ----------------------------------------------------------------------

    /**
     * Fetches open and closed intraday / derivative positions.
     * Endpoint: GET /rest/secure/angelbroking/order/v1/getPosition
     */
    async getPositions() {
        try {
            const res = await this._request("GET", "/rest/secure/angelbroking/order/v1/getPosition");
            const data = res?.data;
            if (Array.isArray(data)) return data;
            return [];
        } catch (err) {
            if (err.errorCode === "AB2001" || err.data?.message?.toLowerCase().includes("no data")) {
                return [];
            }
            throw err;
        }
    }

    /**
     * Fetches long-term delivery holdings.
     * Endpoint: GET /rest/secure/angelbroking/portfolio/v1/getHolding
     */
    async getHoldings() {
        try {
            const res = await this._request("GET", "/rest/secure/angelbroking/portfolio/v1/getHolding");
            const data = res?.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.holdings)) return data.holdings;
            return [];
        } catch (err) {
            if (err.errorCode === "AB2001" || err.data?.message?.toLowerCase().includes("no data")) {
                return [];
            }
            throw err;
        }
    }

    /**
     * Fetches all holdings across all DP accounts
     * Endpoint: GET /rest/secure/angelbroking/portfolio/v1/getAllHolding
     */
    async getAllHoldings() {
        try {
            const res = await this._request("GET", "/rest/secure/angelbroking/portfolio/v1/getAllHolding");
            const data = res?.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.holdings)) return data.holdings;
            return [];
        } catch (err) {
            return await this.getHoldings();
        }
    }

    // ----------------------------------------------------------------------
    // MARKET QUOTES & CANDLE DATA
    // ----------------------------------------------------------------------

    /**
     * Fetches real-time LTP for an instrument.
     * Endpoint: POST /rest/secure/angelbroking/order/v1/getLtpData
     * @param {Object} params
     * @param {string} params.exchange - e.g. "NSE", "BSE", "NFO", "MCX"
     * @param {string} params.tradingsymbol - e.g. "SBIN-EQ"
     * @param {string} params.symboltoken - e.g. "3045"
     */
    async getLtp({ exchange = "NSE", tradingsymbol, symboltoken }) {
        if (!tradingsymbol || !symboltoken) {
            throw new Error("tradingsymbol and symboltoken are required for getLtp");
        }

        const payload = {
            exchange: exchange.toUpperCase(),
            tradingsymbol,
            symboltoken: String(symboltoken)
        };

        const res = await this._request("POST", "/rest/secure/angelbroking/order/v1/getLtpData", payload);
        return res?.data || {};
    }

    /**
     * Fetches historical candlestick OHLCV data.
     * Endpoint: POST /rest/secure/angelbroking/historical/v1/getCandleData
     * @param {Object} params
     * @param {string} params.exchange - "NSE", "NFO", "BSE", "MCX"
     * @param {string} params.symboltoken - Scrip master token
     * @param {string} params.interval - "ONE_MINUTE", "FIVE_MINUTE", "FIFTEEN_MINUTE", "ONE_DAY"
     * @param {string} params.fromdate - Format "YYYY-MM-DD HH:mm"
     * @param {string} params.todate - Format "YYYY-MM-DD HH:mm"
     */
    async getCandleData({ exchange = "NSE", symboltoken, interval = "ONE_DAY", fromdate, todate }) {
        if (!symboltoken || !fromdate || !todate) {
            throw new Error("symboltoken, fromdate, and todate are required for getCandleData");
        }

        const payload = {
            exchange: exchange.toUpperCase(),
            symboltoken: String(symboltoken),
            interval,
            fromdate,
            todate
        };

        const res = await this._request("POST", "/rest/secure/angelbroking/historical/v1/getCandleData", payload);
        return res?.data || [];
    }
}

export default AngelOneAdapter;
