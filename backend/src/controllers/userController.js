import crypto from "crypto";
import User from "../models/User.js";
import BrokerAccount from "../models/BrokerAccount.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import transporter from "../utils/transporter.js";

dotenv.config();

/**
 * User login
 * ✅ Uniform 401 response prevents username/email enumeration
 * ✅ Returns sanitized user info and JWT token
 */
export async function login(req, res) {
    try {
        const { email, username, identifier: rawId, loginId, password } = req.body;
        const identifier = String(rawId || email || username || loginId || "").trim();

        if (!identifier || !password) {
            return res.status(400).json({ message: "Username or email and password are required" });
        }

        // ✅ Find user by either email (case-insensitive) or username (case-insensitive & separator-flexible)
        const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exactRegex = new RegExp(`^${escaped}$`, 'i');

        const orClauses = [
            { email: identifier.toLowerCase() },
            { username: exactRegex }
        ];

        // ✅ Flexible whitespace / separator matching for usernames (e.g. "nexuspro" or "nexus_pro" matching "Nexus Pro")
        const tokens = identifier.split(/[\s_-]+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (tokens.length > 0) {
            orClauses.push({ username: new RegExp(`^${tokens.join('[\\s_-]*')}$`, 'i') });
        }

        const compact = identifier.replace(/[\s_-]+/g, '');
        if (compact.length > 1) {
            const compactEscaped = compact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const flexibleChars = compactEscaped.split('').map(c => /[a-zA-Z0-9]/.test(c) ? `${c}[\\s_-]*` : c).join('');
            orClauses.push({ username: new RegExp(`^${flexibleChars}$`, 'i') });
        }

        const user = await User.findOne({ $or: orClauses });

        // ✅ Return uniform 401 to prevent enumeration attacks
        if (!user) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        // Fetch user's broker accounts directly from DB without blocking login
        let userBrokerAccounts = [];
        try {
            const accounts = await BrokerAccount.find({ userId: user._id }).lean();
            userBrokerAccounts = accounts.map(acc => ({
                id: acc._id,
                broker: acc.broker,
                isConnected: Boolean(acc.isConnected),
                lastConnectedAt: acc.lastConnectedAt
            }));
        } catch (e) {
            // Broker accounts load notice
        }

        return res.status(200).json({
            token,
            user: { id: user._id, userId: user._id, username: user.username, email: user.email },
            brokerAccounts: userBrokerAccounts
        });
    } catch (error) {
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

/**
 * User registration
 * ✅ Validates input, hashes password, creates user safely
 */
export async function register(req, res) {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ message: "Username, email and password are required" });
        }

        if (typeof password !== "string" || password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters long" });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await User.findOne({ email: normalizedEmail });

        if (existingUser) {
            return res.status(400).json({ message: "User already exists with this email" });
        }

        const lastUser = await User.findOne().sort({ userId: -1 });
        const nextUserId = lastUser && Number.isFinite(lastUser.userId)
            ? lastUser.userId + 1
            : 1;

        const newUser = new User({
            userId: nextUserId,
            username: username.trim(),
            email: normalizedEmail,
            password
        });

        await newUser.save();

        const token = jwt.sign(
            { userId: newUser._id, email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        return res.status(201).json({
            token,
            user: { id: newUser._id, username: newUser.username, email: newUser.email }
        });
    } catch (error) {
        return res.status(500).json({ message: "User not created" });
    }
}

/**
 * Forgot password handler
 * ✅ Generates cryptographically secure random token, stores SHA-256 hash
 * ✅ Uniform response avoids email enumeration; no plaintext token logging
 */
export async function forgotPassword(req, res) {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const normalizedEmail = String(email).toLowerCase().trim();
        const existingUser = await User.findOne({ email: normalizedEmail });

        // ✅ If user does not exist, return uniform success response (prevents account enumeration)
        if (!existingUser) {
            return res.status(200).json({
                message: "If the account exists, a reset email has been sent."
            });
        }

        // ✅ Cryptographically secure single-use token (32 random bytes)
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

        existingUser.resetPasswordToken = tokenHash;
        existingUser.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
        await existingUser.save();

        const resetBaseUrl = process.env.RESET_URL || "http://localhost:3000/reset-password";
        const resetLink = `${resetBaseUrl}/${rawToken}`;

        // Attempt sending email if transporter configured
        try {
            if (process.env.EMAIL_USER && transporter) {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: existingUser.email,
                    subject: "Reset your TradeGuard password",
                    html: `
                        <h2>Password Reset</h2>
                        <p>Hello ${existingUser.username},</p>
                        <p>Click the link below to reset your password:</p>
                        <p><a href="${resetLink}">Reset Password</a></p>
                        <p>This single-use link expires in 15 minutes.</p>
                        <p>If you did not request this, please ignore this email.</p>
                    `
                });
            }
        } catch (mailError) {
            // Silently fail email delivery without crashing endpoint
        }

        return res.status(200).json({
            message: "If the account exists, a reset email has been sent."
        });
    } catch (error) {
        return res.status(500).json({ message: "Server error occurred" });
    }
}

/**
 * Reset password handler
 * ✅ Validates single-use token hash and expiration
 * ✅ Immediately invalidates token upon password change; no secret logging
 */
export async function resetPassword(req, res) {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ message: "Token and new password are required" });
        }

        if (typeof newPassword !== "string" || newPassword.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters long" });
        }

        // ✅ Compute SHA-256 hash of the provided raw token
        const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");

        // ✅ Lookup user with matching token and active expiry
        const user = await User.findOne({
            resetPasswordToken: tokenHash,
            resetPasswordExpires: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({
                message: "Invalid or expired password reset token"
            });
        }

        // ✅ Update password and invalidate single-use token immediately
        user.password = newPassword;
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();

        return res.status(200).json({
            message: "Password reset successfully"
        });
    } catch (error) {
        return res.status(500).json({
            message: "Password reset failed"
        });
    }
}
