import dns from "dns";
if (dns && typeof dns.setDefaultResultOrder === "function") {
    dns.setDefaultResultOrder("ipv4first");
}

import express from "express";
import cors from "cors";
import userRoutes from "./routes/userRoutes.js";
import brokerAccountRoutes from "./routes/brokerAccountRoutes.js";
import tradeRoutes from "./routes/tradeRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import copyTradingRoutes from "./routes/copyTradingRoutes.js";
import journalRoutes from "./routes/journalRoutes.js"; // ✅ Trading Journal routes
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// ✅ Serve uploaded journal screenshots and attachments securely
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

app.get("/", (req, res) => {
    res.json({
        message: "TradeGuard API is running"
    });
});

app.use("/api/users", userRoutes);
app.use("/api/broker-accounts", brokerAccountRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/copy-trading", copyTradingRoutes);
app.use("/api/journal", journalRoutes); // ✅ Mount Trading Journal endpoint

export default app;