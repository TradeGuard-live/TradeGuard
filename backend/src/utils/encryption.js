import crypto from "crypto";
import CryptoJS from "crypto-js";

/**
 * Derives a 32-byte key for AES-256-GCM from ENCRYPTION_KEY.
 * Disallows insecure defaults in production.
 */
const getDerivedKey = () => {
    const rawKey = process.env.ENCRYPTION_KEY;
    if (!rawKey) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("CRITICAL SECURITY ERROR: ENCRYPTION_KEY environment variable is required in production!");
        }
        // Development / testing key (derived via SHA-256)
        return crypto.createHash("sha256").update("tradeguard-dev-insecure-key-do-not-use-in-production").digest();
    }
    return crypto.createHash("sha256").update(rawKey).digest();
};

const getLegacyKey = () => {
    return process.env.ENCRYPTION_KEY || "fcc3ae5999dc642c5d77ea0d035ae611d04723e1c8d4a8fb93dbda738b22e4d8";
};

/**
 * Encrypts sensitive text using authenticated AES-256-GCM.
 * Output format: `v1:ivHex:authTagHex:ciphertextHex`
 * ✅ Implements authenticated AES-256-GCM encryption with 96-bit random IV & auth tag
 */
export const encrypt = (text) => {
    if (!text) return text;
    const str = String(text);
    // Avoid double encryption if already formatted
    if (str.startsWith("v1:") && str.split(":").length === 4) {
        return str;
    }
    const key = getDerivedKey();
    const iv = crypto.randomBytes(12); // Standard 96-bit nonce for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    
    let encrypted = cipher.update(str, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return `v1:${iv.toString("hex")}:${authTag}:${encrypted}`;
};

/**
 * Decrypts ciphertext. Supports authenticated AES-256-GCM and backward-compatible legacy CryptoJS AES.
 * ✅ Supports authenticated AES-256-GCM with backward-compatible legacy CryptoJS decryption
 */
export const decrypt = (encryptedText) => {
    if (!encryptedText) return "";
    const str = String(encryptedText);

    // Format check for v1 AES-256-GCM
    if (str.startsWith("v1:")) {
        const parts = str.split(":");
        if (parts.length === 4) {
            const [, ivHex, authTagHex, cipherHex] = parts;
            try {
                const key = getDerivedKey();
                const iv = Buffer.from(ivHex, "hex");
                const authTag = Buffer.from(authTagHex, "hex");
                const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
                decipher.setAuthTag(authTag);
                let decrypted = decipher.update(cipherHex, "hex", "utf8");
                decrypted += decipher.final("utf8");
                return decrypted;
            } catch (err) {
                // Return empty string on authentication tag failure / corrupted data
                return "";
            }
        }
    }

    // Fallback: Legacy CryptoJS AES decryption for existing data
    try {
        const legacyKey = getLegacyKey();
        const bytes = CryptoJS.AES.decrypt(str, legacyKey);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        if (originalText) return originalText;
    } catch {
        // Continue
    }

    return str;
};

export default {
    encrypt,
    decrypt
};