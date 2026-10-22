import UpstoxAdapter from "./UpstoxAdaptor.js";

import {
    mapUpstoxTrade
} from "./UpstoxMapper.js";

import BrokerAccount from "../../models/BrokerAccount.js";
import TradeRecord from "../../models/TradeRecord.js";

import { decrypt } from "../../utils/encryption.js";


const syncUpstoxHistoricalTrades = async ({
    brokerAccountId,
    startDate,
    endDate
}) => {

    // ==================================================
    // VALIDATION
    // ==================================================

    if (!brokerAccountId) {
        throw new Error(
            "brokerAccountId is required"
        );
    }

    if (!startDate || !endDate) {
        throw new Error(
            "startDate and endDate are required"
        );
    }


    // ==================================================
    // GET BROKER ACCOUNT
    // ==================================================

    const brokerAccount =
        await BrokerAccount.findById(
            brokerAccountId
        );


    if (!brokerAccount) {
        throw new Error(
            "Broker account not found"
        );
    }


    if (brokerAccount.broker !== "UPSTOX") {
        throw new Error(
            "Broker account is not an Upstox account"
        );
    }


    if (!brokerAccount.isActive) {
        throw new Error(
            "Upstox broker account is inactive"
        );
    }


    if (!brokerAccount.credentials?.accessToken) {
        throw new Error(
            "Upstox access token not found"
        );
    }


    // ==================================================
    // DECRYPT ACCESS TOKEN
    // ==================================================

    const accessToken =
        decrypt(
            brokerAccount.credentials.accessToken
        );


    if (!accessToken) {
        throw new Error(
            "Failed to decrypt Upstox access token"
        );
    }


    console.log(
        "Upstox access token decrypted successfully"
    );


    // IMPORTANT:
    // Keep this inside the function so it can be used
    // by both trade sync and positions/P&L.

    const upstox =
        new UpstoxAdapter(accessToken);


    // ==================================================
    // 1. FETCH ALL HISTORICAL TRADES
    // ==================================================

    let historicalTrades = [];

    let pageNumber = 1;

    const pageSize = 5000;


    while (true) {

        console.log(
            `Fetching Upstox historical trades - page ${pageNumber}`
        );


        const result =
            await upstox.getHistoricalTrades({

                startDate,

                endDate,

                pageNumber,

                pageSize

            });


        const pageTrades =
            result.trades;


        if (
            !Array.isArray(pageTrades) ||
            pageTrades.length === 0
        ) {

            console.log(
                `No more historical trades on page ${pageNumber}`
            );

            break;
        }


        historicalTrades.push(
            ...pageTrades
        );


        console.log(
            `Historical page ${pageNumber}: ${pageTrades.length} trades`
        );


        if (pageTrades.length < pageSize) {
            break;
        }


        pageNumber++;
    }


    console.log(
        "Total historical trades fetched:",
        historicalTrades.length
    );


    // ==================================================
    // 2. FETCH TODAY'S TRADES
    // ==================================================

    let todayTrades = [];


    try {

        todayTrades =
            await upstox.getTradesForDay();


        if (!Array.isArray(todayTrades)) {
            todayTrades = [];
        }


        console.log(
            "Today's trades fetched:",
            todayTrades.length
        );

    } catch (error) {

        console.error(
            "Failed to fetch today's trades:",
            error.message
        );

        // Don't completely fail historical sync
        // if today's endpoint fails.

        todayTrades = [];
    }


    // ==================================================
    // 3. COMBINE BOTH SOURCES
    // ==================================================

    const allTrades = [
        ...historicalTrades,
        ...todayTrades
    ];


    console.log(
        "Total trades before deduplication:",
        allTrades.length
    );


    // ==================================================
    // 4. REMOVE DUPLICATE TRADE IDs
    // ==================================================

    const uniqueTradesMap =
        new Map();


    for (const trade of allTrades) {

        if (!trade?.trade_id) {

            console.warn(
                "Skipping trade without trade_id:",
                trade
            );

            continue;
        }


        const tradeId =
            String(trade.trade_id);


        uniqueTradesMap.set(
            tradeId,
            trade
        );
    }


    const trades =
        Array.from(
            uniqueTradesMap.values()
        );


    console.log(
        "Unique trades to save:",
        trades.length
    );


    // ==================================================
    // 5. SAVE TRADES
    // ==================================================

    let inserted = 0;

    let updated = 0;

    let skipped = 0;


    for (const trade of trades) {

        try {

            const mappedTrade =
                mapUpstoxTrade(trade);


            mappedTrade.userId =
                brokerAccount.userId;


            mappedTrade.brokerAccountId =
                brokerAccount._id;


            mappedTrade.broker =
                "UPSTOX";


            // ------------------------------------------
            // TRADE ID IS REQUIRED
            // ------------------------------------------

            if (!mappedTrade.tradeId) {

                console.warn(
                    "Skipping trade because tradeId is missing:",
                    trade
                );

                skipped++;

                continue;
            }


            // ------------------------------------------
            // UPSERT
            // ------------------------------------------

            const result =
                await TradeRecord.updateOne(

                    {
                        brokerAccountId:
                            brokerAccount._id,

                        tradeId:
                            mappedTrade.tradeId
                    },

                    {
                        $set:
                            mappedTrade
                    },

                    {
                        upsert: true
                    }
                );


            if (result.upsertedCount === 1) {

                inserted++;

            } else if (
                result.modifiedCount === 1
            ) {

                updated++;

            } else {

                // Existing document but no changes
                updated++;
            }


        } catch (error) {

            console.error(
                "Failed to save Upstox trade:",
                error.message
            );

            skipped++;
        }
    }


    // ==================================================
    // 6. FETCH CURRENT POSITIONS
    // ==================================================

    console.log("");
    console.log(
        "Fetching current Upstox positions..."
    );


    const positions =
        await upstox.getPositions();


    console.log(
        "Current positions fetched:",
        positions.length
    );


    // ==================================================
    // 7. CALCULATE & PRINT P&L
    // ==================================================

    console.log("");
    console.log(
        "===================================="
    );

    console.log(
        "TRADEGUARD P&L SNAPSHOT"
    );

    console.log(
        "===================================="
    );


    let totalUnrealised = 0;

    let totalRealised = 0;


    if (positions.length === 0) {

        console.log(
            "No open positions found."
        );

    } else {

        for (const position of positions) {

            const quantity =
                Number(
                    position.quantity || 0
                );


            const averagePrice =
                Number(
                    position.average_price || 0
                );


            const lastPrice =
                Number(
                    position.last_price || 0
                );


            const unrealised =
                Number(
                    position.unrealised || 0
                );


            const realised =
                Number(
                    position.realised || 0
                );


            totalUnrealised +=
                unrealised;


            totalRealised +=
                realised;


            console.log("");

            console.log(
                position.trading_symbol
            );


            console.log(
                "------------------------------------"
            );


            console.log(
                "Quantity       :",
                quantity
            );


            console.log(
                "Average Price  : ₹",
                averagePrice
            );


            console.log(
                "Last Price     : ₹",
                lastPrice
            );


            console.log(
                "Unrealised P&L : ₹",
                unrealised
            );


            console.log(
                "Realised P&L   : ₹",
                realised
            );
        }
    }


    // ==================================================
    // 8. TOTAL P&L
    // ==================================================

    const totalPnl =
        totalUnrealised +
        totalRealised;


    console.log("");

    console.log(
        "------------------------------------"
    );


    console.log(
        "Total Unrealised P&L : ₹",
        totalUnrealised
    );


    console.log(
        "Total Realised P&L   : ₹",
        totalRealised
    );


    console.log(
        "Total P&L            : ₹",
        totalPnl
    );


    console.log(
        "===================================="
    );


    // ==================================================
    // 9. FINAL SYNC RESULT
    // ==================================================

    console.log(
        "UPSTOX SYNC COMPLETED"
    );


    console.log(
        "Historical fetched:",
        historicalTrades.length
    );


    console.log(
        "Today's fetched:",
        todayTrades.length
    );


    console.log(
        "Combined:",
        allTrades.length
    );


    console.log(
        "Unique:",
        trades.length
    );


    console.log(
        "Inserted:",
        inserted
    );


    console.log(
        "Updated:",
        updated
    );


    console.log(
        "Skipped:",
        skipped
    );


    console.log(
        "===================================="
    );


    // ==================================================
    // 10. RETURN RESULT
    // ==================================================

    return {
        broker: "UPSTOX",
        brokerAccountId: brokerAccount._id,
        startDate,
        endDate,
        historicalFetched: historicalTrades.length,
        todayFetched: todayTrades.length,
        totalFetched: allTrades.length,
        uniqueTrades: trades.length,
        inserted,
        updated,
        skipped,
        totalUnrealised,
        totalRealised,
        totalPnl
    };
};

