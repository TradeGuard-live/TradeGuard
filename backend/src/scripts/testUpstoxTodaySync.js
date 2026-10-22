import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import BrokerAccount from "../models/BrokerAccount.js";

import {
    syncUpstoxTodayTrades
} from "../brokers/upstox/UpstoxSyncService.js";


try {
    await connectDB();

    const account = await BrokerAccount.findOne({
        broker: "UPSTOX",
        isActive: true
    });

    if (!account) {
        throw new Error("No active Upstox account found");
    }

    console.log("Using Upstox account:", account._id);

    const result = await syncUpstoxTodayTrades({
        brokerAccountId: account._id
    });

    console.log("TODAY SYNC RESULT:", result);

} catch (error) {
    console.error("Today's Upstox sync failed:", error.message);
} finally {
    await mongoose.disconnect();
}