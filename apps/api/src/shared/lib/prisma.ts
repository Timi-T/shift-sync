/**
 * Prisma Client singleton.
 *
 * Node.js caches module imports, so a single PrismaClient instance is used for
 * the lifetime of the process. This prevents connection pool exhaustion when
 * running in development with ts-node watch mode (which re-imports modules on
 * change but reuses the same Node process).
 */

import { PrismaClient } from "@prisma/client";

declare global {
  // Allow `global.prisma` in TypeScript without type errors.
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
