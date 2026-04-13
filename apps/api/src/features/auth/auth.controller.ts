/**
 * Authentication controller.
 *
 * POST /api/auth/login   — verify credentials, issue JWT in httpOnly cookie + body
 * POST /api/auth/logout  — clear the cookie
 * GET  /api/auth/me      — return the current session user (used by the web app on load)
 */

import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "@/shared/lib/prisma.js";
import { signToken } from "@/shared/lib/jwt.js";
import { ok, apiError } from "@/shared/lib/response.js";
import type { LoginInput } from "@shift-sync/shared";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
} as const;

export const authController = {
  /**
   * Verify email + password, return a JWT.
   * Sets an httpOnly cookie for browser clients and also returns the token
   * in the response body for non-browser API consumers.
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as LoginInput;

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          passwordHash: true,
        },
      });

      if (!user) {
        // Generic message — don't reveal whether the email exists
        apiError(res, "Invalid email or password", 401, "INVALID_CREDENTIALS");
        return;
      }

      const passwordValid = await bcrypt.compare(password, user.passwordHash);

      if (!passwordValid) {
        apiError(res, "Invalid email or password", 401, "INVALID_CREDENTIALS");
        return;
      }

      const token = signToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });

      // Set httpOnly cookie for browser clients
      res.cookie("token", token, COOKIE_OPTIONS);

      ok(res, {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Clear the auth cookie.
   */
  logout(_req: Request, res: Response): void {
    res.clearCookie("token", COOKIE_OPTIONS);
    ok(res, { message: "Logged out successfully" });
  },

  /**
   * Return the current user from the JWT payload.
   * Requires the `authenticate` middleware to have run first.
   */
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.sub;

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          desiredHoursPerWeek: true,
          notificationPreference: { select: { inApp: true, email: true } },
          skills: { include: { skill: { select: { id: true, name: true } } } },
          locationCertifications: {
            include: {
              location: { select: { id: true, name: true, timezone: true } },
            },
          },
        },
      });

      ok(res, {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        desiredHoursPerWeek: user.desiredHoursPerWeek,
        notificationPreference: user.notificationPreference,
        skills: user.skills.map((us) => us.skill),
        locationCertifications: user.locationCertifications.map((lc) => lc.location),
      });
    } catch (err) {
      next(err);
    }
  },
};
