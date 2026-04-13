/**
 * Express application factory.
 *
 * The app is created here (without starting to listen) so that integration
 * tests can import and use it without binding to a port.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { createApiRouter } from "./routes.js";
import { errorHandler } from "./shared/middleware/error-handler.js";

export function createApp() {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (curl, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true, // Allow cookies
    }),
  );

  // ── Parsing ─────────────────────────────────────────────────────────────
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(compression());

  // ── Logging ─────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
  }

  // ── Rate limiting ────────────────────────────────────────────────────────
  // More generous on login to avoid locking out real users during testing,
  // stricter on general API to prevent scraping.
  app.use(
    "/api/auth/login",
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true }),
  );
  app.use(
    "/api",
    rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true }),
  );

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // ── API routes ───────────────────────────────────────────────────────────
  app.use("/api", createApiRouter());

  // ── 404 handler ──────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: "Route not found" });
  });

  // ── Central error handler (must be last) ─────────────────────────────────
  app.use(errorHandler);

  return app;
}
