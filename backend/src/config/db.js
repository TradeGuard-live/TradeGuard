import crypto from "crypto";
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.randomBytes) {
    globalThis.crypto = crypto;
}
if (typeof global.crypto === "undefined" || !global.crypto.randomBytes) {
    global.crypto = crypto;
}

import mongoose from "mongoose";

export const connectDB = async () => {
    try {
        console.log("Connecting to MongoDB:", process.env.MONGO_URI);
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