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
// CORS
// --------------------

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
};

app.use(cors(corsOptions));

app.use(express.json());

// --------------------
// Routes
// --------------------

app.use("/api/users", userRoutes);
app.use("/api/broker-accounts", brokerAccountRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/webhooks", webhookRoutes);

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
            error
        );

        process.exit(1);
    }
};

startServer();