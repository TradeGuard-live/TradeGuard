import rateLimit from "express-rate-limit";

/**
 * Strict rate limiter for authentication endpoints.
 * Prevents brute-force login attempts and credential stuffing.
 * 10 attempts per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: {
        success: false,
        message: "Too many authentication attempts. Please try again after 15 minutes."
    },
    standardHeaders: true,
    legacyHeaders: false,
    // ✅ Skip successful logins so genuine users aren't locked out after logging in
    skipSuccessfulRequests: true,
    // ✅ Skip during automated testing to avoid flaky tests
    skip: () => process.env.NODE_ENV === 'test'
});

/**
 * Moderate rate limiter for general API endpoints.
 * 100 requests per 15 minutes per IP.
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        success: false,
        message: "Too many requests. Please slow down."
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Strict rate limiter for password reset.
 * Prevents email bombing.
 * 3 attempts per 15 minutes per IP.
 */
export const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: {
        success: false,
        message: "Too many password reset requests. Please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false
});
