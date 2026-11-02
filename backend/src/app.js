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

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

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

export default app;