import axios from "axios";

class UpstoxAdapter {

    constructor(accessToken) {

        if (!accessToken) {
            throw new Error("Upstox access token is required");
        }

        this.accessToken = accessToken;

        this.baseURL = "https://api.upstox.com/v2";

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 10000,
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${this.accessToken}`
            }
        });
    }


    // --------------------------------------------------
    // HISTORICAL TRADES
    // --------------------------------------------------

    async getHistoricalTrades({
        startDate,
        endDate,
        pageNumber = 1,
        pageSize = 5000
    }) {

        if (!startDate || !endDate) {
            throw new Error(
                "startDate and endDate are required"
            );
        }

        try {

            const response = await this.client.get(
                "/charges/historical-trades",
                {
                    params: {
                        start_date: startDate,
                        end_date: endDate,
                        page_number: pageNumber,
                        page_size: pageSize
                    }
                }
            );

            return {
                trades: response.data.data || [],
                metadata: response.data.meta_data || {}
            };

        } catch (error) {

            console.error(
                "Upstox Historical Trades Error:",
                error.response?.data || error.message
            );

            throw new Error(
                error.response?.data?.errors?.[0]?.message ||
                "Failed to fetch historical trades from Upstox"
            );
        }
    }


    // --------------------------------------------------
    // TODAY'S TRADES
    // --------------------------------------------------

    async getTradesForDay() {

        try {

            const response = await this.client.get(
                "/order/trades/get-trades-for-day"
            );

            return response.data.data || [];

        } catch (error) {

            console.error(
                "Upstox Today's Trades Error:",
                error.response?.data || error.message
            );

            throw new Error(
                error.response?.data?.errors?.[0]?.message ||
                "Failed to fetch today's trades from Upstox"
            );
        }
    }


    // --------------------------------------------------
    // ORDER DETAILS
    // --------------------------------------------------

    async getOrderDetails(orderId) {

        if (!orderId) {
            throw new Error("Order ID is required");
        }

        try {

            const response = await this.client.get(
                "/order/details",
                {
                    params: {
                        order_id: orderId
                    }
                }
            );

            return response.data.data;

        } catch (error) {

            console.error(
                "Upstox Order Details Error:",
                error.response?.data || error.message
            );

            throw new Error(
                error.response?.data?.errors?.[0]?.message ||
                "Failed to fetch order details from Upstox"
            );
        }
    }


        async getPositions(retries = 1) {
        try {
            const response = await this.client.get(
                "/portfolio/short-term-positions"
            );
            return response.data?.data || [];
        } catch (error) {
            const isNetworkError =
                error.code === "EHOSTUNREACH" ||
                error.code === "ENETUNREACH" ||
                error.code === "ECONNRESET" ||
                error.code === "ETIMEDOUT" ||
                /EHOSTUNREACH|ENETUNREACH|ECONNRESET|ETIMEDOUT|Network Error/i.test(error.message);

            if (isNetworkError && retries > 0) {
                console.warn(`[UpstoxAdapter] Transient network notice (${error.code || error.message}), retrying in 600ms...`);
                await new Promise(r => setTimeout(r, 600));
                return this.getPositions(retries - 1);
            }

            console.error(
                "Upstox Positions Error:",
                error.response?.data || error.message
            );

            const customError = new Error(
                error.response?.data?.errors?.[0]?.message ||
                (isNetworkError ? `Upstox network unreachable (${error.code || error.message})` : "Failed to fetch positions from Upstox")
            );
            customError.code = error.code;
            customError.status = error.response?.status;
            customError.response = error.response;
            throw customError;
        }
    }
}

export default UpstoxAdapter;