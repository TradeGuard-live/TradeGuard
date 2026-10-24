import axios from "axios";
import { generateTOTP, extractSecretFromInput } from "../../utils/totp.js";

/**
 * KotakNeoAdapter.js
 * Official REST Client for Kotak Neo Trading APIs.
 *
 * Implements 2-step TOTP + MPIN authentication:
 *   Step 2a: POST https://mis.kotaksecurities.com/login/1.0/tradeApiLogin
 *   Step 2b: POST https://mis.kotaksecurities.com/login/1.0/tradeApiValidate
 *
 * Provides complete coverage of:
 * - Session login and automatic re-authentication
 * - Orders: place, modify, cancel, order book, order history
 * - Trades: trade book
 * - Portfolio: positions, holdings
 * - Limits: RMS / margin limits
 * - Market data: quotes, LTP
 */
class KotakNeoAdapter {
    /**
     * @param {Object} params
     * @param {string} [params.apiKey] - Neo API Access Token (copied from Neo Trade API Dashboard)
     * @param {string} [params.clientId] - UCC / Client Code (e.g. AB123)
     * @param {string} [params.mobileNumber] - Registered mobile with +91 (e.g. +91XXXXXXXXXX)
     * @param {string} [params.password] - 6-digit MPIN
     * @param {string} [params.totpSecret] - Base32 TOTP setup key from Authenticator setup
     * @param {string} [params.accessToken] - Trading session token (Auth header)
     * @param {string} [params.sid] - Trading session SID (Sid header)
     * @param {string} [params.baseUrl] - Dynamic environment base URL returned by /tradeApiValidate
     */
    constructor({
        apiKey = "",
        clientId = "",
        mobileNumber = "",
        password = "",
        totpSecret = "",
        accessToken = "",
        sid = "",
        baseUrl = "https://cis.kotaksecurities.com"
    } = {}) {
        this.apiKey = String(apiKey || "").trim();
        this.clientId = String(clientId || "").trim().toUpperCase();
        this.mobileNumber = this._formatMobile(mobileNumber);
        this.password = String(password || "").trim(); // MPIN
        this.totpSecret = extractSecretFromInput(totpSecret);

        // Session tokens
        let cleanToken = String(accessToken || "").trim();
        if (cleanToken.toLowerCase().startsWith("bearer ")) {
            cleanToken = cleanToken.slice(7).trim();
        }
        this.tradingToken = cleanToken;
        this.tradingSid = String(sid || "").trim();
        this.baseUrl = String(baseUrl || "https://cis.kotaksecurities.com").trim().replace(/\/+$/, "");

        // Static login endpoints host
        this.authHost = "https://mis.kotaksecurities.com";
    }

    /**
     * Formats mobile number to ensure +91 prefix
     */
    _formatMobile(num) {
        if (!num) return "";
        let clean = String(num).replace(/[^0-9+]/g, "").trim();
        if (!clean) return "";
        if (!clean.startsWith("+")) {
            if (clean.length === 10) {
                clean = `+91${clean}`;
            } else if (clean.startsWith("91") && clean.length === 12) {
                clean = `+${clean}`;
            }
        }
        return clean;
    }

    /**
     * Builds default headers for Kotak Neo API
     */
    _buildHeaders(options = {}) {
        const headers = {
            "accept": "application/json",
            "neo-fin-key": "neotradeapi"
        };

        if (options.isJson) {
            headers["Content-Type"] = "application/json";
        } else if (options.isUrlEncoded) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
        }

        // For dashboard/auth token APIs (Quotes, Masterscrip, Auth endpoints)
        if (options.useApiKey && this.apiKey) {
            headers["Authorization"] = this.apiKey;
        }

        // For trading / session endpoints
        if (options.includeAuth) {
            if (this.tradingToken) {
                headers["Auth"] = this.tradingToken;
            }
            if (this.tradingSid) {
                headers["Sid"] = this.tradingSid;
            }
        }

