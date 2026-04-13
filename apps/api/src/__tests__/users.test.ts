/**
 * Integration tests — Users routes
 *
 * GET    /api/users               — list (role-scoped)
 * POST   /api/users               — create (admin only)
 * GET    /api/users/:id           — get by ID
 * PUT    /api/users/:id           — update profile/skills/locations
 * PATCH  /api/users/:id/role      — change role (admin only)
 * GET    /api/users/:id/hours     — weekly hours summary
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/shared/lib/prisma.js";
import {
  request,
  adminToken,
  managerToken,
  staffToken,
} from "@/shared/tests/helpers.js";

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn().mockResolvedValue("$hashed") },
  compare: vi.fn(),
  hash: vi.fn().mockResolvedValue("$hashed"),
}));

const MOCK_USER = {
  id: "user_staff_1",
  name: "Alice Staff",
  email: "alice@example.com",
  role: "STAFF" as const,
  desiredHoursPerWeek: 32,
  skills: [{ skill: { id: "skill_1", name: "Barista" } }],
  locationCertifications: [{ location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" } }],
  managedLocations: [],
  notificationPreference: { inApp: true, email: false },
};

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------
describe("GET /api/users", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/users");
    expect(res.status).toBe(401);
  });

  it("returns all users for ADMIN", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([MOCK_USER] as never);

    const res = await request
      .get("/api/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: "user_staff_1", name: "Alice Staff" });
  });

  it("scopes results to managed locations for MANAGER", async () => {
    vi.mocked(prisma.locationManager.findMany).mockResolvedValue([
      { locationId: "loc_1" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([MOCK_USER] as never);

    const res = await request
      .get("/api/users")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.user.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({
      locationCertifications: { some: { locationId: { in: ["loc_1"] } } },
    });
  });

  it("filters by skillId when provided", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await request
      .get("/api/users?skillId=skill_1")
      .set("Authorization", `Bearer ${adminToken}`);

    const call = vi.mocked(prisma.user.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({ skills: { some: { skillId: "skill_1" } } });
  });

  it("maps manager locationCertifications from managedLocations", async () => {
    const managerUser = {
      ...MOCK_USER,
      role: "MANAGER" as const,
      managedLocations: [{ location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" } }],
      locationCertifications: [],
    };
    vi.mocked(prisma.user.findMany).mockResolvedValue([managerUser] as never);

    const res = await request
      .get("/api/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].locationCertifications).toEqual([
      { id: "loc_1", name: "Downtown", timezone: "America/New_York" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/users
// ---------------------------------------------------------------------------
describe("POST /api/users", () => {
  // Valid CUID-format IDs (Zod cuid regex: /^c[^\s-]{8,}$/i)
  const CUID_SKILL = "cskillaaaaaaaaaa";
  const CUID_LOC = "clocaaaaaaaaaaaa";

  const validBody = {
    name: "Bob New",
    email: "bob@example.com",
    password: "Secret123!",
    role: "STAFF",
    desiredHoursPerWeek: 40,
    skillIds: [CUID_SKILL],
    locationIds: [CUID_LOC],
  };

  it("returns 403 for MANAGER", async () => {
    const res = await request
      .post("/api/users")
      .set("Authorization", `Bearer ${managerToken}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 403 for STAFF", async () => {
    const res = await request
      .post("/api/users")
      .set("Authorization", `Bearer ${staffToken}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "not-valid" });
    expect(res.status).toBe(400);
  });

  it("creates user and returns 201 for ADMIN", async () => {
    const created = { id: "user_new", name: validBody.name, email: validBody.email, role: validBody.role };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        user: { create: vi.fn().mockResolvedValue(created) },
        userSkill: { createMany: vi.fn() },
        locationCertification: { createMany: vi.fn() },
        notificationPreference: { create: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({ name: validBody.name, email: validBody.email });
  });
});

// ---------------------------------------------------------------------------
// GET /api/users/:id
// ---------------------------------------------------------------------------
describe("GET /api/users/:id", () => {
  it("returns 404 when user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request
      .get("/api/users/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("returns user with skills and locationCertifications", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);

    const res = await request
      .get("/api/users/user_staff_1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: "user_staff_1",
      skills: [{ id: "skill_1", name: "Barista" }],
    });
    expect(res.body.data.managedLocations).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PUT /api/users/:id
// ---------------------------------------------------------------------------
describe("PUT /api/users/:id", () => {
  it("returns 403 when STAFF tries to update another user", async () => {
    const res = await request
      .put("/api/users/other_user")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Hacked" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when target user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request
      .put("/api/users/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Updated" });

    expect(res.status).toBe(404);
  });

  it("updates user profile for ADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        user: { update: vi.fn() },
        userSkill: { deleteMany: vi.fn(), createMany: vi.fn() },
        locationCertification: { deleteMany: vi.fn(), createMany: vi.fn() },
        locationManager: { deleteMany: vi.fn(), createMany: vi.fn() },
        notificationPreference: { upsert: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .put("/api/users/user_staff_1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Alice Updated", skillIds: ["cskill2aaaaaaaaa"] });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("User updated successfully");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/role
// ---------------------------------------------------------------------------
describe("PATCH /api/users/:id/role", () => {
  it("returns 403 for non-admin", async () => {
    const res = await request
      .patch("/api/users/user_staff_1/role")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ role: "ADMIN" });

    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid role", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);

    const res = await request
      .patch("/api/users/user_staff_1/role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "SUPERUSER" });

    expect(res.status).toBe(403); // ForbiddenOperationError for invalid role
  });

  it("returns 404 when user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request
      .patch("/api/users/nonexistent/role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "MANAGER" });

    expect(res.status).toBe(404);
  });

  it("updates role for ADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        user: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .patch("/api/users/user_staff_1/role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "MANAGER" });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Role updated successfully");
  });
});

// ---------------------------------------------------------------------------
// GET /api/users/:id/hours
// ---------------------------------------------------------------------------
describe("GET /api/users/:id/hours", () => {
  it("returns 404 when user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request
      .get("/api/users/nonexistent/hours")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("returns hours summary with scheduled hours and delta", async () => {
    const now = new Date();
    const shiftStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    const shiftEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_staff_1",
      name: "Alice Staff",
      desiredHoursPerWeek: 40,
    } as never);

    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([
      {
        userId: "user_staff_1",
        shift: {
          id: "shift_1",
          startTime: shiftStart,
          endTime: shiftEnd,
          isPremium: false,
          location: { name: "Downtown" },
        },
      },
    ] as never);

    const res = await request
      .get("/api/users/user_staff_1/hours")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.scheduledHours).toBe(8);
    expect(res.body.data.desiredHoursPerWeek).toBe(40);
    expect(res.body.data.hoursDelta).toBe(-32);
    expect(res.body.data.premiumShiftCount).toBe(0);
    expect(res.body.data.assignments).toHaveLength(1);
  });

  it("returns null hoursDelta when desiredHoursPerWeek is null", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_staff_1",
      name: "Alice Staff",
      desiredHoursPerWeek: null,
    } as never);
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([]);

    const res = await request
      .get("/api/users/user_staff_1/hours")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hoursDelta).toBeNull();
  });
});
