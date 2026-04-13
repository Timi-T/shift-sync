/**
 * Integration tests — Auth routes
 *
 * POST /api/auth/login
 * POST /api/auth/logout
 * GET  /api/auth/me
 *
 * Prisma, Redis, and sockets are mocked globally by src/shared/tests/setup.ts.
 * bcryptjs is mocked here so we don't need real password hashes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/shared/lib/prisma.js";
import { request, adminToken } from "@/shared/tests/helpers.js";

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
  compare: vi.fn(),
  hash: vi.fn(),
}));

import bcrypt from "bcryptjs";

const MOCK_USER = {
  id: "user_admin",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN" as const,
  passwordHash: "$2a$10$fakehash",
};

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
  });

  it("returns 400 when body is missing required fields", async () => {
    const res = await request.post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when email is invalid", async () => {
    const res = await request
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "secret" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 401 when user is not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password" });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns 401 when password is wrong", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    const res = await request
      .post("/api/auth/login")
      .send({ email: MOCK_USER.email, password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns token and user on valid credentials", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const res = await request
      .post("/api/auth/login")
      .send({ email: MOCK_USER.email, password: "correctpassword" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({
      token: expect.any(String),
      user: { id: MOCK_USER.id, email: MOCK_USER.email, role: "ADMIN" },
    });
  });

  it("sets an httpOnly cookie on successful login", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const res = await request
      .post("/api/auth/login")
      .send({ email: MOCK_USER.email, password: "correctpassword" });

    expect(res.headers["set-cookie"]).toBeDefined();
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toContain("HttpOnly");
  });
});

describe("POST /api/auth/logout", () => {
  it("returns 200 and clears the cookie", async () => {
    const res = await request.post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.message).toBe("Logged out successfully");
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 when no token provided", async () => {
    const res = await request.get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user from JWT", async () => {
    const fullUser = {
      id: "user_admin",
      email: "admin@example.com",
      name: "Admin User",
      role: "ADMIN",
      desiredHoursPerWeek: 40,
      notificationPreference: { inApp: true, email: false },
      skills: [],
      locationCertifications: [],
    };

    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(fullUser as never);

    const res = await request
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({
      id: "user_admin",
      email: "admin@example.com",
      role: "ADMIN",
    });
  });

  it("returns 401 with an invalid token", async () => {
    const res = await request
      .get("/api/auth/me")
      .set("Authorization", "Bearer this.is.not.valid");

    expect(res.status).toBe(401);
  });
});