const syncUpstoxTodayTrades = async ({ brokerAccountId }) => {
    if (!brokerAccountId) {
        throw new Error("brokerAccountId is required");
    }

    const brokerAccount = await BrokerAccount.findById(brokerAccountId);
    if (!brokerAccount) {
        throw new Error("Broker account not found");
    }
    if (brokerAccount.broker !== "UPSTOX") {
        throw new Error("Broker account is not an Upstox account");
    }
    if (!brokerAccount.isActive) {
        throw new Error("Upstox broker account is inactive");
    }
    if (!brokerAccount.credentials?.accessToken) {
        throw new Error("Upstox access token not found");
    }

    const accessToken = decrypt(brokerAccount.credentials.accessToken);
    if (!accessToken) {
        throw new Error("Failed to decrypt Upstox access token");
    }

    const upstox = new UpstoxAdapter(accessToken);

    let todayTrades = [];
    try {
        todayTrades = await upstox.getTradesForDay();
        if (!Array.isArray(todayTrades)) todayTrades = [];
    } catch (err) {
        console.warn("Could not fetch today trades from Upstox:", err.message);
        todayTrades = [];
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const trade of todayTrades) {
        try {
            const mapped = mapUpstoxTrade(trade);
            mapped.userId = brokerAccount.userId;
            mapped.brokerAccountId = brokerAccount._id;
            mapped.broker = "UPSTOX";

            if (!mapped.tradeId) {
                skipped++;
                continue;
            }

            const res = await TradeRecord.updateOne(
                { brokerAccountId: brokerAccount._id, tradeId: mapped.tradeId },
                { $set: mapped },
                { upsert: true }
            );

            if (res.upsertedCount === 1) inserted++;
            else updated++;
        } catch (err) {
            skipped++;
        }
    }

    let positions = [];
    try {
        positions = await upstox.getPositions();
    } catch (err) {
        // ignore
    }

    return {
        broker: "UPSTOX",
        brokerAccountId: brokerAccount._id,
        todayFetched: todayTrades.length,
        inserted,
        updated,
        skipped,
        positionsFetched: positions.length
    };
};

// ==================================================
// EXPORT
// ==================================================

export {
    syncUpstoxHistoricalTrades,
    syncUpstoxTodayTrades
};