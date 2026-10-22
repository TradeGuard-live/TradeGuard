import dotenv from "dotenv";

dotenv.config({
     path: ".env"
});

import mongoose from "mongoose";

import { connectDB } from "../config/db.js";

import {
    syncUpstoxHistoricalTrades
} from "../brokers/upstox/UpstoxSyncService.js";

import BrokerAccount
    from "../models/BrokerAccount.js";

const run = async () => {

    try {

       
        await connectDB();


       
        const brokerAccount =
            await BrokerAccount.findOne({
                broker: "UPSTOX",
                isActive: true
            });

            
        if (!brokerAccount) {

            throw new Error(
                "No active Upstox broker account found"
            );
        }


        console.log(
            "Using Upstox BrokerAccount:",
            brokerAccount._id.toString()
        );


        /*
         * Synchronize historical trades.
         *
         * For our first test, use a broad date range.
         */
        const result =
            await syncUpstoxHistoricalTrades({

                brokerAccountId:
                    brokerAccount._id,

                startDate:
                    "2025-04-01",

                endDate:
                    "2026-09-28"
            });


        console.log(
            "\n========== SYNC RESULT =========="
        );

        console.log(result);


    } catch (error) {

        console.error(
            "\nSYNC FAILED:",
            error.message
        );

    } finally {

        /*
         * Close MongoDB connection when the script finishes.
         */
        await mongoose.connection.close();

        process.exit(0);
    }
};


run();