import dns from 'dns';
if (dns && typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

import crypto from 'crypto';
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
    globalThis.crypto = crypto.webcrypto || crypto;
}
if (typeof global.crypto === 'undefined' || !global.crypto.getRandomValues) {
    global.crypto = crypto.webcrypto || crypto;
}

// ✅ Prevent unhandled 3rd-party SDK exceptions or WebSocket connection rejections from crashing the server
process.on('unhandledRejection', (reason) => {
    console.warn('[Server] Unhandled Promise Rejection intercepted:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught Exception intercepted:', err?.message || err);
});

import dotenv from 'dotenv';
dotenv.config();

import userRoutes from './routes/userRoutes.js';
import brokerAccountRoutes from './routes/brokerAccountRoutes.js';
import tradeRoutes from './routes/tradeRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import copyTradingRoutes from './routes/copyTradingRoutes.js';
import journalRoutes from './routes/journalRoutes.js'; // ✅ Trading Journal routes
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import express from 'express';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import cors from 'cors';
import http from 'http';

import liveWebSocketService from './services/Websocket/LiveWebSocketSevice.js';

const app = express();

const PORT = process.env.PORT || 5000;

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

// ✅ Limit request payload size to prevent DoS
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ✅ Serve uploaded journal screenshots and attachments securely
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

// --------------------
// Routes
// --------------------

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        message: "TradeGuard API is running"
    });
});

// ✅ Health check endpoint for container orchestrators and load balancers
app.get(["/health", "/api/health"], (req, res) => {
    const isHealthy = mongoose.connection.readyState === 1;
    const dbStatus = isHealthy ? "connected" : (mongoose.connection.readyState === 2 ? "connecting" : "disconnected");
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? "ok" : "degraded",
        uptime: Math.round(process.uptime()),
        database: dbStatus,
        timestamp: new Date().toISOString()
    });
});

app.use("/api/users", userRoutes);
app.use("/api/broker-accounts", brokerAccountRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/copy-trading", copyTradingRoutes);
app.use("/api/journal", journalRoutes); // ✅ Mounted Trading Journal endpoint

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

// --------------------
// Create HTTP Server
// --------------------

const server = http.createServer(app);

// --------------------
// Startup Configuration Validation
// --------------------

// ✅ Validate critical environment variables for production startup
export const validateStartupConfig = (env = process.env) => {
    if (env.NODE_ENV === "production") {
        const requiredVars = ["JWT_SECRET", "ENCRYPTION_KEY", "ANGEL_WEBHOOK_SECRET"];
        const missing = requiredVars.filter(v => !env[v] || String(env[v]).trim() === "");
        if (missing.length > 0) {
            throw new Error(`[Startup Error] Missing critical environment variables in production: ${missing.join(", ")}`);
        }
    }
};

// --------------------
// Start Server
// --------------------

const startServer = async () => {
    try {
        validateStartupConfig();
        await connectDB();

        // --------------------
        // Initialize WebSocket
        // --------------------
        liveWebSocketService.initialize(server);

        server.listen(PORT, () => {
            console.log(
                `TradeGuard server running on port ${PORT}`
            );

            console.log(
                `Live WebSocket running on ws://localhost:${PORT}/ws/live`
            );
        });

    } catch (error) {
        console.error(
            "Failed to start TradeGuard server:",
            error.message
        );
        process.exit(1);
    }
};

// ✅ Graceful shutdown handler for production process managers (PM2, Docker, Kubernetes)
const gracefulShutdown = (signal) => {
    console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
    server.close(async () => {
        console.log("[Server] HTTP server closed.");
        try {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.connection.close(false);
                console.log("[Server] MongoDB connection closed cleanly.");
            }
            process.exit(0);
        } catch (err) {
            console.error("[Server] Error during database disconnect:", err.message);
            process.exit(1);
        }
    });

    setTimeout(() => {
        console.error("[Server] Graceful shutdown timed out. Forcing process exit.");
        process.exit(1);
    }, 10000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain && process.env.NODE_ENV !== "test") {
    startServer();
}