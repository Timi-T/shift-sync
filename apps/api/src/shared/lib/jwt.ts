/**
 * JWT utilities for ShiftSync.
 *
 * Tokens are signed HS256, stored in an httpOnly cookie, and validated on
 * every authenticated request. The payload is kept minimal — only what's
 * needed for routing decisions without a DB round-trip.
 */

import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;   // User.id
  email: string;
  name: string;
  role: Role;
  iat?: number;
  exp?: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

const EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign a JWT for the given user.
 */
export function signToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
  return jwt.sign(payload, getSecret(), {
    expiresIn: EXPIRES_IN as unknown as number,
    algorithm: "HS256",
  });
}

/**
 * Verify and decode a JWT.
 * Throws a JsonWebTokenError or TokenExpiredError on failure — callers should
 * catch these and return a 401.
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret(), {
    algorithms: ["HS256"],
  }) as JwtPayload;
}
