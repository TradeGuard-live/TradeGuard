import express from 'express';
import { register, login, forgotPassword, resetPassword } from '../controllers/userController.js';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ✅ Enforce strict rate limiting on authentication and password reset routes
// ✅ Support both /api/users and /api/users/login endpoints for seamless compatibility
router.post("/", authLimiter, login);
router.post("/login", authLimiter, login);
router.post("/register", authLimiter, register);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password", passwordResetLimiter, resetPassword);

export default router;