        return headers;
    }

    /**
     * Central request method with automatic session renewal & error handling
     */
    async _request(method, path, data = null, options = {}) {
        const isAbsolute = String(path).startsWith("http://") || String(path).startsWith("https://");
        const url = isAbsolute ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

        const isPostOrPut = method === "POST" || method === "PUT";
        const isUrlEncoded = options.isUrlEncoded ?? isPostOrPut;
        const isJson = options.isJson ?? (!isUrlEncoded && isPostOrPut);

        const headers = this._buildHeaders({
            includeAuth: !options.noAuth,
            useApiKey: options.useApiKey,
            isJson,
            isUrlEncoded
        });

        let body = data;
        if (isUrlEncoded && data && typeof data === "object") {
            const jDataString = JSON.stringify(data);
            body = `jData=${encodeURIComponent(jDataString)}`;
        }

        try {
            const config = {
                method,
                url,
                headers,
                timeout: 15000,
                ...(body ? { data: body } : {})
            };

            const response = await axios(config);
            const resData = response.data;

            // Kotak Neo returns { stat: "Not_Ok", stCode: 5203, errMsg: "No Data", desc: "data not found" } when books are empty
            if (resData && typeof resData === "object") {
                const isNoData =
                    resData.stCode === 5203 ||
                    String(resData.errMsg || "").toLowerCase().includes("no data") ||
                    String(resData.desc || "").toLowerCase().includes("data not found") ||
                    String(resData.emsg || "").toLowerCase().includes("no data");

                if (isNoData) {
                    return { stat: "Ok", stCode: 200, data: [] };
                }

                if (resData.stat === "Not_Ok" || (resData.status === "error")) {
                    const emsg = resData.errMsg || resData.desc || resData.emsg || resData.message || "Kotak Neo API request failed";
                    const err = new Error(emsg);
                    err.errorCode = resData.stCode || resData.code;
                    err.data = resData;
                    throw err;
                }
            }

            return resData;
        } catch (error) {
            const status = error.response?.status;
            const resData = error.response?.data;
            const msg = resData?.errMsg || resData?.desc || resData?.emsg || resData?.message || resData?.error || error.message;

            // Handle HTTP 424 (No holdings found) or empty data response gracefully
            if (status === 424 || (resData?.error && Array.isArray(resData.error) && resData.error[0]?.code === 424)) {
                return { stat: "Ok", stCode: 200, data: [] };
            }

            const isAuthExpired =
                status === 401 ||
                status === 403 ||
                resData?.stCode === 1003 ||
                String(msg).toLowerCase().includes("session") ||
                String(msg).toLowerCase().includes("invalid token") ||
                String(msg).toLowerCase().includes("token expired") ||
                String(msg).toLowerCase().includes("unauthorized");

            // Attempt automatic re-login once if tokens expired and login credentials exist
            if (isAuthExpired && !options._retried && this.clientId && this.password && (this.totpSecret || options.totp)) {
                try {
                    console.log("[KotakNeoAdapter] Session expired or invalid, attempting automatic re-login...");
                    await this.login({
                        ucc: this.clientId,
                        mobileNumber: this.mobileNumber,
                        mpin: this.password,
                        totpSecret: this.totpSecret,
                        totp: options.totp,
                        apiKey: this.apiKey
                    });

                    return await this._request(method, path, data, { ...options, _retried: true });
                } catch (reErr) {
                    console.warn("[KotakNeoAdapter] Automatic re-login failed:", reErr.message);
                }
            }

            const customError = new Error(`Kotak Neo API Error (${status || "Network"}): ${msg}`);
            customError.status = status;
            customError.errorCode = resData?.stCode || error.errorCode;
            customError.data = resData;
            throw customError;
        }
    }

    // ----------------------------------------------------------------------
    // AUTHENTICATION FLOW (TOTP + MPIN)
    // ----------------------------------------------------------------------

    /**
     * Executes Kotak Neo 2-step authentication:
     *   Step 2a: POST /login/1.0/tradeApiLogin (mobileNumber, ucc, totp)
     *   Step 2b: POST /login/1.0/tradeApiValidate (mpin)
     *
     * @param {Object} [params]
     * @param {string} [params.ucc] - Client code
     * @param {string} [params.mobileNumber] - Mobile number with +91
     * @param {string} [params.mpin] - 6-digit MPIN
     * @param {string} [params.totpSecret] - Base32 secret key from authenticator QR
     * @param {string} [params.totp] - 6-digit TOTP code
     * @param {string} [params.apiKey] - Neo API access token
     */
    async login({
        ucc = this.clientId,
        mobileNumber = this.mobileNumber,
        mpin = this.password,
        totpSecret = this.totpSecret,
        totp = "",
        apiKey = this.apiKey
    } = {}) {
        const clientUcc = String(ucc || "").trim().toUpperCase();
        const mob = this._formatMobile(mobileNumber);
        const pin = String(mpin || "").trim();
        const apiToken = String(apiKey || "").trim();
        const secret = extractSecretFromInput(totpSecret || this.totpSecret);

        if (!clientUcc) {
            throw new Error("UCC (Client Code) is required for Kotak Neo login");
        }
        if (!mob) {
            throw new Error("Mobile Number is required for Kotak Neo login (e.g. +91XXXXXXXXXX)");
        }
        if (!pin) {
            throw new Error("MPIN is required for Kotak Neo login");
        }
        if (!apiToken) {
            throw new Error("API Access Token from Neo Trade API Dashboard is required");
        }

        // Generate TOTP if not passed directly
        let computedTotp = String(totp || "").trim();
        if (!computedTotp && secret) {
            if (/^\d{6}$/.test(secret)) {
                // If user entered the 6-digit OTP directly into the TOTP field
                computedTotp = secret;
            } else {
                computedTotp = generateTOTP(secret);
            }
        }

        if (!computedTotp || computedTotp.length !== 6) {
            throw new Error("Valid 6-digit TOTP code or TOTP Secret Key is required for Kotak Neo login");
        }

        // STEP 2a: Login with TOTP
        const step2aUrl = `${this.authHost}/login/1.0/tradeApiLogin`;
        const step2aHeaders = {
            "Authorization": apiToken,
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json",
            "accept": "application/json"
        };

        const tryStep2a = async (codeToTry) => {
            return await axios.post(step2aUrl, {
                mobileNumber: mob,
                ucc: clientUcc,
                totp: codeToTry
            }, {
                headers: step2aHeaders,
                timeout: 15000
            });
        };

        let step2aRes;
        try {
            step2aRes = await tryStep2a(computedTotp);
        } catch (err) {
            const errData = err.response?.data;
            const errCode = errData?.error?.[0]?.code || "";
            let recovered = false;

            // If Kotak Neo rejected TOTP (10506) and we have a Base32 secret key, try adjacent 30s/60s time steps for clock drift
            if (String(errCode) === "10506" && secret && !/^\d{6}$/.test(secret)) {
                const nowSec = Math.floor(Date.now() / 1000);
                for (const offset of [-30, 30, -60, 60]) {
                    try {
                        const altTotp = generateTOTP(secret, 30, 6, nowSec + offset);
                        step2aRes = await tryStep2a(altTotp);
                        recovered = true;
                        console.log(`[KotakNeo] Recovered TOTP with clock drift offset: ${offset}s`);
                        break;
                    } catch {
                        // try next offset
                    }
                }
            }

            if (!recovered) {
                const errMsg = errData?.error?.[0]?.message || errData?.errMsg || errData?.message || errData?.desc || err.message;
                throw new Error(`Kotak Neo login failed: ${errMsg}${errCode ? ` (Code: ${errCode})` : ""}`);
            }
        }

        const step2aData = step2aRes.data?.data || step2aRes.data;
        const viewToken = step2aData?.token;
        const viewSid = step2aData?.sid;

        if (!viewToken || !viewSid) {
            const msg = step2aRes.data?.emsg || step2aRes.data?.message || "Failed to obtain view session token";
            throw new Error(`Kotak Neo Login Step 2a failed: ${msg}`);
        }

        // STEP 2b: Validate with MPIN
        const step2bUrl = `${this.authHost}/login/1.0/tradeApiValidate`;
        const step2bHeaders = {
            "Authorization": apiToken,
            "neo-fin-key": "neotradeapi",
            "sid": viewSid,
            "Auth": viewToken,
            "Content-Type": "application/json",
            "accept": "application/json"
        };

        const step2bPayload = {
            mpin: pin
        };

        let step2bRes;
        try {
            step2bRes = await axios.post(step2bUrl, step2bPayload, {
                headers: step2bHeaders,
                timeout: 15000
            });
        } catch (err) {
            const errData = err.response?.data;
            const errMsg = errData?.error?.[0]?.message || errData?.errMsg || errData?.message || errData?.desc || err.message;
            const errCode = errData?.error?.[0]?.code || "";
            throw new Error(`Kotak Neo MPIN validation failed: ${errMsg}${errCode ? ` (Code: ${errCode})` : ""}`);
        }

        const step2bData = step2bRes.data?.data || step2bRes.data;
        const tradingToken = step2bData?.token;
        const tradingSid = step2bData?.sid;
        const returnedBaseUrl = step2bData?.baseUrl;

        if (!tradingToken || !tradingSid) {
            const msg = step2bRes.data?.emsg || step2bRes.data?.message || "Failed to validate MPIN";
            throw new Error(`Kotak Neo Login Step 2b failed: ${msg}`);
        }

        // Store session state
        this.tradingToken = tradingToken;
        this.tradingSid = tradingSid;
        if (returnedBaseUrl) {
            this.baseUrl = returnedBaseUrl.replace(/\/+$/, "");
        }
        this.clientId = clientUcc;
        this.mobileNumber = mob;
        this.password = pin;
        this.apiKey = apiToken;
        if (secret) this.totpSecret = secret;

        return {
            tradingToken: this.tradingToken,
            tradingSid: this.tradingSid,
            baseUrl: this.baseUrl,
            kType: step2bData?.kType || "Trade",
            status: "success"
        };
    }

    // ----------------------------------------------------------------------
    // ORDERS & TRADES
    // ----------------------------------------------------------------------

    /**
     * Fetches current day's Order Book.
     * Endpoint: GET /quick/user/orders
     */
    async getOrderBook() {
        try {
            const res = await this._request("GET", "/quick/user/orders", null, { isUrlEncoded: false });
            const data = res?.data;
            if (Array.isArray(data)) return data;
            return [];
        } catch (err) {
            const isNoData =
                err.errorCode === 5203 ||
                err.errorCode === 1004 ||
                err.status === 424 ||
                err.data?.stCode === 5203 ||
                String(err.data?.errMsg || "").toLowerCase().includes("no data") ||
                String(err.data?.desc || "").toLowerCase().includes("data not found") ||
                String(err.data?.emsg || "").toLowerCase().includes("no data") ||
                String(err.message || "").toLowerCase().includes("no data");

            if (isNoData) {
                return [];
            }
            throw err;
        }
    }

    /**
     * Fetches an order by its unique order ID.
     * Endpoint: GET /quick/user/orders/<orderNo>
     */
    async getOrderBookById(orderNo) {
        if (!orderNo) throw new Error("orderNo is required");
        const res = await this._request("GET", `/quick/user/orders/${orderNo}`, null, { isUrlEncoded: false });
        return res?.data || res;
    }

    /**
     * Fetches today's Trade Book (all executed trades).
     * Endpoint: GET /quick/user/trades
     */
    async getTradeBook() {
        try {
            const res = await this._request("GET", "/quick/user/trades", null, { isUrlEncoded: false });
            const data = res?.data;
            if (Array.isArray(data)) return data;
            return [];
        } catch (err) {
            const isNoData =
                err.errorCode === 5203 ||
                err.errorCode === 1004 ||
                err.status === 424 ||
                err.data?.stCode === 5203 ||
                String(err.data?.errMsg || "").toLowerCase().includes("no data") ||
                String(err.data?.desc || "").toLowerCase().includes("data not found") ||
                String(err.data?.emsg || "").toLowerCase().includes("no data") ||
                String(err.message || "").toLowerCase().includes("no data");

            if (isNoData) {
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
     * Fetches Order History for a specific order.
     * Endpoint: POST /quick/user/order/history
     */
    async getOrderHistory(orderNo) {
        if (!orderNo) throw new Error("orderNo is required");
        const payload = { nOrdNo: String(orderNo) };
        const res = await this._request("POST", "/quick/user/order/history", payload, { isUrlEncoded: true });
        return Array.isArray(res?.data) ? res.data : [];
    }

    /**
     * Places a new order via Kotak Neo.
     * Endpoint: POST /quick/order/rule/ms/place
     *
     * @param {Object} params
     * @param {string} params.symbol - Trading symbol (e.g. "ITBEES-EQ", "RELIANCE-EQ")
     * @param {string} [params.exchangeSegment="nse_cm"] - "nse_cm", "bse_cm", "nse_fo", "bse_fo", "cde_fo"
     * @param {string} [params.transactionType="B"] - "B" (Buy) or "S" (Sell)
     * @param {string} [params.orderType="MKT"] - "MKT", "L", "SL", "SL-M"
     * @param {string} [params.productCode="CNC"] - "CNC", "MIS", "NRML", "MTF"
     * @param {number|string} params.quantity - Quantity
     * @param {number|string} [params.price="0"] - Limit price or 0 for market
     * @param {number|string} [params.triggerPrice="0"] - Trigger price for SL
     * @param {number|string} [params.disclosedQuantity="0"] - Disclosed quantity
     * @param {string} [params.validity="DAY"] - "DAY", "IOC"
     * @param {string} [params.amo="NO"] - "NO" or "YES"
     */
    async placeOrder({
        symbol,
        exchangeSegment = "nse_cm",
        transactionType = "B",
        orderType = "MKT",
        productCode = "CNC",
        quantity,
        price = "0",
        triggerPrice = "0",
        disclosedQuantity = "0",
        validity = "DAY",
        amo = "NO"
    }) {
        if (!symbol || !quantity) {
            throw new Error("symbol and quantity are required for placeOrder");
        }

        const tt = String(transactionType).toUpperCase().startsWith("S") ? "S" : "B";
        const pt = String(orderType).toUpperCase().trim();
        const pc = String(productCode).toUpperCase().trim();
        const es = String(exchangeSegment).toLowerCase().trim();

        const jData = {
            am: amo === "YES" ? "YES" : "NO",
            dq: String(disclosedQuantity || "0"),
            es,
            mp: "0",
            pc,
            pf: "N",
            pr: String(price || "0"),
            pt,
            qt: String(quantity),
            rt: String(validity || "DAY").toUpperCase(),
            tp: String(triggerPrice || "0"),
            ts: String(symbol),
            tt
        };

        const res = await this._request("POST", "/quick/order/rule/ms/place", jData, { isUrlEncoded: true });
        return res;
    }

    /**
     * Modifies an existing pending order.
     * Endpoint: POST /quick/order/vr/modify
     */
    async modifyOrder({
        orderNo,
        symbol,
        token = "",
        exchangeSegment = "nse_cm",
        transactionType = "B",
        orderType = "L",
        productCode = "MIS",
        quantity,
        price = "0",
        triggerPrice = "0",
        disclosedQuantity = "0",
        validity = "DAY"
    }) {
        if (!orderNo || !quantity) {
            throw new Error("orderNo and quantity are required for modifyOrder");
        }

        const jData = {
            no: String(orderNo),
            ts: String(symbol || ""),
            tk: String(token || ""),
            es: String(exchangeSegment).toLowerCase(),
            tt: String(transactionType).toUpperCase().startsWith("S") ? "S" : "B",
            pt: String(orderType).toUpperCase(),
            pc: String(productCode).toUpperCase(),
            qt: String(quantity),
            pr: String(price || "0"),
            tp: String(triggerPrice || "0"),
            dq: String(disclosedQuantity || "0"),
            vd: String(validity || "DAY"),
            mp: "0"
        };

        const res = await this._request("POST", "/quick/order/vr/modify", jData, { isUrlEncoded: true });
        return res;
    }

    /**
     * Cancels an open order.
     * Endpoint: POST /quick/order/cancel
     */
    async cancelOrder({ orderNo, amo = "NO", symbol = "" }) {
        if (!orderNo) throw new Error("orderNo is required for cancelOrder");

        const jData = {
            on: String(orderNo),
            am: amo === "YES" ? "YES" : "NO"
        };
        if (amo === "YES" && symbol) {
            jData.ts = symbol;
        }

        const res = await this._request("POST", "/quick/order/cancel", jData, { isUrlEncoded: true });
        return res;
    }

    // ----------------------------------------------------------------------
    // PORTFOLIO: POSITIONS, HOLDINGS & LIMITS
    // ----------------------------------------------------------------------

    /**
     * Fetches current day's open and closed positions.
     * Endpoint: GET /quick/user/positions
     */
    async getPositions() {
        try {
            const res = await this._request("GET", "/quick/user/positions", null, { isUrlEncoded: false });
            let data = res?.data;
            if (Array.isArray(data) && data.length > 0) return data;

            // Fallback to /portfolio/v2/positions if /quick/user/positions is empty
            try {
                const v2Res = await this._request("GET", "/portfolio/v2/positions", null, { isUrlEncoded: false });
                if (Array.isArray(v2Res?.data) && v2Res.data.length > 0) return v2Res.data;
            } catch {
                // Ignore fallback error
            }

            return Array.isArray(data) ? data : [];
        } catch (err) {
            const isNoData =
                err.errorCode === 5203 ||
                err.errorCode === 1004 ||
                err.status === 424 ||
                err.data?.stCode === 5203 ||
                String(err.data?.errMsg || "").toLowerCase().includes("no data") ||
                String(err.data?.desc || "").toLowerCase().includes("data not found") ||
                String(err.data?.emsg || "").toLowerCase().includes("no data") ||
                String(err.message || "").toLowerCase().includes("no data");

            if (isNoData) {
                return [];
            }
            throw err;
        }
    }

    /**
     * Fetches long-term delivery holdings.
     * Endpoint: GET /portfolio/v1/holdings
     */
    async getHoldings() {
        try {
            const res = await this._request("GET", "/portfolio/v1/holdings", null, { isUrlEncoded: false });
            const data = res?.data;
            if (Array.isArray(data)) return data;
            return [];
        } catch (err) {
            const isNoData =
                err.errorCode === 5203 ||
                err.errorCode === 1004 ||
                err.status === 424 ||
                err.data?.stCode === 5203 ||
                String(err.data?.errMsg || "").toLowerCase().includes("no data") ||
                String(err.data?.desc || "").toLowerCase().includes("data not found") ||
                String(err.data?.emsg || "").toLowerCase().includes("no data") ||
                String(err.message || "").toLowerCase().includes("no data") ||
                String(err.message || "").toLowerCase().includes("no holdings");

            if (isNoData) {
                return [];
            }
            throw err;
        }
    }

    /**
     * Fetches account funds, margin, and collateral limits.
     * Endpoint: POST /quick/user/limits
     */
    async getLimits({ seg = "ALL", exch = "ALL", prod = "ALL" } = {}) {
        const jData = { seg, exch, prod };
        const res = await this._request("POST", "/quick/user/limits", jData, { isUrlEncoded: true });
        return res || {};
    }

    /**
     * Standard alias for RMS limits to conform with other broker adapters
     */
    async getRMS() {
        return await this.getLimits();
    }

    /**
     * Standard alias for fund limits
     */
    async getFundLimits() {
        return await this.getLimits();
    }

    // ----------------------------------------------------------------------
    // MARKET DATA: QUOTES & LTP
    // ----------------------------------------------------------------------

    /**
     * Fetches live market quotes for instruments.
     * Endpoint: GET /script-details/1.0/quotes/neosymbol/<query>/<filter>
     *
     * @param {string|Array<string>} symbols - e.g. ["nse_cm|RELIANCE-EQ", "nse_cm|TCS-EQ"] or "nse_cm|RELIANCE-EQ"
     * @param {string} [filter="all"] - "all", "ltp", "ohlc", "depth", "52W", "oi", "circuit_limits"
     */
    async getQuotes(symbols, filter = "all") {
        if (!symbols) return [];
        const queryList = Array.isArray(symbols) ? symbols : [symbols];
        if (queryList.length === 0) return [];

        const queryStr = queryList.join(",");
        const path = `/script-details/1.0/quotes/neosymbol/${encodeURIComponent(queryStr)}/${filter}`;

        const res = await this._request("GET", path, null, {
            useApiKey: true,
            noAuth: false,
            isUrlEncoded: false
        });

        if (Array.isArray(res)) return res;
        if (Array.isArray(res?.data)) return res.data;
        return res ? [res] : [];
    }

    /**
     * Fetches Last Traded Price (LTP) for an instrument.
     * @param {Object} params
     * @param {string} params.symbol - e.g. "RELIANCE-EQ" or "RELIANCE"
     * @param {string} [params.exchangeSegment="nse_cm"] - "nse_cm", "bse_cm", "nse_fo"
     */
    async getLtp({ symbol, exchangeSegment = "nse_cm" }) {
        if (!symbol) throw new Error("symbol is required for getLtp");

        let cleanSymbol = String(symbol).trim();
        // Ensure -EQ suffix for equity if omitted
        if (exchangeSegment.endsWith("_cm") && !cleanSymbol.includes("-") && !cleanSymbol.includes(" ")) {
            cleanSymbol = `${cleanSymbol}-EQ`;
        }

        const query = `${exchangeSegment.toLowerCase()}|${cleanSymbol}`;
        const quotes = await this.getQuotes([query], "ltp");
        if (quotes && quotes.length > 0) {
            const first = quotes[0];
            return {
                symbol: cleanSymbol,
                ltp: Number(first.ltp || 0),
                change: Number(first.change || 0),
                perChange: Number(first.per_change || 0),
                raw: first
            };
        }
        return { symbol: cleanSymbol, ltp: 0 };
    }
}

export default KotakNeoAdapter;
