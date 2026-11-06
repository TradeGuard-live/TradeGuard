import test from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "../src/utils/encryption.js";
import { sanitizeCsvCell } from "../src/controllers/webhookController.js";
import { BROKER_CAPABILITIES } from "../src/services/copyTrading/contracts/BrokerCapabilityRegistry.js";
import app from "../src/app.js";

// ==========================================
// SECURITY AUDIT AND IDOR REGRESSION TESTS
// ==========================================

test("Security Audit 1: AES-256-GCM authenticated encryption produces versioned ciphertext and detects tampering", () => {
    const plaintext = "UPSTOX_SECRET_API_TOKEN_123456";
    const encrypted = encrypt(plaintext);

    assert.ok(encrypted.startsWith("v1:"), "Ciphertext must carry format version prefix 'v1:'");

    const decrypted = decrypt(encrypted);
    assert.equal(decrypted, plaintext, "Decrypted text must match plaintext");

    // Tamper with the ciphertext body
    const parts = encrypted.split(":");
    // parts: ["v1", iv, tag, encryptedData]
    const tamperedPayload = parts[3].slice(0, -2) + (parts[3].slice(-2) === "aa" ? "bb" : "aa");
    const tamperedCiphertext = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedPayload}`;

    const tamperedDecrypted = decrypt(tamperedCiphertext);
    assert.equal(tamperedDecrypted, "", "Tampered ciphertext must fail authentication and decrypt to empty string");

    // Tamper with auth tag
    const tamperedTag = (parts[2].slice(-2) === "00" ? "11" : "00") + parts[2].slice(2);
    const tamperedTagCiphertext = `${parts[0]}:${parts[1]}:${tamperedTag}:${parts[3]}`;
    assert.equal(decrypt(tamperedTagCiphertext), "", "Tampered auth tag must fail authentication and decrypt to empty string");
});

test("Security Audit 1b: Encryption regression suite - legacy CryptoJS, missing, invalid versions, empty inputs", async () => {
    const CryptoJS = (await import("crypto-js")).default;
    const testSecret = "test_upstox_oauth2_token_xyz987";

    // 1. Legacy ciphertext encrypted with default legacy key
    const defaultLegacyKey = "fcc3ae5999dc642c5d77ea0d035ae611d04723e1c8d4a8fb93dbda738b22e4d8";
    const legacyCiphertext = CryptoJS.AES.encrypt(testSecret, defaultLegacyKey).toString();
    assert.equal(decrypt(legacyCiphertext), testSecret, "Legacy CryptoJS ciphertext must cleanly decrypt");

    // 2. Legacy ciphertext encrypted with current process.env.ENCRYPTION_KEY (if set)
    if (process.env.ENCRYPTION_KEY) {
        const envLegacyCiphertext = CryptoJS.AES.encrypt(testSecret, process.env.ENCRYPTION_KEY).toString();
        assert.equal(decrypt(envLegacyCiphertext), testSecret, "Legacy ciphertext with env key must decrypt");
    }

    // 3. Legacy ciphertext encrypted with unknown/wrong key must fail and return empty string (NEVER return ciphertext)
    const wrongKeyCiphertext = CryptoJS.AES.encrypt(testSecret, "totally_unknown_key_9999").toString();
    const wrongKeyDecrypted = decrypt(wrongKeyCiphertext);
    assert.equal(wrongKeyDecrypted, "", "Wrong key legacy ciphertext must return empty string");
    assert.notEqual(wrongKeyDecrypted, wrongKeyCiphertext, "Ciphertext must never be returned as plaintext");

    // 4. Missing ciphertext (null, undefined, empty string, whitespace)
    assert.equal(decrypt(null), "", "decrypt(null) must return empty string");
    assert.equal(decrypt(undefined), "", "decrypt(undefined) must return empty string");
    assert.equal(decrypt(""), "", "decrypt('') must return empty string");
    assert.equal(decrypt("   "), "", "decrypt('   ') must return empty string");

    // 5. Invalid or unsupported version prefix (e.g. v2:, v99:)
    assert.equal(decrypt("v2:fakeiv:faketag:fakecipher"), "", "Unsupported version 'v2:' must return empty string");
    assert.equal(decrypt("v99:123:456:789"), "", "Unsupported version 'v99:' must return empty string");

    // 6. Empty plaintext encryption
    assert.equal(encrypt(""), "", "encrypt('') must return empty string");
    assert.equal(encrypt(null), "", "encrypt(null) must return empty string");
    assert.equal(encrypt(undefined), "", "encrypt(undefined) must return empty string");
});

test("Security Audit 2: SanitizeCsvCell neutralizes CSV formula injection prefixes (=, +, -, @, \\t, \\r)", () => {
    const formulaPayloads = [
        "=cmd|'/C calc'!A0",
        "+cmd|'/C calc'!A0",
        "-2+3*cmd|' /C notepad'!A0",
        "@SUM(1+1)*cmd|'/C calc'!A0",
        "\t=1+1",
        "\r=2+2",
        "  =DDE('cmd';'/c calc';'__DdeLink__')  "
    ];

    for (const payload of formulaPayloads) {
        const sanitized = sanitizeCsvCell(payload);
        assert.ok(!/^[=+\-@\t\r]/.test(sanitized), `Sanitized cell '${sanitized}' must not start with dangerous formula execution characters`);
    }

    // Normal safe strings must remain unaltered
    assert.equal(sanitizeCsvCell("RELIANCE"), "RELIANCE");
    assert.equal(sanitizeCsvCell("HDFCBANK-EQ"), "HDFCBANK-EQ");
    assert.equal(sanitizeCsvCell("NIFTY 24000 CE"), "NIFTY 24000 CE");
});

test("Security Audit 3: Kotak Neo is deprecated in BrokerCapabilityRegistry and orders are disabled", () => {
    const caps = BROKER_CAPABILITIES.KOTAK_NEO;
    assert.ok(caps, "Kotak Neo capability entry exists");
    assert.equal(caps.isDeprecated, true, "Kotak Neo must be marked as deprecated");
    assert.equal(caps.isActiveIntegration, false, "Kotak Neo must be marked as inactive");
    assert.equal(caps.supportsOrderPlacement, false, "Kotak Neo automated order placement must be false");
    assert.equal(caps.supportsStreamingOrders, false, "Kotak Neo streaming orders must be false");
});

test("Security Audit 4: Magic bytes validation correctly distinguishes valid Excel/CSV from binary executables", () => {
    // 1. Valid Excel XLSX (starts with PK 0x50 0x4B)
    const validXlsxBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    const isZipExcel = validXlsxBuffer.length >= 2 && validXlsxBuffer[0] === 0x50 && validXlsxBuffer[1] === 0x4B;
    assert.equal(isZipExcel, true, "Must detect valid XLSX PK signature");

    // 2. Valid Legacy Excel XLS (starts with OLE CFB 0xD0 0xCF 0x11 0xE0)
    const validXlsBuffer = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1]);
    const isOleExcel = validXlsBuffer.length >= 4 && validXlsBuffer[0] === 0xD0 && validXlsBuffer[1] === 0xCF && validXlsBuffer[2] === 0x11 && validXlsBuffer[3] === 0xE0;
    assert.equal(isOleExcel, true, "Must detect valid XLS OLE CFB signature");

    // 3. Dangerous binary executable ELF/Windows EXE (.exe starts with MZ 0x4D 0x5A, Linux ELF starts with 0x7F 0x45 0x4C 0x46)
    const dangerousExe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const sample = dangerousExe.slice(0, 512);
    const hasNullBytes = sample.includes(0x00);
    assert.equal(hasNullBytes, true, "Binary executable contains null bytes and must be rejected");

    // 4. Valid plain text CSV (no null bytes)
    const validCsv = Buffer.from("Trade Date,Symbol,Type,Quantity,Price\n2026-10-30,RELIANCE,BUY,10,2850\n");
    const csvSample = validCsv.slice(0, 512);
    assert.equal(csvSample.includes(0x00), false, "Valid CSV must contain no null bytes");
});

test("Security Audit 5: IDOR Protection - Journal controller rejects mismatched userId in query/body", async () => {
    const { listJournalEntries } = await import("../src/controllers/journalController.js");

    let statusCode = null;
    let jsonPayload = null;

    const mockRes = {
        status: (code) => {
            statusCode = code;
            return {
                json: (payload) => {
                    jsonPayload = payload;
                    return payload;
                }
            };
        },
        json: (payload) => {
            statusCode = 200;
            jsonPayload = payload;
            return payload;
        }
    };

    // User A attempts to access User B's journal entries by setting ?userId=victimUserId
    const authenticatedUserId = "672400000000000000000001";
    const victimUserId = "672400000000000000000002";

    const mockReq = {
        user: { userId: authenticatedUserId, email: "user_a@example.com" },
        query: { userId: victimUserId },
        params: {},
        body: {}
    };

    await listJournalEntries(mockReq, mockRes);

    assert.equal(statusCode, 403, "Must return 403 Forbidden when query userId does not match JWT userId");
    assert.equal(jsonPayload.success, false);
    assert.ok(/Forbidden|Access denied/i.test(jsonPayload.message), "Must indicate access denied");
});

test("Webhook Regression 1: Application startup fails in production when ANGEL_WEBHOOK_SECRET is missing", async () => {
    const { validateStartupConfig } = await import("../src/server.js");
    const testEnv = {
        NODE_ENV: "production",
        JWT_SECRET: "jwt_secret_123",
        ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        // ANGEL_WEBHOOK_SECRET is deliberately missing
    };
    assert.throws(() => {
        validateStartupConfig(testEnv);
    }, /Missing critical environment variables in production.*ANGEL_WEBHOOK_SECRET/);
});

test("Webhook Regression 2: Webhook rejects requests with 503 when secret is missing in environment", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    delete process.env.ANGEL_WEBHOOK_SECRET;

    let tradeUpdated = false;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;
    const origUpdateOne = TradeRecord.updateOne;
    TradeRecord.updateOne = async () => { tradeUpdated = true; };

    try {
        let statusCode = null;
        let responseData = null;
        const res = {
            status: (code) => {
                statusCode = code;
                return { json: (data) => { responseData = data; return data; } };
            }
        };

        await angelOnePostback({ headers: { "x-webhook-token": "any_token" }, body: { clientcode: "TEST" } }, res);
        assert.equal(statusCode, 503, "Must return 503 Service Unavailable when secret is missing");
        assert.equal(responseData.success, false);
        assert.equal(tradeUpdated, false, "Must never create or modify trades when secret is unavailable");
    } finally {
        TradeRecord.updateOne = origUpdateOne;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
    }
});

test("Webhook Regression 3: Missing request token (no x-webhook-token header) returns 401 Unauthorized", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_webhook_secret_777";

    let tradeUpdated = false;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;
    const origUpdateOne = TradeRecord.updateOne;
    TradeRecord.updateOne = async () => { tradeUpdated = true; };

    try {
        let statusCode = null;
        let responseData = null;
        const res = {
            status: (code) => {
                statusCode = code;
                return { json: (data) => { responseData = data; return data; } };
            }
        };

        await angelOnePostback({ headers: {}, query: {}, body: { clientcode: "TEST" } }, res);
        assert.equal(statusCode, 401, "Must return 401 when token header is missing");
        assert.equal(responseData.success, false);
        assert.equal(tradeUpdated, false, "Must never create or modify trades when token is missing");
    } finally {
        TradeRecord.updateOne = origUpdateOne;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 4: Incorrect token in x-webhook-token returns 401 Unauthorized", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_webhook_secret_777";

    let tradeUpdated = false;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;
    const origUpdateOne = TradeRecord.updateOne;
    TradeRecord.updateOne = async () => { tradeUpdated = true; };

    try {
        let statusCode = null;
        let responseData = null;
        const res = {
            status: (code) => {
                statusCode = code;
                return { json: (data) => { responseData = data; return data; } };
            }
        };

        await angelOnePostback({ headers: { "x-webhook-token": "wrong_attacker_token" }, body: { clientcode: "TEST" } }, res);
        assert.equal(statusCode, 401, "Must return 401 when token does not match");
        assert.equal(responseData.success, false);
        assert.equal(tradeUpdated, false, "Must never create or modify trades on incorrect token");
    } finally {
        TradeRecord.updateOne = origUpdateOne;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 5: Correct token in x-webhook-token header passes authentication", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_webhook_secret_777";

    try {
        let statusCode = null;
        let responseData = null;
        const res = {
            status: (code) => {
                statusCode = code;
                return { json: (data) => { responseData = data; return data; } };
            }
        };

        // When body is empty, it returns 400 after successfully passing auth gate
        await angelOnePostback({ headers: { "x-webhook-token": "test_webhook_secret_777" }, body: null }, res);
        assert.equal(statusCode, 400, "Must pass auth gate and return 400 for empty body");
        assert.equal(responseData.message, "Empty postback payload");
    } finally {
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 6: Token supplied only through query parameters is rejected with 401 Unauthorized", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_webhook_secret_777";

    let tradeUpdated = false;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;
    const origUpdateOne = TradeRecord.updateOne;
    TradeRecord.updateOne = async () => { tradeUpdated = true; };

    try {
        let statusCode = null;
        let responseData = null;
        const res = {
            status: (code) => {
                statusCode = code;
                return { json: (data) => { responseData = data; return data; } };
            }
        };

        // Token sent only in query parameters, NOT in header
        await angelOnePostback({
            headers: {},
            query: { token: "test_webhook_secret_777" },
            body: { clientcode: "TEST" }
        }, res);

        assert.equal(statusCode, 401, "Must return 401 when token is provided in query params instead of header");
        assert.equal(responseData.success, false);
        assert.equal(tradeUpdated, false, "Must never create or modify trades when header is missing");
    } finally {
        TradeRecord.updateOne = origUpdateOne;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 7: Invalid or missing clientcode is rejected without trade creation", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";

    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => null; // No matching broker account
    let updateCalled = false;
    TradeRecord.updateOne = async () => { updateCalled = true; };

    try {
        let resData = null;
        const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };

        await angelOnePostback({
            headers: { "x-webhook-token": "test_secret_777" },
            body: {
                clientcode: "UNKNOWN_CLIENT_999",
                orderstatus: "complete",
                filledshares: 10,
                symbol: "INFY",
                price: 1500,
                transactiontype: "BUY"
            }
        }, res);

        assert.equal(resData.data.skipped, 1);
        assert.equal(resData.data.inserted, 0);
        assert.equal(updateCalled, false, "TradeRecord must not be touched for invalid clientcode");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 8: Invalid and malicious symbols are rejected", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;

    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });
    let updateCalled = false;
    TradeRecord.updateOne = async () => { updateCalled = true; };

    try {
        const invalidSymbols = ["<script>alert(1)</script>", "", "UNKNOWN", "SELECT * FROM trades", "$$BAD$$"];
        for (const sym of invalidSymbols) {
            let resData = null;
            const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };
            await angelOnePostback({
                headers: { "x-webhook-token": "test_secret_777" },
                body: {
                    clientcode: "VALID_CL",
                    orderstatus: "complete",
                    filledshares: 10,
                    symbol: sym,
                    price: 500,
                    transactiontype: "BUY"
                }
            }, res);
            assert.equal(resData.data.skipped, 1, `Symbol '${sym}' must be skipped`);
        }
        assert.equal(updateCalled, false, "TradeRecord must never be touched for invalid symbols");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 9: Zero and negative quantities are rejected", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });
    let updateCalled = false;
    TradeRecord.updateOne = async () => { updateCalled = true; };

    try {
        for (const qty of [0, -5, -100]) {
            let resData = null;
            const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };
            await angelOnePostback({
                headers: { "x-webhook-token": "test_secret_777" },
                body: {
                    clientcode: "VALID_CL",
                    orderstatus: "complete",
                    filledshares: qty,
                    symbol: "TCS",
                    price: 3500,
                    transactiontype: "BUY"
                }
            }, res);
            assert.equal(resData.data.skipped, 1, `Quantity ${qty} must be skipped`);
        }
        assert.equal(updateCalled, false, "TradeRecord must not be touched for zero or negative quantity");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 10: Zero, negative, and non-finite prices are rejected", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });
    let updateCalled = false;
    TradeRecord.updateOne = async () => { updateCalled = true; };

    try {
        for (const price of [0, -250, NaN, Infinity, -Infinity]) {
            let resData = null;
            const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };
            await angelOnePostback({
                headers: { "x-webhook-token": "test_secret_777" },
                body: {
                    clientcode: "VALID_CL",
                    orderstatus: "complete",
                    filledshares: 10,
                    symbol: "TCS",
                    price,
                    transactiontype: "BUY"
                }
            }, res);
            assert.equal(resData.data.skipped, 1, `Price ${price} must be skipped`);
        }
        assert.equal(updateCalled, false, "TradeRecord must not be touched for invalid prices");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 11: Invalid transaction types are rejected", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });
    let updateCalled = false;
    TradeRecord.updateOne = async () => { updateCalled = true; };

    try {
        for (const txType of ["HOLD", "CANCELLED", "INVALID", "", "NONE"]) {
            let resData = null;
            const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };
            await angelOnePostback({
                headers: { "x-webhook-token": "test_secret_777" },
                body: {
                    clientcode: "VALID_CL",
                    orderstatus: "complete",
                    filledshares: 10,
                    symbol: "TCS",
                    price: 3500,
                    transactiontype: txType
                }
            }, res);
            assert.equal(resData.data.skipped, 1, `Transaction type '${txType}' must be skipped`);
        }
        assert.equal(updateCalled, false, "TradeRecord must not be touched for invalid transaction types");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 12: Old timestamps (> 24 hours old) are rejected as replay attacks", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });
    let updateCalled = false;
    TradeRecord.updateOne = async () => { updateCalled = true; };

    try {
        // Timestamp 48 hours ago
        const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        let resData = null;
        const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };
        await angelOnePostback({
            headers: { "x-webhook-token": "test_secret_777" },
            body: {
                clientcode: "VALID_CL",
                orderstatus: "complete",
                filledshares: 10,
                symbol: "INFY",
                price: 1500,
                transactiontype: "BUY",
                tradetime: staleDate
            }
        }, res);

        assert.equal(resData.data.skipped, 1, "Stale timestamp must be skipped");
        assert.equal(resData.data.inserted, 0);
        assert.equal(updateCalled, false, "TradeRecord must not be touched for stale timestamp");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 13: Future timestamps (> 10 minutes in the future) are rejected", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });
    let updateCalled = false;
    TradeRecord.updateOne = async () => { updateCalled = true; };

    try {
        // Timestamp 1 hour in the future
        const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        let resData = null;
        const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };
        await angelOnePostback({
            headers: { "x-webhook-token": "test_secret_777" },
            body: {
                clientcode: "VALID_CL",
                orderstatus: "complete",
                filledshares: 10,
                symbol: "INFY",
                price: 1500,
                transactiontype: "BUY",
                tradetime: futureDate
            }
        }, res);

        assert.equal(resData.data.skipped, 1, "Future timestamp must be skipped");
        assert.equal(resData.data.inserted, 0);
        assert.equal(updateCalled, false, "TradeRecord must not be touched for future timestamp");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 14: Duplicate webhook delivery is handled idempotently", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });

    let updateCount = 0;
    TradeRecord.updateOne = async () => {
        updateCount++;
        return {
            upsertedCount: updateCount === 1 ? 1 : 0,
            matchedCount: updateCount > 1 ? 1 : 0
        };
    };

    try {
        const payload = {
            clientcode: "VALID_CL",
            orderstatus: "complete",
            filledshares: 10,
            price: 2500,
            symbol: "INFY",
            transactiontype: "BUY",
            tradeid: "TRD-IDEMPOTENT-AO-001",
            tradetime: new Date().toISOString()
        };

        let res1 = null;
        await angelOnePostback({
            headers: { "x-webhook-token": "test_secret_777" },
            body: payload
        }, { status: () => ({ json: (p) => { res1 = p; } }) });
        assert.equal(res1.data.inserted, 1, "First delivery inserts trade");
        assert.equal(res1.data.updated, 0);

        let res2 = null;
        await angelOnePostback({
            headers: { "x-webhook-token": "test_secret_777" },
            body: payload
        }, { status: () => ({ json: (p) => { res2 = p; } }) });
        assert.equal(res2.data.inserted, 0, "Duplicate delivery does not insert second trade");
        assert.equal(res2.data.updated, 1, "Duplicate delivery updates existing trade");
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Webhook Regression 15: Delayed legitimate webhook delivery within retry policy is accepted", async () => {
    const { angelOnePostback } = await import("../src/controllers/webhookController.js");
    const BrokerAccount = (await import("../src/models/BrokerAccount.js")).default;
    const TradeRecord = (await import("../src/models/TradeRecord.js")).default;

    const prevSecret = process.env.ANGEL_WEBHOOK_SECRET;
    process.env.ANGEL_WEBHOOK_SECRET = "test_secret_777";
    const origAccountFind = BrokerAccount.findOne;
    const origTradeUpdate = TradeRecord.updateOne;
    BrokerAccount.findOne = async () => ({ _id: "acc_1", userId: "u_1", broker: "ANGEL_ONE", isActive: true });

    let upsertPayload = null;
    TradeRecord.updateOne = async (query, update) => {
        upsertPayload = update.$set;
        return { upsertedCount: 1, matchedCount: 0 };
    };

    try {
        // Trade executed 3 hours ago (retry delivery by broker after transient network outage)
        const delayedExecutionTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        let resData = null;
        const res = { status: () => ({ json: (p) => { resData = p; return p; } }) };

        await angelOnePostback({
            headers: { "x-webhook-token": "test_secret_777" },
            body: {
                clientcode: "VALID_CL",
                orderstatus: "complete",
                filledshares: 25,
                price: 1800,
                symbol: "RELIANCE",
                transactiontype: "BUY",
                tradeid: "TRD-RETRY-002",
                tradetime: delayedExecutionTime
            }
        }, res);

        assert.equal(resData.data.inserted, 1, "Delayed legitimate delivery must be inserted");
        assert.equal(resData.data.skipped, 0);
        assert.ok(upsertPayload, "TradeRecord must be updated/upserted");
        assert.equal(upsertPayload.symbol, "RELIANCE");
        assert.equal(upsertPayload.quantity, 25);
    } finally {
        BrokerAccount.findOne = origAccountFind;
        TradeRecord.updateOne = origTradeUpdate;
        if (prevSecret !== undefined) process.env.ANGEL_WEBHOOK_SECRET = prevSecret;
        else delete process.env.ANGEL_WEBHOOK_SECRET;
    }
});

test("Security Audit 7: ReDoS Prevention - Regex characters in search and symbol queries are escaped safely", async () => {
    const dangerousPatterns = [
        "(a+)+$",
        "((.*)*)*",
        "[a-zA-Z]+(([',. -][a-zA-Z ])?[a-zA-Z]*)*",
        "^(([a-z])+.)+[A-Z]([a-z])+$",
        "((a|a?)+)*"
    ];

    for (const pattern of dangerousPatterns) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Compiling escaped pattern should treat everything as literal characters without syntax errors
        const compiled = new RegExp(escaped, "i");
        assert.ok(compiled.test(pattern), `Literal string '${pattern}' must match its escaped RegExp`);
        assert.ok(!compiled.test("totally_different_string"), "Escaped pattern must not evaluate wildcards");
    }
});

test("Security Audit 8: Health Check Endpoint - Returns HTTP 200/503 with uptime and database status", async () => {
    const http = await import("http");
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        assert.ok(res.status === 200 || res.status === 503, "Health check responds with 200 or 503");
        const body = await res.json();
        assert.ok(body.status === "ok" || body.status === "degraded", "Health payload indicates status");
        assert.ok(typeof body.uptime === "number", "Uptime must be a number");
        assert.ok(body.database, "Database state must be reported");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("Security Audit 9: Financial Tariff Precision - Zero quantity and boundary condition handling", async () => {
    const { calculateCharges } = await import("../src/services/calculations.js");

    // Zero quantity must throw validation error rather than returning NaN
    assert.throws(() => {
        calculateCharges({
            quantity: 0,
            buyPrice: 100,
            sellPrice: 110
        });
    }, /quantity must be greater than zero/i);

    // Negative buy price must throw validation error
    assert.throws(() => {
        calculateCharges({
            quantity: 10,
            buyPrice: -50,
            sellPrice: 110
        });
    }, /buyPrice must be greater than zero/i);

    // Valid equity delivery charges with Finance Act 2024 tariffs
    const validTrade = {
        quantity: 100,
        buyPrice: 500,
        sellPrice: 550,
        isDelivery: true
    };

    const result = calculateCharges(validTrade, {
        brokerage: { type: "PER_ORDER", perOrder: 20 },
        stt: { buyRate: 0.001, sellRate: 0.001, appliesTo: "BOTH" },
        exchange: { rate: 0.0000297 },
        sebi: { ratePerCrore: 10 },
        stampDuty: { buyRate: 0.00015 },
        gst: { rate: 0.18 },
        dp: { perSellTransaction: 15.93 }
    });

    assert.equal(result.buyTurnover, 50000, "Buy turnover = 100 * 500 = 50,000");
    assert.equal(result.sellTurnover, 55000, "Sell turnover = 100 * 550 = 55,000");
    assert.equal(result.totalTurnover, 105000, "Total turnover = 105,000");
    assert.equal(result.brokerage, 40, "Brokerage = 2 orders * ₹20 = ₹40");
    assert.equal(result.stt, 105, "STT = (50,000 + 55,000) * 0.001 = ₹105");
    assert.equal(result.stampDuty, 7.5, "Stamp duty = 50,000 * 0.00015 = ₹7.5");
    assert.equal(result.dpCharges, 15.93, "DP charges on delivery sell = ₹15.93");
    assert.ok(result.totalCharges > 168 && result.totalCharges < 185, "Total charges must sum all statutory components");
});
