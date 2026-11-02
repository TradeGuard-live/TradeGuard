import axios from "axios";
import https from "https";

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

        // Explicitly force IPv4 agent so outbound calls match registered static IPv4
        this.httpsAgent = new https.Agent({ family: 4, keepAlive: true });

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 8000,
            headers: this.headers,
            httpsAgent: this.httpsAgent
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
            const status = error.response?.status;
            const data = error.response?.data;
            const errorCode = data?.errorCode;
            const rawMessage = data?.errorMessage || data?.message || data?.errorType || error.message;

            // Only attempt sandbox fallback if live explicitly rejects with DH-906 (Invalid Token/Session on Live)
            // NEVER retry sandbox on 400 parameter errors (e.g. DH-905 IP mismatch or invalid input)
            const isDH906 = errorCode === "DH-906";

            if (isDH906 && !options._retriedSandbox) {
                try {
                    const sandboxClient = axios.create({
                        baseURL: this.sandboxURL,
                        timeout: 8000,
                        headers: this.headers,
                        httpsAgent: this.httpsAgent
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
                } catch {
                    // Sandbox also failed, proceed to report live error cleanly
                }
            }

            if (errorCode === "DH-905" || /invalid ip/i.test(rawMessage)) {
                const ipErr = new Error(`Dhan API Error (400): Static IP mismatch or unverified token. If you recently configured IP whitelisting, generate a fresh Access Token in web.dhan.co and update it in settings.`);
                ipErr.status = 400;
                ipErr.data = data;
                ipErr.errorCode = "DH-905";
                throw ipErr;
            }

            if (status === 401 || status === 403 || errorCode === "DH-906" || /unauthorized|invalid token/i.test(rawMessage)) {
                const err = new Error(`Dhan API Error (${status || 401}): Invalid or expired access token. Please enter a fresh Dhan Access Token in account settings.`);
                err.status = status || 401;
                err.data = data;
                err.errorCode = errorCode || "DH-906";
                throw err;
            }

            const customError = new Error(`Dhan API Error (${status || "Network"}): ${rawMessage}`);
            customError.status = status;
            customError.data = data;
            customError.errorCode = errorCode;
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
    // STATIC IP SETUP & DIAGNOSTICS
    // Endpoint: GET /ip/getIP and POST /ip/setIP
    // --------------------------------------------------
    async getIP() {
        const response = await this._request("GET", "/ip/getIP");
        return response?.data || {};
    }

    async setIP({ ip, ipFlag = "PRIMARY" }) {
        const response = await this._request("POST", "/ip/setIP", {
            data: {
                dhanClientId: this.clientId,
                ip,
                ipFlag
            }
        });
        return response?.data || {};
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

    // --------------------------------------------------
    // PLACE ORDER
    // Endpoint: POST /orders
    // --------------------------------------------------
    async placeOrder({
        transactionType = "BUY",
        exchangeSegment = "NSE_EQ",
        productType = "INTRADAY",
        orderType = "MARKET",
        validity = "DAY",
        securityId,
        quantity,
        disclosedQuantity = 0,
        price = 0,
        triggerPrice = 0,
        afterMarketOrder = false,
        correlationId = ""
    }) {
        if (!securityId || !quantity) {
            throw new Error("securityId and quantity are required for Dhan placeOrder");
        }

        const payload = {
            dhanClientId: this.clientId,
            correlationId: String(correlationId || `TG-${Date.now()}`).slice(0, 25),
            transactionType: String(transactionType).toUpperCase().startsWith("S") ? "SELL" : "BUY",
            exchangeSegment: String(exchangeSegment).toUpperCase(),
            productType: String(productType).toUpperCase() === "DELIVERY" || String(productType).toUpperCase() === "CNC" ? "CNC" : "INTRADAY",
            orderType: String(orderType).toUpperCase() === "LIMIT" ? "LIMIT" : String(orderType).toUpperCase().startsWith("SL") ? "STOP_LOSS" : "MARKET",
            validity: String(validity).toUpperCase(),
            securityId: String(securityId),
            quantity: Number(quantity),
            disclosedQuantity: Number(disclosedQuantity || 0),
            price: Number(price || 0),
            triggerPrice: Number(triggerPrice || 0),
            afterMarketOrder: Boolean(afterMarketOrder)
        };

        const res = await this._request("POST", "/orders", { data: payload });
        return res?.data || res;
    }

    // --------------------------------------------------
    // MODIFY ORDER
    // Endpoint: PUT /orders/{orderId}
    // --------------------------------------------------
    async modifyOrder({
        orderId,
        orderType = "LIMIT",
        quantity,
        price = 0,
        triggerPrice = 0,
        disclosedQuantity = 0,
        validity = "DAY"
    }) {
        if (!orderId || !quantity) {
            throw new Error("orderId and quantity are required for Dhan modifyOrder");
        }

        const payload = {
            dhanClientId: this.clientId,
            orderId: String(orderId),
            orderType: String(orderType).toUpperCase(),
            legName: "",
            quantity: Number(quantity),
            price: Number(price || 0),
            triggerPrice: Number(triggerPrice || 0),
            disclosedQuantity: Number(disclosedQuantity || 0),
            validity: String(validity).toUpperCase()
        };

        const res = await this._request("PUT", `/orders/${orderId}`, { data: payload });
        return res?.data || res;
    }

    // --------------------------------------------------
    // CANCEL ORDER
    // Endpoint: DELETE /orders/{orderId}
    // --------------------------------------------------
    async cancelOrder(orderId) {
        if (!orderId) throw new Error("orderId is required for Dhan cancelOrder");
        const res = await this._request("DELETE", `/orders/${orderId}`);
        return res?.data || res;
    }

    // --------------------------------------------------
    // GET ORDER BY ID
    // Endpoint: GET /orders/{orderId}
    // --------------------------------------------------
    async getOrder(orderId) {
        if (!orderId) throw new Error("orderId is required for Dhan getOrder");
        const res = await this._request("GET", `/orders/${orderId}`);
        return res?.data || res;
    }
}

export default DhanAdapter;
