/**
 * Input Validation & Sanitization Middleware
 * 
 * Provides validation for authentication flows and
 * basic input sanitization to prevent injection attacks.
 */

/**
 * Strips HTML tags and trims whitespace from a string.
 */
function sanitizeString(str) {
    if (typeof str !== "string") return str;
    return str.replace(/<[^>]*>/g, "").trim();
}

/**
 * Escapes HTML entities to prevent XSS in rendered content.
 */
export function escapeHtml(str) {
    if (typeof str !== "string") return str;
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

/**
 * Escapes special regex characters to prevent ReDoS.
 */
export function escapeRegex(str) {
    if (typeof str !== "string") return str;
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates registration input.
 */
export function validateRegistration(req, res, next) {
    let { username, email, password } = req.body;

    // Sanitize
    username = sanitizeString(username);
    email = sanitizeString(email);
    req.body.username = username;
    req.body.email = email;

    if (!username || !email || !password) {
        return res.status(400).json({
            success: false,
            message: "Username, email, and password are required."
        });
    }

    // Username validation
    if (username.length < 3 || username.length > 30) {
        return res.status(400).json({
            success: false,
            message: "Username must be between 3 and 30 characters."
        });
    }

    if (!/^[a-zA-Z0-9_.\- ]+$/.test(username)) {
        return res.status(400).json({
            success: false,
            message: "Username can only contain letters, numbers, spaces, underscores, dots, and hyphens."
        });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid email address."
        });
    }

    // Password strength
    if (password.length < 8) {
        return res.status(400).json({
            success: false,
            message: "Password must be at least 8 characters long."
        });
    }

    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
            success: false,
            message: "Password must contain at least one uppercase letter, one lowercase letter, and one number."
        });
    }

    next();
}

/**
 * Validates login input.
 */
export function validateLogin(req, res, next) {
    let { email, username, identifier, loginId, password } = req.body;

    const id = sanitizeString(String(identifier || email || username || loginId || ""));
    req.body.identifier = id;

    if (!id || !password) {
        return res.status(400).json({
            success: false,
            message: "Username/email and password are required."
        });
    }

    if (id.length > 100) {
        return res.status(400).json({
            success: false,
            message: "Invalid login identifier."
        });
    }

    next();
}

/**
 * Validates password reset input.
 */
export function validatePasswordReset(req, res, next) {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({
            success: false,
            message: "Token and new password are required."
        });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({
            success: false,
            message: "Password must be at least 8 characters long."
        });
    }

    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return res.status(400).json({
            success: false,
            message: "Password must contain at least one uppercase letter, one lowercase letter, and one number."
        });
    }

    next();
}
