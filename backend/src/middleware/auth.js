import jwt from "jsonwebtoken";

/**
 * JWT Authentication Middleware
 *
 * Verifies the Bearer token from the Authorization header,
 * decodes it, and attaches { userId, email } to req.user.
 *
 * All protected routes MUST use this middleware so that
 * controllers derive user identity from the verified JWT —
 * never from client-supplied query params or body fields.
 */
export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication required. Please provide a valid token."
        });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication token is missing."
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
            userId: decoded.userId,
            email: decoded.email
        };
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token has expired. Please log in again."
            });
        }
        return res.status(401).json({
            success: false,
            message: "Invalid authentication token."
        });
    }
}
