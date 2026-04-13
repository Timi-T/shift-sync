/**
 * Socket.io server setup.
 *
 * Handles connection authentication and room management:
 *   - Validates the JWT on every connection (no anonymous sockets)
 *   - Joins the user to their personal room and all relevant location rooms
 *   - Cleans up on disconnect
 *
 * Room naming:
 *   user:<id>          — personal notifications
 *   location:<id>      — location-level broadcasts (schedule changes, conflicts)
 */

import type { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { verifyToken } from "@/shared/lib/jwt.js";
import { prisma } from "@/shared/lib/prisma.js";
import { setSocketServer } from "@/shared/services/socket.service.js";

export function createSocketServer(httpServer: HttpServer): SocketServer {
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());

  const io = new SocketServer(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    // Ping every 25s; clients disconnect if no pong within 60s.
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });

  // ── Authentication middleware ──────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      // Token can be in the handshake auth or query string
      const token =
        (socket.handshake.auth.token as string | undefined) ??
        (socket.handshake.query.token as string | undefined);

      if (!token) {
        next(new Error("Authentication required"));
        return;
      }

      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────
  io.on("connection", async (socket) => {
    const userId = socket.data.userId as string;
    const role = socket.data.role as string;

    // Join personal room
    await socket.join(`user:${userId}`);

    // Join location rooms based on role
    try {
      if (role === "ADMIN") {
        // Admin joins all location rooms
        const locations = await prisma.location.findMany({ select: { id: true } });
        for (const loc of locations) {
          await socket.join(`location:${loc.id}`);
        }
      } else if (role === "MANAGER") {
        const managed = await prisma.locationManager.findMany({
          where: { userId },
          select: { locationId: true },
        });
        for (const { locationId } of managed) {
          await socket.join(`location:${locationId}`);
        }
      } else {
        // Staff join rooms for their certified locations
        const certs = await prisma.locationCertification.findMany({
          where: { userId },
          select: { locationId: true },
        });
        for (const { locationId } of certs) {
          await socket.join(`location:${locationId}`);
        }
      }
    } catch (err) {
      console.error(`[Socket] Room setup failed for user ${userId}:`, err);
    }

    socket.on("disconnect", () => {
      // Socket.io handles room cleanup automatically on disconnect.
    });
  });

  // Register with the service singleton so controllers can broadcast
  setSocketServer(io);

  return io;
}
