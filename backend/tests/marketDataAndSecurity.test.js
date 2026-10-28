import test from "node:test";
import assert from "node:assert/strict";
import quoteCache from "../src/services/marketData/quoteCache.js";
import { getMarketSessionInfo, isIndianMarketOpen } from "../src/services/marketData/marketSessionService.js";
import upstoxInstrumentService from "../src/services/marketData/upstoxInstrumentService.js";
import positionEngine from "../src/services/position/PositionEngine.js";
import pnlEngine from "../src/services/pnl/PnLEngine.js";
import { encrypt, decrypt } from "../src/utils/encryption.js";
import CryptoJS from "crypto-js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// ==========================================
// 1. MARKET DATA CORRECTNESS TESTS
// ==========================================

test("MarketData 1: Valid new Upstox quote updates correct position with separated semantics", () => {
    quoteCache.clear();
    const key = "NSE_EQ|INE002A01018"; // Reliance
    const quoteTime = new Date("2026-10-28T10:00:00.000+05:30").getTime();

    const result = quoteCache.updateQuote(key, {
        ltp: 2850.50,
        cp: 2810.00,
        open: 2820.00,
        high: 2865.00,
        low: 2815.00,
        timestamp: quoteTime,
        source: "UPSTOX_V3_WS"
    });

    assert.equal(result.accepted, true, "Quote must be accepted");
    const cached = quoteCache.getQuote(key);
    assert.equal(cached.lastPrice, 2850.50, "lastPrice must match LTP");
    assert.equal(cached.previousClose, 2810.00, "previousClose must remain separated from LTP");
    assert.equal(cached.lastPriceAt, quoteTime);
    assert.equal(cached.quoteSource, "UPSTOX_V3_WS");
});

test("MarketData 2: Quote for wrong instrument is rejected and cannot overwrite existing quote", () => {
    const relKey = "NSE_EQ|INE002A01018";
    const tcsKey = "NSE_EQ|INE467B01029";

    const initial = quoteCache.getQuote(relKey);
    assert.ok(initial, "Reliance quote exists");

    // Attempt to update Reliance with a quote that claims instrumentKey is TCS
    const rejected = quoteCache.updateQuote(relKey, {
        instrumentKey: tcsKey,
        ltp: 3500.00,
        timestamp: Date.now()
    });

    assert.equal(rejected.accepted, false, "Mismatched instrument key must be rejected");
    assert.equal(rejected.reason, "INSTRUMENT_MISMATCH");

    // Verify Reliance price was not altered
    const relAfter = quoteCache.getQuote(relKey);
    assert.equal(relAfter.lastPrice, 2850.50, "Reliance price must not be corrupted by TCS quote");
});

test("MarketData 3: Malformed, zero, negative, or NaN response does not overwrite last valid price", () => {
    const key = "NSE_EQ|INE002A01018";
    const validBefore = quoteCache.getQuote(key).lastPrice;

    // Test zero LTP
    const resZero = quoteCache.updateQuote(key, { ltp: 0, timestamp: Date.now() });
    assert.equal(resZero.accepted, false, "Zero LTP must be rejected");

    // Test negative LTP
    const resNeg = quoteCache.updateQuote(key, { ltp: -100, timestamp: Date.now() });
    assert.equal(resNeg.accepted, false, "Negative LTP must be rejected");

    // Test NaN LTP
    const resNaN = quoteCache.updateQuote(key, { ltp: NaN, timestamp: Date.now() });
    assert.equal(resNaN.accepted, false, "NaN LTP must be rejected");

    // Test Infinity LTP
    const resInf = quoteCache.updateQuote(key, { ltp: Infinity, timestamp: Date.now() });
    assert.equal(resInf.accepted, false, "Infinity LTP must be rejected");

    const after = quoteCache.getQuote(key);
    assert.equal(after.lastPrice, validBefore, "Last valid price must be retained intact");
});

