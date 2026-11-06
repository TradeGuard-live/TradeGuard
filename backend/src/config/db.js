import crypto from "crypto";
try {
    if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.getRandomValues) {
        globalThis.crypto = crypto.webcrypto || crypto;
    }
} catch {
    // Read-only getter on modern Node.js runtimes
}

import mongoose from "mongoose";

export const connectDB = async () => {
    try {
        // ✅ Security: Redacted MONGO_URI from logs to prevent database credential exposure
        console.log("Connecting to MongoDB database...");
        await mongoose.connect(process.env.MONGO_URI, {
            dbName: "tradeguard"
        });

        console.log(`MongoDB Connected successfully to database: ${mongoose.connection.name}`);

    } catch (error) {

        console.error(
            "Error connecting to MongoDB:",
            error.message
        );

        throw error;
    }
};