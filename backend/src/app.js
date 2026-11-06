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

// --------------------
// Security Headers Middleware
// --------------------
// ✅ Security hardening: set standard security headers
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    if (process.env.NODE_ENV === "production") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
});

// --------------------
// CORS Configuration
// --------------------
// ✅ Tightened CORS: strictly validate origins against whitelist
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')))) {
            return callback(null, true);
        }
        return callback(new Error('Blocked by CORS policy: Origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// ✅ Serve uploaded journal screenshots and attachments securely
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        message: "TradeGuard API is running"
    });
});

app.use("/api/users", userRoutes);
app.use("/api/broker-accounts", brokerAccountRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/copy-trading", copyTradingRoutes);
app.use("/api/journal", journalRoutes); // ✅ Mount Trading Journal endpoint

// --------------------
// Centralized Error Handling
// --------------------
// ✅ Redact stack traces in production to prevent internal information leakage
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = process.env.NODE_ENV === "production" && status === 500
        ? "An internal server error occurred"
        : err.message || "An unexpected error occurred";
    res.status(status).json({ success: false, message });
});

export default app;