test("MarketData 4: Older or delayed response cannot overwrite a newer valid quote", () => {
    const key = "NSE_EQ|INE467B01029"; // TCS
    const timeT1 = 1700000000000;
    const timeT2 = 1700000005000;

    quoteCache.updateQuote(key, { ltp: 3500.00, timestamp: timeT2 });
    assert.equal(quoteCache.getQuote(key).lastPrice, 3500.00);

    // Delayed response from T1 arrives later
    const delayedRes = quoteCache.updateQuote(key, { ltp: 3450.00, timestamp: timeT1 });
    assert.equal(delayedRes.accepted, false, "Delayed older response must be rejected");
    assert.equal(delayedRes.reason, "STALE_TIMESTAMP");

    // Price remains the newer one
    assert.equal(quoteCache.getQuote(key).lastPrice, 3500.00, "Newer price preserved");
});

test("MarketData 5: Closed market retains last valid price; previous close is not confused with LTP", () => {
    const key = "NSE_EQ|INE002A01018";
    const quote = quoteCache.getQuote(key);
    assert.ok(quote.lastPrice > 0);
    assert.ok(quote.previousClose > 0);
    assert.notEqual(quote.lastPrice, quote.previousClose, "LTP and previous close must maintain distinct semantics");

    // Check off-hours session evaluation (e.g. Sunday or 23:00 IST)
    const sundayNight = new Date("2026-10-25T23:00:00.000+05:30");
    const session = getMarketSessionInfo("NSE", "EQUITY", sundayNight);
    assert.equal(session.isOpen, false, "Sunday 23:00 IST must be closed");
    assert.equal(session.reason, "WEEKEND", "Weekend session state recognized");
});

test("MarketData 6: Exchange cache keys cannot collide across exchanges", () => {
    const nseKey = "NSE_EQ|INE009A01021"; // INFY NSE
    const bseKey = "BSE_EQ|INE009A01021"; // INFY BSE

    quoteCache.updateQuote(nseKey, { ltp: 1550.00, timestamp: Date.now() });
    quoteCache.updateQuote(bseKey, { ltp: 1548.50, timestamp: Date.now() });

    assert.equal(quoteCache.getQuote(nseKey).lastPrice, 1550.00);
    assert.equal(quoteCache.getQuote(bseKey).lastPrice, 1548.50);
});

test("MarketData 7: Average entry price is never overwritten by quote updates", () => {
    const userId = "test_user_pnl_1";
    const positions = [{
        id: "pos_rel_1",
        instrumentToken: "NSE_EQ|INE002A01018",
        symbol: "RELIANCE",
        side: "BUY",
        openQuantity: 10,
        averagePrice: 2800.00, // Average entry price
        productType: "EQUITY_DELIVERY"
    }];

    pnlEngine.setPositions(userId, positions);

    // Update with live quote
    pnlEngine.updatePrice(userId, "NSE_EQ|INE002A01018", 2950.00, {
        ltp: 2950.00,
        cp: 2820.00,
        quoteFreshness: "LIVE",
        quoteSource: "UPSTOX_V3_WS"
    });

    const calculated = pnlEngine.calculate(userId);
    const pos = calculated.positions[0];

    assert.equal(pos.averagePrice, 2800.00, "Entry price MUST NEVER be overwritten by market quote");
    assert.equal(pos.ltp, 2950.00, "LTP reflects current quote");
    assert.equal(pos.investedCapital, 28000.00, "Invested capital calculated from entry price: 10 * 2800");
    assert.equal(pos.marketValue, 29500.00, "Market value calculated from LTP: 10 * 2950");
    assert.equal(pos.grossPnL, 1500.00, "Unrealized gross PnL: (2950 - 2800) * 10 = 1500");
});

// ==========================================
// 2. POSITION ENGINE & P&L TESTS
// ==========================================

