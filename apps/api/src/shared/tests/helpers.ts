/**
 * Integration test helpers.
 *
 * Integration tests use supertest against the real Express app with a mocked
 * Prisma and auth layer so they don't need a running database.
 * This file provides token generation and request helpers.
 */

import supertest from "supertest";
import { createApp } from "@/app.js";
import { signToken } from "@/shared/lib/jwt.js";
import type { Role } from "@prisma/client";

export const app = createApp();
export const request = supertest(app);

/**
 * Generate a signed JWT for the given user — no DB lookup needed.
 */
export function makeToken(opts: {
  id?: string;
  email?: string;
  name?: string;
  role?: Role;
}): string {
  return signToken({
    sub: opts.id ?? "user_test",
    email: opts.email ?? "test@example.com",
    name: opts.name ?? "Test User",
    role: opts.role ?? "MANAGER",
  });
}

export const adminToken   = makeToken({ id: "user_admin",    role: "ADMIN",   name: "Admin User" });
export const managerToken = makeToken({ id: "user_mgr_west", role: "MANAGER", name: "Tom Garcia" });
export const staffToken   = makeToken({ id: "user_sarah",    role: "STAFF",   name: "Sarah Chen" });
