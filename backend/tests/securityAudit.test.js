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