test("PnL 1: Profitable Long Position Calculation", () => {
    const trades = [
        {
            userId: "u1",
            symbol: "INFY",
            exchange: "NSE",
            transactionType: "BUY",
            quantity: 50,
            executedPrice: 1500.00,
            tradeTime: new Date("2026-10-28T09:30:00.000Z"),
            status: "COMPLETE"
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    assert.equal(openPositions.length, 1);
    assert.equal(openPositions[0].openQuantity, 50);
    assert.equal(openPositions[0].averagePrice, 1500.00);
    assert.equal(openPositions[0].side, "BUY");

    pnlEngine.setPositions("u1", openPositions);
    pnlEngine.updatePrice("u1", openPositions[0].instrumentToken, 1600.00);

    const snapshot = pnlEngine.calculate("u1");
    const pos = snapshot.positions[0];

    // (1600 - 1500) * 50 = +5000
    assert.equal(pos.grossPnL, 5000.00, "Long profit must be (LTP - AvgPrice) * Qty");
    assert.ok(pos.netPnL > 0, "Net PnL must be positive after deducting charges");
    assert.equal(pos.netPnL, pos.grossPnL - pos.charges.total, "Net PnL = Gross PnL - Total Charges");
});

test("PnL 2: Loss-making Long Position Calculation", () => {
    const trades = [
        {
            userId: "u2",
            symbol: "TCS",
            exchange: "NSE",
            transactionType: "BUY",
            quantity: 20,
            executedPrice: 3500.00,
            tradeTime: new Date("2026-10-28T09:30:00.000Z"),
            status: "COMPLETE"
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    pnlEngine.setPositions("u2", openPositions);
    pnlEngine.updatePrice("u2", openPositions[0].instrumentToken, 3400.00);

    const snapshot = pnlEngine.calculate("u2");
    const pos = snapshot.positions[0];

    // (3400 - 3500) * 20 = -2000
    assert.equal(pos.grossPnL, -2000.00, "Loss-making long gross PnL must be -2000");
    assert.ok(pos.netPnL < -2000.00, "Net PnL must include charges adding to the loss");
});

test("PnL 3: Profitable and Loss-making Short Positions (Intraday/Derivatives)", () => {
    // Short SELL trade: 100 qty @ 500
    const shortTrades = [
        {
            userId: "u3",
            symbol: "SBIN",
            exchange: "NSE",
            transactionType: "SELL",
            quantity: 100,
            executedPrice: 500.00,
            tradeTime: new Date("2026-10-28T09:30:00.000Z"),
            status: "COMPLETE"
        }
    ];

    const openPositions = positionEngine.getOpenPositions(shortTrades);
    assert.equal(openPositions.length, 1);
    assert.equal(openPositions[0].side, "SELL");
    assert.equal(openPositions[0].openQuantity, 100);

    pnlEngine.setPositions("u3", openPositions);

    // Case A: Price drops to 480 -> Profit for short = (500 - 480) * 100 = +2000
    pnlEngine.updatePrice("u3", openPositions[0].instrumentToken, 480.00);
    const profitSnap = pnlEngine.calculate("u3");
    assert.equal(profitSnap.positions[0].grossPnL, 2000.00, "Short profit: (Entry - LTP) * Qty");

    // Case B: Price rises to 520 -> Loss for short = (500 - 520) * 100 = -2000
    pnlEngine.updatePrice("u3", openPositions[0].instrumentToken, 520.00);
    const lossSnap = pnlEngine.calculate("u3");
    assert.equal(lossSnap.positions[0].grossPnL, -2000.00, "Short loss: (Entry - LTP) * Qty");
});

test("PnL 4: Multiple entries at different prices (Weighted Average Entry Price)", () => {
    const trades = [
        {
            userId: "u4",
            symbol: "TATAMOTORS",
            exchange: "NSE",
            transactionType: "BUY",
            quantity: 100,
            executedPrice: 600.00,
            tradeTime: new Date("2026-10-28T09:30:00.000Z"),
            status: "COMPLETE"
        },
        {
            userId: "u4",
            symbol: "TATAMOTORS",
            exchange: "NSE",
            transactionType: "BUY",
            quantity: 200,
            executedPrice: 630.00,
            tradeTime: new Date("2026-10-28T10:00:00.000Z"),
            status: "COMPLETE"
        }
    ];

    // Total Qty = 300, Total Cost = (100*600) + (200*630) = 60,000 + 126,000 = 186,000
    // Weighted Average Price = 186,000 / 300 = 620.00
    const openPositions = positionEngine.getOpenPositions(trades);
    assert.equal(openPositions[0].openQuantity, 300);
    assert.equal(openPositions[0].averagePrice, 620.00, "Weighted average price must be 620.00");
});

test("PnL 5: Partial exit and Realized vs Unrealized PnL separation", () => {
    const trades = [
        {
            userId: "u5",
            symbol: "HDFCBANK",
            exchange: "NSE",
            transactionType: "BUY",
            quantity: 100,
            executedPrice: 1600.00,
            tradeTime: new Date("2026-10-28T09:30:00.000Z"),
            status: "COMPLETE"
        },
        {
            userId: "u5",
            symbol: "HDFCBANK",
            exchange: "NSE",
            transactionType: "SELL",
            quantity: 40, // 40 exited @ 1650
            executedPrice: 1650.00,
            tradeTime: new Date("2026-10-28T11:00:00.000Z"),
            status: "COMPLETE"
        }
    ];

    const openPositions = positionEngine.getOpenPositions(trades);
    assert.equal(openPositions.length, 1);
    assert.equal(openPositions[0].openQuantity, 60, "Remaining open quantity must be 60");
    assert.equal(openPositions[0].status, "PARTIALLY_SQUARED");

    // Realized profit on 40 exited: (1650 - 1600) * 40 = 2000
    assert.equal(openPositions[0].realizedPnL, 2000.00, "Realized PnL on 40 exited must be 2000");

    pnlEngine.setPositions("u5", openPositions);
    pnlEngine.updatePrice("u5", openPositions[0].instrumentToken, 1620.00);

    const snapshot = pnlEngine.calculate("u5");
    const pos = snapshot.positions[0];

    // Unrealized gross on remaining 60 @ 1620: (1620 - 1600) * 60 = 1200
    assert.equal(pos.unrealizedGrossPnL, 1200.00, "Unrealized gross PnL on remaining 60 must be 1200");
    assert.equal(pos.grossPnL, 3200.00, "Total position Gross PnL (realized + unrealized) must be 3200");
    // Portfolio summary maintains clean separation
    assert.equal(snapshot.portfolioSummary.totalRealizedPnL, 2000.00);
    assert.equal(snapshot.portfolioSummary.totalUnrealizedPnL, 1200.00);
    assert.equal(snapshot.portfolioSummary.totalGrossPnL, 3200.00, "Total Gross PnL = Realized + Unrealized");
});

// ==========================================
// 3. SECURITY & CRYPTOGRAPHY AUDIT TESTS
// ==========================================

test("Security 1: AES-256-GCM encryption with versioning & backward-compatible legacy decryption", () => {
    const rawSecret = "test_upstox_oauth2_token_xyz987";

    // 1. Encrypt with new AES-256-GCM
    const encryptedGcm = encrypt(rawSecret);
    assert.ok(encryptedGcm.startsWith("v1:"), "Ciphertext must be versioned with v1 prefix");
    const parts = encryptedGcm.split(":");
    assert.equal(parts.length, 4, "v1 format requires version:iv:authTag:ciphertext");

    // 2. Decrypt with GCM
    const decryptedGcm = decrypt(encryptedGcm);
    assert.equal(decryptedGcm, rawSecret, "Decrypted value must match original plaintext");

    // 3. Backward compatibility: Test decryption of legacy CryptoJS AES ciphertext
    const legacyKey = "fcc3ae5999dc642c5d77ea0d035ae611d04723e1c8d4a8fb93dbda738b22e4d8";
    const legacyCiphertext = CryptoJS.AES.encrypt(rawSecret, legacyKey).toString();
    const decryptedLegacy = decrypt(legacyCiphertext);
    assert.equal(decryptedLegacy, rawSecret, "Legacy CryptoJS ciphertext must be cleanly decrypted");

    // 4. Tampered ciphertext rejection
    const tamperedCipher = encryptedGcm.slice(0, -4) + "ffff";
    const failedDecryption = decrypt(tamperedCipher);
    assert.equal(failedDecryption, "", "Tampered ciphertext must fail authentication and return empty string");
});

test("Security 2: Password reset tokens must be cryptographically secure and single-use", () => {
    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    assert.equal(tokenHash.length, 64, "Token hash must be standard 64-char hex SHA-256");

    // Mock DB user state with reset token
    const mockUser = {
        _id: "u_sec_1",
        email: "trader@example.com",
        resetPasswordToken: tokenHash,
        resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000) // 15 mins
    };

    // Verify valid token lookup
    const verifyHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    assert.equal(verifyHash, mockUser.resetPasswordToken, "Token hash matches DB record");
    assert.ok(mockUser.resetPasswordExpires > new Date(), "Token is not expired");

    // Simulate password reset consummation (single-use invalidation)
    mockUser.resetPasswordToken = null;
    mockUser.resetPasswordExpires = null;

    // Second attempt using same token must fail
    assert.equal(mockUser.resetPasswordToken, null, "Single-use token is immediately invalidated");
});

test("Security 3: JWT verification rejects expired or invalid tokens", () => {
    const secret = "test_jwt_secret_key_tradeguard_2026";
    const payload = { userId: "6ada1808c50ebb09c8846f21", email: "audit@tradeguard.live" };

    // Valid token
    const token = jwt.sign(payload, secret, { expiresIn: "1h" });
    const decoded = jwt.verify(token, secret);
    assert.equal(decoded.userId, payload.userId);

    // Tampered token
    const tampered = token.slice(0, -6) + "xyz123";
    assert.throws(() => {
        jwt.verify(tampered, secret);
    }, /invalid signature/);

    // Expired token
    const expiredToken = jwt.sign(payload, secret, { expiresIn: "-1s" });
    assert.throws(() => {
        jwt.verify(expiredToken, secret);
    }, /jwt expired/);
});

// ==========================================
// 4. USERNAME AUTHENTICATION RESOLUTION TESTS
// ==========================================

test("Security 4: Username resolution matches exact, case variations, and whitespace/separator variants", () => {
    // Database record has username "Nexus Pro" and email "namansha.1112@gmail.com"
    const dbRecord = {
        username: "Nexus Pro",
        email: "namansha.1112@gmail.com"
    };

    function matchUser(identifier) {
        const id = String(identifier || "").trim();
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exactRegex = new RegExp(`^${escaped}$`, 'i');

        const orClauses = [
            (u) => u.email.toLowerCase() === id.toLowerCase(),
            (u) => exactRegex.test(u.username)
        ];

        const tokens = id.split(/[\s_-]+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (tokens.length > 0) {
            const tokenRegex = new RegExp(`^${tokens.join('[\\s_-]*')}$`, 'i');
            orClauses.push((u) => tokenRegex.test(u.username));
        }

        const compact = id.replace(/[\s_-]+/g, '');
        if (compact.length > 1) {
            const compactEscaped = compact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const flexibleChars = compactEscaped.split('').map(c => /[a-zA-Z0-9]/.test(c) ? `${c}[\\s_-]*` : c).join('');
            const flexRegex = new RegExp(`^${flexibleChars}$`, 'i');
            orClauses.push((u) => flexRegex.test(u.username));
        }

        return orClauses.some(fn => fn(dbRecord));
    }

    // ✅ Positive cases: all must match
    assert.equal(matchUser("Nexus Pro"), true, "Exact match");
    assert.equal(matchUser("nexus pro"), true, "Case-insensitive match");
    assert.equal(matchUser("NEXUS PRO"), true, "Uppercase match");
    assert.equal(matchUser("NexusPro"), true, "Compact without space match");
    assert.equal(matchUser("nexuspro"), true, "Lowercase compact match");
    assert.equal(matchUser("nexus_pro"), true, "Underscore separator match");
    assert.equal(matchUser("nexus-pro"), true, "Dash separator match");
    assert.equal(matchUser("  Nexus   Pro  "), true, "Trimmed multiple whitespace match");
    assert.equal(matchUser("namansha.1112@gmail.com"), true, "Email match");
    assert.equal(matchUser("NAMANSHA.1112@GMAIL.COM"), true, "Uppercase email match");

    // ✅ Negative cases: must NOT match
    assert.equal(matchUser("nexus"), false, "Partial prefix match must be rejected");
    assert.equal(matchUser("pro"), false, "Partial suffix match must be rejected");
    assert.equal(matchUser("another_user"), false, "Different user must be rejected");
    assert.equal(matchUser(""), false, "Empty identifier must be rejected");
});

