/**
 * ShiftSync API — Entry point.
 *
 * Creates the Express app, attaches Socket.io to the HTTP server,
 * starts background jobs, and begins listening.
 */

import { createServer } from "http";
import { createApp } from "./app.js";
import { createSocketServer } from "./socket.js";
import { expireDropRequests } from "./jobs/expire-drops.js";
import { prisma } from "./shared/lib/prisma.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

async function bootstrap() {
  // Verify DB connection before accepting traffic
  await prisma.$connect();
  console.log("✅  Database connected");

  const app = createApp();
  const httpServer = createServer(app);

  createSocketServer(httpServer);
  console.log("✅  Socket.io attached");

  // Run drop expiry every 5 minutes
  setInterval(() => {
    expireDropRequests().catch((err) =>
      console.error("[Jobs] expireDropRequests failed:", err),
    );
  }, 5 * 60 * 1000);

  httpServer.listen(PORT, () => {
    console.log(`\n🚀  ShiftSync API running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV ?? "development"}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully…`);
    httpServer.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  console.error("❌  Failed to start:", err);
  process.exit(1);
});
