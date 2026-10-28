import crypto from 'crypto';
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
    globalThis.crypto = crypto.webcrypto || crypto;
}
if (typeof global.crypto === 'undefined' || !global.crypto.getRandomValues) {
    global.crypto = crypto.webcrypto || crypto;
}

import dotenv from 'dotenv';
dotenv.config();

import userRoutes from './routes/userRoutes.js';
import brokerAccountRoutes from './routes/brokerAccountRoutes.js';
import tradeRoutes from './routes/tradeRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';

import express from 'express';
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

// --------------------
// Routes
// --------------------

app.use("/api/users", userRoutes);
app.use("/api/broker-accounts", brokerAccountRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/webhooks", webhookRoutes);

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
// Initialize WebSocket
// --------------------

liveWebSocketService.initialize(server);

// --------------------
// Start Server
// --------------------

const startServer = async () => {
    try {
        await connectDB();

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

startServer();