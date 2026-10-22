import crypto from "crypto";

/**
 * totp.js
 * RFC 6238 Time-Based One-Time Password (TOTP) generator and validator.
 * Built for Angel One SmartAPI and Google Authenticator compatibility.
 */

/**
 * Extracts clean Base32 secret string from either a raw secret key or otpauth:// URI
 * @param {string} input - Raw secret or otpauth:// URI
 * @returns {string} - Clean Base32 secret
 */
export function extractSecretFromInput(input) {
    if (!input || typeof input !== "string") return "";
    let clean = input.trim();

    // If user pasted an otpauth URI from QR code reader
    if (clean.toLowerCase().startsWith("otpauth://")) {
        try {
            const url = new URL(clean);
            const secretParam = url.searchParams.get("secret");
            if (secretParam) clean = secretParam;
        } catch {
            const match = clean.match(/[?&]secret=([A-Z2-7]+)/i);
            if (match) clean = match[1];
        }
    }

    // Remove any spaces, hyphens, and padding
    return clean.replace(/[\s=-]/g, "").toUpperCase();
}

/**
 * Converts a Base32 string into a binary Buffer
 * @param {string} base32 - Clean Base32 string
 * @returns {Buffer}
 */
export function base32ToBuffer(base32) {
    const clean = extractSecretFromInput(base32);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    
    for (let i = 0; i < clean.length; i++) {
        const val = alphabet.indexOf(clean[i]);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, "0");
    }

    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substring(i, i + 8), 2));
    }

    return Buffer.from(bytes);
}

/**
 * Generates standard 6-digit TOTP (RFC 6238) for Angel One SmartAPI / Google Authenticator
 * @param {string} secret - Base32 secret key (from QR code or alphanumeric key)
 * @param {number} [timeStep=30] - Interval in seconds (default 30s)
 * @param {number} [digits=6] - Number of digits (default 6)
 * @param {number} [epochSeconds] - Optional epoch seconds (default now)
 * @returns {string} - 6-digit numeric string
 */
export function generateTOTP(secret, timeStep = 30, digits = 6, epochSeconds = null) {
    if (!secret) return "";
    const key = base32ToBuffer(secret);
    if (!key || key.length === 0) return "";

    const epoch = epochSeconds !== null ? epochSeconds : Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / timeStep);

    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));

    const hmac = crypto.createHmac("sha1", key);
    hmac.update(buf);
    const digest = hmac.digest();

    const offset = digest[digest.length - 1] & 0x0f;
    const code = (digest.readUInt32BE(offset) & 0x7fffffff) % Math.pow(10, digits);

    return code.toString().padStart(digits, "0");
}

/**
 * Validates a TOTP code against a secret with clock drift tolerance
 * @param {string|number} token - The 6-digit OTP code to verify
 * @param {string} secret - Base32 secret key
 * @param {number} [window=1] - Tolerated step drift (-1, 0, +1)
 * @returns {boolean}
 */
export function verifyTOTP(token, secret, window = 1) {
    if (!token || !secret) return false;
    const strToken = String(token).trim();
    const now = Math.floor(Date.now() / 1000);

    for (let step = -window; step <= window; step++) {
        const expected = generateTOTP(secret, 30, 6, now + step * 30);
        if (expected === strToken) return true;
    }
    return false;
}

export default {
    extractSecretFromInput,
    base32ToBuffer,
    generateTOTP,
    verifyTOTP
};
