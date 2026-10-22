# TradeGuard Backend — Complete API Reference & Navigation Guide

> **Purpose:** This document describes every backend route, model, service, and navigation flow so a frontend LLM can build the UI accordingly.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Server Entry Points](#2-server-entry-points)
3. [Environment Variables](#3-environment-variables)
4. [Database Models (Mongoose Schemas)](#4-database-models-mongoose-schemas)
5. [All API Routes (Complete Reference)](#5-all-api-routes-complete-reference)
6. [Authentication Flow](#6-authentication-flow)
7. [Broker Account Management Flow](#7-broker-account-management-flow)
8. [Trade Record System](#8-trade-record-system)
9. [Financial Calculations Service](#9-financial-calculations-service)
10. [Broker Integrations](#10-broker-integrations)
11. [Utility Modules](#11-utility-modules)
12. [Error Handling Patterns](#12-error-handling-patterns)
13. [Frontend Navigation Map](#13-frontend-navigation-map)
14. [What Does NOT Exist (Gaps to Be Aware Of)](#14-what-does-not-exist-gaps-to-be-aware-of)

---

## 1. Architecture Overview

| Aspect | Detail |
|--------|--------|
| **Framework** | Express.js 5.2.1 (ES Modules — `"type": "module"`) |
| **Database** | MongoDB via Mongoose 9.9.2 |
| **Auth** | JWT (`jsonwebtoken` 9.0.3) + `bcrypt` password hashing |
| **Encryption** | CryptoJS AES for broker API credentials |
| **Email** | Nodemailer (Gmail) for password reset |
| **HTTP Client** | Axios (for Upstox API calls) |
| **Validation** | NONE — all validation is manual `if` checks in controllers |
| **Auth Middleware** | NONE — all routes are currently public |
| **Error Handling** | NONE centralized — each controller has its own try/catch |

---

## 2. Server Entry Points

### Primary: `backend/src/server.js`
- **Run with:** `npm start` or `npm run dev`
- **Port:** `process.env.PORT` or `5000`
- **CORS:** Restricted to `http://localhost:3000`, methods: GET/POST/PUT/DELETE, credentials: true
- **Body parsing:** `express.json()`
- **Database:** Connects to MongoDB via `connectDB()`
- **Routes mounted:**
  - `/api/users` → `userRoutes`
  - `/api/broker-accounts` → `brokerAccountRoutes`

### Secondary: `backend/src/app.js`
- Exports an Express app (likely for testing)
- Permissive CORS (all origins)
- Health check: `GET /` → `{ message: "TradeGuard API is running" }`
- Mounts only `/api/broker-accounts`
- Does NOT connect to DB, does NOT start server

---

## 3. Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `PORT` | Server port (default: 5000) | Yes |
| `MONGO_URI` | MongoDB connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `ENCRYPTION_KEY` | AES key for broker credentials | Yes |
| `UPSTOX_CLIENT_ID` | Upstox API client ID | For Upstox |
| `UPSTOX_CLIENT_SECRET` | Upstox API client secret | For Upstox |
| `UPSTOX_ACCESS_TOKEN` | Upstox access token | For Upstox |
| `EMAIL_USER` | Gmail address for sending emails | For password reset |
| `EMAIL_PASS` | Gmail app password | For password reset |
| `RESET_URL` | Frontend URL for password reset links | For password reset |
| `ANGEL_API_KEY` | Angel One API key | For Angel One |
| `ANGEL_CLIENT_ID` | Angel One client ID | For Angel One |
| `DHAN_CLIENT_ID` | Dhan client ID | For Dhan |
| `DHAN_ACCESS_TOKEN` | Dhan access token | For Dhan |

---

## 4. Database Models (Mongoose Schemas)

### 4.1 User Model (`backend/src/models/User.js`)

```javascript
{
  userId:    Number,    // Auto-incremented (manually calculated in register)
  username:  String,    // Required
  email:     String,    // Required
  password:  String,    // Required — bcrypt hashed (10 rounds) in pre-save hook
  createdAt: Date,      // Auto (timestamps: true)
  updatedAt: Date       // Auto (timestamps: true)
}
```

**Pre-save hook:** Hashes `password` with bcrypt if `isModified('password')`

---

### 4.2 BrokerAccount Model (`backend/src/models/BrokerAccount.js`)

```javascript
{
  userId:          ObjectId,  // ref: 'User' — Required
  broker:          String,    // Required — enum: ['UPSTOX', 'ANGEL_ONE', 'DHAN']
  credentials: {
    clientId:      String,    // Required
    apiKey:        String,    // Optional — AES encrypted before save
    apiSecret:     String,    // Optional — AES encrypted before save
    accessToken:   String,    // Optional — AES encrypted before save
    refreshToken:  String,    // Optional — AES encrypted before save
    tokenExpiresAt: Date      // Optional
  },
  isConnected:     Boolean,   // Default: false
  isActive:        Boolean,   // Default: true
  lastConnectedAt: Date,      // Optional
  createdAt:       Date,      // Auto
  updatedAt:       Date       // Auto
}
```

**Indexes:** Unique compound index on `{ userId: 1, broker: 1 }` — one account per broker per user

**Pre-save hook:** Encrypts `apiKey`, `apiSecret`, `accessToken`, `refreshToken` using AES (CryptoJS) if modified

**Sensitive fields stripped from ALL API responses:** `apiKey`, `apiSecret`, `accessToken`, `refreshToken`

---

### 4.3 TradeRecord Model (`backend/src/models/TradeRecord.js`)

```javascript
{
  userId:           ObjectId,  // ref: 'User' — Required, indexed
  brokerAccountId: ObjectId,  // ref: 'BrokerAccount' — Required
  broker:           String,    // Required — enum: ['UPSTOX', 'ANGEL_ONE', 'DHAN']
  tradeId:          String,    // Required — broker's unique trade ID
  orderId:          String,    // Optional — default: null
  symbol:           String,    // Required
  exchange:         String,    // Optional
  segment:          String,    // Optional — enum: ['EQUITY', 'FUTURES', 'OPTIONS']
  transactionType:  String,    // Required — enum: ['BUY', 'SELL']
  quantity:         Number,    // Required
  executedPrice:    Number,    // Required
  orderType:        String,    // Optional — enum: ['MARKET', 'LIMIT', 'SL', 'SL-M']
  status:           String,    // Optional — enum: ['PENDING', 'TRANSIT', 'COMPLETE', 'CANCELLED', 'REJECTED', 'FAILED']
  brokerResponse:   Mixed,     // Optional — raw broker response
  createdAt:        Date,      // Auto
  updatedAt:        Date       // Auto
}
```

**Indexes:** Unique compound index on `{ brokerAccountId: 1, tradeId: 1 }`

---

## 5. All API Routes (Complete Reference)

### 5.1 User Routes — Mounted at `/api/users`

**File:** `backend/src/routes/userRoutes.js`
**Controller:** `backend/src/controllers/userController.js`

| # | Method | Full Path | Auth | Controller | Description |
|---|--------|-----------|------|------------|-------------|
| 1 | POST | `/api/users/register` | None | `register` | Create new account, returns JWT |
| 2 | POST | `/api/users/login` | None | `login` | Login, returns JWT |
| 3 | POST | `/api/users/forgot-password` | None | `forgotPassword` | Send password reset email |
| 4 | POST | `/api/users/reset-password` | None | `resetPassword` | Reset password with token |

#### Route 1: POST `/api/users/register`

**Request Body:**
```json
{
  "username": "string (required)",
  "email": "string (required)",
  "password": "string (required)"
}
```

**Success Response (201):**
```json
{
  "token": "jwt_token_string",
  "user": {
    "userId": 1,
    "username": "john_doe",
    "email": "john@example.com"
  }
}
```

**Error Responses:**
- `400` — `{ message: "All fields are required" }` (missing fields)
- `400` — `{ message: "User already exists" }` (duplicate email)
- `500` — `{ message: "Internal Server Error" }`

---

#### Route 2: POST `/api/users/login`

**Request Body:**
```json
{
  "email": "string (required)",
  "password": "string (required)"
}
```

**Success Response (200):**
```json
{
  "token": "jwt_token_string",
  "user": {
    "userId": 1,
    "username": "john_doe",
    "email": "john@example.com"
  }
}
```

**Error Responses:**
- `400` — `{ message: "All fields are required" }` (missing fields)
- `400` — `{ message: "Invalid credentials" }` (user not found or wrong password)
- `500` — `{ message: "Internal Server Error" }`

---

#### Route 3: POST `/api/users/forgot-password`

**Request Body:**
```json
{
  "email": "string (required)"
}
```

**Success Response (200):**
```json
{
  "message": "Password reset email sent",
  "token": "token"
}
```

> **NOTE:** The `token` field in the response is a literal string `"token"`, NOT the actual JWT. The actual token is sent via email.

**Error Responses:**
- `400` — `{ message: "Email is required" }`
- `500` — `{ message: "Internal Server Error" }` (also crashes if email not found — bug)

**Email sent contains:** Link to `${RESET_URL}/${token}` where token is a JWT with 15-min expiry

---

#### Route 4: POST `/api/users/reset-password`

**Request Body:**
```json
{
  "token": "string (required) — JWT from email link",
  "newPassword": "string (required)"
}
```

**Success Response (200):**
```json
{
  "message": "Password reset successful"
}
```

**Error Responses:**
- `400` — `{ message: "Token and new password are required" }`
- `400` — `{ message: "Invalid or expired token" }`
- `500` — `{ message: "Internal Server Error" }`

---

### 5.2 Broker Account Routes — Mounted at `/api/broker-accounts`

**File:** `backend/src/routes/brokerAccountRoutes.js`
**Controller:** `backend/src/controllers/brokerAccountController.js`

| # | Method | Full Path | Auth | Controller | Description |
|---|--------|-----------|------|------------|-------------|
| 1 | POST | `/api/broker-accounts/` | None | `createBrokerAccount` | Link a new broker account |
| 2 | GET | `/api/broker-accounts/` | None | `getBrokerAccounts` | List all broker accounts (optional `?userId=` filter) |
| 3 | GET | `/api/broker-accounts/:id` | None | `getBrokerAccount` | Get single broker account by ID |
| 4 | PUT | `/api/broker-accounts/:id` | None | `updateBrokerAccount` | Update broker account credentials |
| 5 | DELETE | `/api/broker-accounts/:id` | None | `deleteBrokerAccount` | Delete a broker account |

#### Route 1: POST `/api/broker-accounts/`

**Request Body:**
```json
{
  "userId": "string (required) — MongoDB ObjectId of User",
  "broker": "string (required) — one of: UPSTOX, ANGEL_ONE, DHAN",
  "credentials": {
    "clientId": "string (required)",
    "apiKey": "string (optional)",
    "apiSecret": "string (optional)",
    "accessToken": "string (optional)",
    "refreshToken": "string (optional)",
    "tokenExpiresAt": "date (optional)"
  }
}
```

**Success Response (201):**
```json
{
  "_id": "objectId",
  "userId": "objectId",
  "broker": "UPSTOX",
  "credentials": {
    "clientId": "AB123456",
    "tokenExpiresAt": null
  },
  "isConnected": false,
  "isActive": true,
  "lastConnectedAt": null,
  "createdAt": "2026-09-28T...",
  "updatedAt": "2026-09-28T..."
}
```

> **IMPORTANT:** `apiKey`, `apiSecret`, `accessToken`, `refreshToken` are NEVER returned in responses. They are encrypted at rest and stripped from output.

**Error Responses:**
- `400` — `{ success: false, message: "userId, broker, and clientId are required" }`
- `400` — `{ success: false, message: "Invalid userId format" }`
- `400` — `{ success: false, message: "Invalid broker value" }`
- `409` — `{ success: false, message: "An account with this broker already exists for the user" }`
- `500` — `{ success: false, message: "Failed to create broker account" }`

---

#### Route 2: GET `/api/broker-accounts/`

**Query Parameters:**
- `userId` (optional) — MongoDB ObjectId. If provided, filters accounts for that user.

**Success Response (200):**
```json
[
  {
    "_id": "objectId",
    "userId": "objectId",
    "broker": "UPSTOX",
    "credentials": {
      "clientId": "AB123456",
      "tokenExpiresAt": null
    },
    "isConnected": false,
    "isActive": true,
    "lastConnectedAt": null,
    "createdAt": "2026-09-28T...",
    "updatedAt": "2026-09-28T..."
  }
]
```

**Error Responses:**
- `400` — `{ success: false, message: "Invalid userId format" }`
- `500` — `{ success: false, message: "Failed to fetch broker accounts" }`

---

#### Route 3: GET `/api/broker-accounts/:id`

**URL Parameters:**
- `id` (required) — MongoDB ObjectId of the broker account

**Success Response (200):**
```json
{
  "_id": "objectId",
  "userId": "objectId",
  "broker": "UPSTOX",
  "credentials": {
    "clientId": "AB123456",
    "tokenExpiresAt": null
  },
  "isConnected": false,
  "isActive": true,
  "lastConnectedAt": null,
  "createdAt": "2026-09-28T...",
  "updatedAt": "2026-09-28T..."
}
```

**Error Responses:**
- `400` — `{ success: false, message: "Invalid account ID format" }`
- `404` — `{ success: false, message: "Broker account not found" }`
- `500` — `{ success: false, message: "Failed to fetch broker account" }`

---

#### Route 4: PUT `/api/broker-accounts/:id`

**URL Parameters:**
- `id` (required) — MongoDB ObjectId

**Request Body (all fields optional — only send what you want to update):**
```json
{
  "broker": "string — one of: UPSTOX, ANGEL_ONE, DHAN",
  "credentials": {
    "clientId": "string",
    "apiKey": "string",
    "apiSecret": "string",
    "accessToken": "string",
    "refreshToken": "string",
    "tokenExpiresAt": "date"
  },
  "isActive": "boolean"
}
```

**Success Response (200):**
```json
{
  "_id": "objectId",
  "userId": "objectId",
  "broker": "UPSTOX",
  "credentials": {
    "clientId": "AB123456",
    "tokenExpiresAt": null
  },
  "isConnected": false,
  "isActive": true,
  "lastConnectedAt": null,
  "createdAt": "2026-09-28T...",
  "updatedAt": "2026-09-28T..."
}
```

**Error Responses:**
- `400` — `{ success: false, message: "Invalid account ID format" }`
- `400` — `{ success: false, message: "Invalid broker value" }`
- `404` — `{ success: false, message: "Broker account not found" }`
- `409` — `{ success: false, message: "An account with this broker already exists for the user" }`
- `500` — `{ success: false, message: "Failed to update broker account" }`

---

#### Route 5: DELETE `/api/broker-accounts/:id`

**URL Parameters:**
- `id` (required) — MongoDB ObjectId

**Success Response (200):**
```json
{
  "success": true,
  "message": "Broker account deleted successfully"
}
```

**Error Responses:**
- `400` — `{ success: false, message: "Invalid account ID format" }`
- `404` — `{ success: false, message: "Broker account not found" }`
- `500` — `{ success: false, message: "Failed to delete broker account" }`

---

## 6. Authentication Flow

### How Auth Works

1. **Register** or **Login** → Server returns a JWT token
2. **JWT Payload:** `{ userId: <number>, email: <string> }`
3. **JWT Expiry:** 1 day (`"1d"`)
4. **JWT Secret:** `process.env.JWT_SECRET`

### Token Usage in Frontend

```
Authorization: Bearer <jwt_token>
```

### Password Reset Flow

1. User submits email → `POST /api/users/forgot-password`
2. Server generates JWT with 15-min expiry containing `{ userId }`
3. Server sends email with link: `${RESET_URL}/${token}`
4. User clicks link → Frontend extracts token from URL
5. User submits new password + token → `POST /api/users/reset-password`
6. Server verifies token, finds user by `userId` in token, updates password

---

## 7. Broker Account Management Flow

### Supported Brokers

| Broker Value | Name |
|-------------|------|
| `UPSTOX` | Upstox |
| `ANGEL_ONE` | Angel One |
| `DHAN` | Dhan |

### Lifecycle

```
1. Create Account (POST /api/broker-accounts/)
   → Provide userId, broker, credentials.clientId
   → Optional: apiKey, apiSecret, accessToken, refreshToken

2. Read Accounts (GET /api/broker-accounts/)
   → List all, or filter by ?userId=

3. Read Single (GET /api/broker-accounts/:id)
   → Get details of one account

4. Update Account (PUT /api/broker-accounts/:id)
   → Update credentials, broker, or isActive status

5. Delete Account (DELETE /api/broker-accounts/:id)
   → Permanently remove account
```

### Important Rules

- **One account per broker per user** (unique compound index on `{ userId, broker }`)
- **Credentials are encrypted** at rest using AES (CryptoJS) with `ENCRYPTION_KEY`
- **Credentials are NEVER returned** in API responses — only `clientId` and `tokenExpiresAt` are visible
- **No authentication required** for any broker account route (currently)

---

## 8. Trade Record System

### Overview

Trade records are created internally by broker sync services (not via direct API routes). They store executed trades fetched from broker APIs.

### Trade Record Fields

| Field | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | Which user owns this trade |
| `brokerAccountId` | ObjectId | Which broker account executed this trade |
| `broker` | String | Broker name (UPSTOX, ANGEL_ONE, DHAN) |
| `tradeId` | String | Broker's unique trade identifier |
| `orderId` | String | Broker's order ID |
| `symbol` | String | Trading symbol (e.g., "RELIANCE", "INFY") |
| `exchange` | String | Exchange (e.g., "NSE", "BSE") |
| `segment` | String | EQUITY, FUTURES, or OPTIONS |
| `transactionType` | String | BUY or SELL |
| `quantity` | Number | Number of shares/contracts |
| `executedPrice` | Number | Execution price per unit |
| `orderType` | String | MARKET, LIMIT, SL, or SL-M |
| `status` | String | PENDING, TRANSIT, COMPLETE, CANCELLED, REJECTED, FAILED |
| `brokerResponse` | Mixed | Raw JSON response from broker |

### Trade Record Routes

**There are NO API routes for TradeRecord.** Trades are only created/updated internally by the Upstox sync service. The frontend would need new routes to be added to view trades.

---

## 9. Financial Calculations Service

**File:** `backend/src/services/calculations.js` (842 lines)

This is a **server-side only** module with no HTTP routes. It provides:

| Function | Purpose |
|----------|---------|
| `calculateCharges(trade, brokerConfig)` | Brokerage, STT, exchange charges, SEBI, stamp duty, DP, GST |
| `calculatePnL(trade, charges)` | Gross/net P&L and ROI |
| `calculateBreakEven(trade, brokerConfig)` | Break-even price and target selling price |
| `calculateRiskReward({entryPrice, stopLoss, targetPrice, quantity, capital, maxRiskPercent, direction})` | Risk/reward ratios |
| `calculatePosition(trades)` | FIFO position matching (long/short) |
| `calculateDashboardStats(trades, now)` | Daily/weekly/monthly/overall/broker-wise statistics |

### Broker Configuration

**File:** `backend/src/services/brokers/brokerConfig.js` (351 lines)

Contains static config for each broker:
- Brokerage rates
- Statutory charges (STT, exchange, SEBI, stamp duty, GST)
- Broker-specific settings

---

## 10. Broker Integrations

### Upstox Integration

**Files:**
- `backend/src/brokers/upstox/UpstoxAdaptor.js` — HTTP client for Upstox API v2
- `backend/src/brokers/upstox/UpstoxMapper.js` — Maps Upstox responses to TradeRecord schema
- `backend/src/brokers/upstox/UpstoxSyncService.js` — Orchestrates trade sync

**UpstoxAdaptor Methods:**
| Method | Upstox API Endpoint | Purpose |
|--------|-------------------|---------|
| `getHistoricalTrades({startDate, endDate, pageNumber, pageSize})` | `GET /charges/historical-trades` | Fetch historical trades |
| `getTradesForDay()` | `GET /order/trades/get-trades-for-day` | Fetch today's trades |
| `getOrderDetails(orderId)` | `GET /order/details` | Fetch order details |

**UpstoxSyncService Methods:**
| Method | Purpose |
|--------|---------|
| `getUpstoxAdapter(brokerAccountId)` | Load account, decrypt token, create adapter |
| `saveUpstoxTrades(brokerAccount, trades)` | Upsert trades into TradeRecord collection |
| `syncUpstoxHistoricalTrades({brokerAccountId, startDate, endDate})` | Historical backfill sync |
| `syncUpstoxTodayTrades({brokerAccountId})` | Current-day sync |

### Angel One Integration (SmartAPI)

**Files:**
- `backend/src/brokers/angelOne/AngelOneAdapter.js` — Comprehensive SmartAPI client (loginByPassword, generateTokens refresh, profile, RMS limits, tradebook, orderbook, positions, holdings, LTP, candle data)
- `backend/src/brokers/angelOne/AngelOneMapper.js` — Maps Angel One API responses to standard TradeGuard trade & position schemas
- `backend/src/brokers/angelOne/AngelOneSyncService.js` — Syncs today's and historical trades into TradeRecord collection
- `backend/src/brokers/angelOne/AngelOneMarketDataService.js` — Real-time quote polling and market tick streamer
- `backend/src/utils/totp.js` — Pure Node.js RFC 6238 TOTP generator (compatible with Google Authenticator QR setup)

**Authentication & TOTP Mechanism:**
- SmartAPI requires `apiKey`, `clientcode`, `password` (Trading PIN), and a 6-digit `totp`.
- When users enable TOTP on `smartapi.angelbroking.com/enable-totp`, they receive a QR code and an alphanumeric Base32 secret key.
- TradeGuard accepts this Secret Key in `totpSecret` to automatically generate RFC 6238 TOTPs on the fly and seamlessly maintain/refresh sessions without requiring manual OTP entry.
- Direct pasting of active Bearer JWT tokens is also supported.

### Dhan Integration
- DhanHQ: `backend/src/brokers/dhan/` (DhanAdapter, Mapper, SyncService, MarketDataService)

---

## 11. Utility Modules

### Encryption (`backend/src/utils/encryption.js`)

```javascript
encrypt(text)        // AES encrypt with ENCRYPTION_KEY
decrypt(encryptedText) // AES decrypt with ENCRYPTION_KEY
```

Used by: BrokerAccount model pre-save hook, UpstoxSyncService

### Email Transporter (`backend/src/utils/transporter.js`)

```javascript
// Creates nodemailer transporter using Gmail
// Auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
```

Used by: `forgotPassword` controller

---

## 12. Error Handling Patterns

### User Controller Pattern
```javascript
try {
    // logic
} catch(error) {
    console.log("Error message", error);
    res.status(500).json({ message: "Internal Server Error" });
}
```

### Broker Account Controller Pattern
```javascript
try {
    // logic
} catch (error) {
    console.error("Operation Error:", error);
    return res.status(500).json({
        success: false,
        message: "Failed to ..."
    });
}
```

### Response Format Inconsistency

| Controller | Error Format |
|------------|-------------|
| User | `{ message: "..." }` |
| Broker Account | `{ success: false, message: "..." }` |

> **Frontend note:** Handle both formats. User routes return `{ message }`, broker routes return `{ success: false, message }`.

---

## 13. Frontend Navigation Map

### Pages & Routes the Frontend Should Have

```
/auth
  ├── /login              → POST /api/users/login
  ├── /register           → POST /api/users/register
  ├── /forgot-password    → POST /api/users/forgot-password
  └── /reset-password     → POST /api/users/reset-password (token in URL param)

/dashboard
  └── /                   → Dashboard with stats (needs new API route)

/broker-accounts
  ├── /                   → GET /api/broker-accounts/ (list view)
  ├── /new                → POST /api/broker-accounts/ (create form)
  ├── /:id                → GET /api/broker-accounts/:id (detail view)
  ├── /:id/edit           → PUT /api/broker-accounts/:id (edit form)
  └── /:id/delete         → DELETE /api/broker-accounts/:id (delete action)

/trades
  └── /                   → Trade history (needs new API route)

/settings
  └── /                   → User settings (needs new API route)
```

### Navigation Flow

```
┌─────────────────────────────────────────────────────┐
│                    Landing Page                      │
│                   / or /login                       │
└────────────┬──────────────────────┬─────────────────┘
             │                      │
     ┌───────▼───────┐     ┌───────▼───────┐
     │  /register    │     │   /login      │
     └───────┬───────┘     └───────┬───────┘
             │                      │
             └──────────┬───────────┘
                        │
              ┌─────────▼─────────┐
              │    /dashboard     │
              │  (after auth)     │
              └─────────┬─────────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
   ┌──────▼──────┐ ┌───▼────┐ ┌─────▼──────┐
   │/broker-     │ │/trades │ │/settings   │
   │accounts     │ │        │ │            │
   └─────────────┘ └────────┘ └────────────┘
```

---

## 14. What Does NOT Exist (Gaps to Be Aware Of)

| Missing Feature | Impact on Frontend |
|-----------------|-------------------|
| **No auth middleware** | All routes are public. Frontend must handle JWT storage and send `Authorization: Bearer <token>` header, but backend won't reject unauthenticated requests yet. |
| **No input validation library** | Frontend should validate all inputs before sending to backend. Backend only does minimal manual checks. |
| **No centralized error handling** | Errors may crash the server. Frontend should handle network errors gracefully. |
| **No trade routes** | No API to fetch trades for display. Frontend trades page would need backend routes to be added. |
| **No user profile routes** | No GET/PUT/DELETE for user profile (commented out in code). |
| **No logout route** | Commented out. Frontend should just clear the JWT from storage. |
| **No WebSocket** | Directory exists but is empty. No real-time updates. |
| **No pagination** | GET endpoints return all records at once. |
| **No search/filter on trades** | No query parameters supported on any GET endpoint. |
| **Inconsistent response format** | User routes use `{ message }`, broker routes use `{ success: false, message }`. Frontend must handle both. |
| **No CORS for production** | CORS is set to `http://localhost:3000` only. |
| **forgot-password bug** | Crashes if email not found (null reference). |
| **No rate limiting** | All endpoints are unprotected from abuse. |

---

## Quick Reference: All Endpoints

```
POST   /api/users/register
POST   /api/users/login
POST   /api/users/forgot-password
POST   /api/users/reset-password

POST   /api/broker-accounts/
GET    /api/broker-accounts/
GET    /api/broker-accounts/:id
PUT    /api/broker-accounts/:id
DELETE /api/broker-accounts/:id

GET    /                    (health check — app.js only)
```

**Total: 9 active endpoints + 1 health check**

---

*Document generated from complete codebase analysis of `/home/naman/TradeGuard/backend/`*
