/**
 * Authentication middleware.
 *
 * Extracts the JWT from either:
 *   1. The `Authorization: Bearer <token>` header, or
 *   2. The `token` httpOnly cookie (set at login).
 *
 * On success, attaches the decoded payload to `req.user`.
 * On failure, calls next() with an UnauthorizedError — the error handler
 * converts it to a 401 JSON response.
 *
 * Usage: apply to any route that requires a logged-in user.
 *   router.get("/protected", authenticate, handler)
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
const { JsonWebTokenError, TokenExpiredError } = jwt;
import { verifyToken, type JwtPayload } from "@/shared/lib/jwt.js";
import { UnauthorizedError } from "@/shared/lib/errors.js";

// Extend Express Request to carry the authenticated user.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const token = extractToken(req);

    if (!token) {
      throw new UnauthorizedError("No authentication token provided");
    }

    req.user = verifyToken(token);
    next();
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      next(new UnauthorizedError("Session expired — please log in again"));
    } else if (err instanceof JsonWebTokenError) {
      next(new UnauthorizedError("Invalid authentication token"));
    } else {
      next(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToken(req: Request): string | null {
  // Prefer Authorization header (useful for API testing, mobile clients).
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Fall back to httpOnly cookie (set by POST /auth/login).
  const cookieToken = req.cookies?.token as string | undefined;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}
