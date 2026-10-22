import CryptoJS from "crypto-js";

const getKey = () => {
    return process.env.ENCRYPTION_KEY || "fcc3ae5999dc642c5d77ea0d035ae611d04723e1c8d4a8fb93dbda738b22e4d8";
};

const encrypt = (text) => {
    if (!text) return text;
    const key = getKey();
    return CryptoJS.AES.encrypt(String(text), key).toString();
};

const decrypt = (encryptedText) => {
    if (!encryptedText) return "";
    try {
        const key = getKey();
        const bytes = CryptoJS.AES.decrypt(encryptedText, key);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        return originalText || encryptedText;
    } catch (e) {
        return encryptedText;
    }
};

export {
    encrypt,
    decrypt
};