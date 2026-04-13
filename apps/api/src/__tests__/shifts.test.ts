/**
 * Integration tests — Shifts routes
 *
 * GET    /api/shifts/on-duty          — live dashboard
 * GET    /api/shifts                  — list (role-scoped)
 * POST   /api/shifts                  — create (manager/admin)
 * GET    /api/shifts/:id              — get by ID
 * PUT    /api/shifts/:id              — update (before 48h cutoff)
 * DELETE /api/shifts/:id              — cancel
 * POST   /api/shifts/:id/publish      — publish
 * GET    /api/shifts/:id/audit        — audit log
 * POST   /api/shifts/:shiftId/assignments         — assign staff
 * DELETE /api/shifts/:shiftId/assignments/:id     — remove assignment
 * POST   /api/shifts/:shiftId/assignments/preview — overtime preview
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/shared/lib/prisma.js";
import {
  request,
  adminToken,
  managerToken,
  staffToken,
} from "@/shared/tests/helpers.js";

const now = new Date();
const futureStart = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72h from now
const futureEnd = new Date(futureStart.getTime() + 8 * 60 * 60 * 1000);
const nearStart = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h — within 48h cutoff

const MOCK_SHIFT = {
  id: "shift_1",
  locationId: "loc_1",
  skillId: "skill_1",
  startTime: futureStart,
  endTime: futureEnd,
  headcount: 2,
  status: "DRAFT",
  isPremium: false,
  publishedAt: null,
  createdBy: "user_admin",
  createdAt: now,
  updatedAt: now,
  location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" },
  skill: { id: "skill_1", name: "Barista" },
  assignments: [],
};

// ---------------------------------------------------------------------------
// GET /api/shifts/on-duty
// ---------------------------------------------------------------------------
describe("GET /api/shifts/on-duty", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/shifts/on-duty");
    expect(res.status).toBe(401);
  });

  it("returns active shifts for any authenticated user", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([MOCK_SHIFT] as never);

    const res = await request
      .get("/api/shifts/on-duty")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/shifts
// ---------------------------------------------------------------------------
describe("GET /api/shifts", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/shifts");
    expect(res.status).toBe(401);
  });

  it("returns all shifts for ADMIN", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([MOCK_SHIFT] as never);

    const res = await request
      .get("/api/shifts")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: "shift_1", status: "DRAFT" });
  });

  it("scopes STAFF to only PUBLISHED shifts in certified locations", async () => {
    vi.mocked(prisma.locationCertification.findMany).mockResolvedValue([
      { locationId: "loc_1" },
    ] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);

    await request
      .get("/api/shifts")
      .set("Authorization", `Bearer ${staffToken}`);

    const call = vi.mocked(prisma.shift.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({ status: "PUBLISHED" });
  });

  it("scopes MANAGER to only their managed locations", async () => {
    vi.mocked(prisma.locationManager.findMany).mockResolvedValue([
      { locationId: "loc_1" },
    ] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);

    await request
      .get("/api/shifts")
      .set("Authorization", `Bearer ${managerToken}`);

    const call = vi.mocked(prisma.shift.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({ locationId: { in: ["loc_1"] } });
  });

  it("includes openSlots in response", async () => {
    const shiftWithAssignment = {
      ...MOCK_SHIFT,
      headcount: 2,
      assignments: [{ status: "CONFIRMED", assignedAt: now, updatedAt: now, user: {} }],
    };
    vi.mocked(prisma.shift.findMany).mockResolvedValue([shiftWithAssignment] as never);

    const res = await request
      .get("/api/shifts")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body.data[0].openSlots).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/shifts
// ---------------------------------------------------------------------------
describe("POST /api/shifts", () => {
  const validBody = {
    locationId: "loc_1",
    skillId: "skill_1",
    startTime: futureStart.toISOString(),
    endTime: futureEnd.toISOString(),
    headcount: 2,
  };

  it("returns 403 for STAFF", async () => {
    const res = await request
      .post("/api/shifts")
      .set("Authorization", `Bearer ${staffToken}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request
      .post("/api/shifts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ locationId: "loc_1" }); // missing required fields
    expect(res.status).toBe(400);
  });

  it("creates shift and returns 201 for ADMIN", async () => {
    const created = { ...MOCK_SHIFT, id: "shift_new" };

    vi.mocked(prisma.location.findUnique).mockResolvedValue({
      id: "loc_1",
      name: "Downtown",
      timezone: "America/New_York",
    } as never);
    vi.mocked(prisma.skill.findUnique).mockResolvedValue({ id: "skill_1", name: "Barista" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        shift: { create: vi.fn().mockResolvedValue(created) },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .post("/api/shifts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({ id: "shift_new" });
  });

  it("returns 403 when MANAGER does not manage the location", async () => {
    vi.mocked(prisma.locationManager.findUnique).mockResolvedValue(null);

    const res = await request
      .post("/api/shifts")
      .set("Authorization", `Bearer ${managerToken}`)
      .send(validBody);

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/shifts/:id
// ---------------------------------------------------------------------------
describe("GET /api/shifts/:id", () => {
  it("returns 404 when shift does not exist", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue(null);

    const res = await request
      .get("/api/shifts/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("returns shift with location, skill, and assignments", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue(MOCK_SHIFT as never);

    const res = await request
      .get("/api/shifts/shift_1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: "shift_1",
      location: { name: "Downtown" },
      skill: { name: "Barista" },
    });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/shifts/:id  (48h cutoff guard)
// ---------------------------------------------------------------------------
describe("PUT /api/shifts/:id", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .put("/api/shifts/shift_1")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ headcount: 3 });
    expect(res.status).toBe(403);
  });

  it("returns 404 when shift does not exist", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue(null);

    const res = await request
      .put("/api/shifts/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ headcount: 3 });

    expect(res.status).toBe(404);
  });

  it("returns 403 when PUBLISHED shift is within 48h cutoff", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      ...MOCK_SHIFT,
      status: "PUBLISHED",
      startTime: nearStart, // 24h away — within 48h cutoff
      location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" },
    } as never);

    const res = await request
      .put("/api/shifts/shift_1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ headcount: 3 });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("48");
  });

  it("updates DRAFT shift regardless of start time", async () => {
    const updatedShift = {
      ...MOCK_SHIFT,
      headcount: 3,
      status: "DRAFT",
      startTime: nearStart,
      assignments: [],
    };
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      ...MOCK_SHIFT,
      status: "DRAFT",
      startTime: nearStart, // would be blocked if PUBLISHED
      location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" },
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        shift: { update: vi.fn().mockResolvedValue(updatedShift) },
        swapRequest: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .put("/api/shifts/shift_1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ headcount: 3 });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/shifts/:id (cancel)
// ---------------------------------------------------------------------------
describe("DELETE /api/shifts/:id", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .delete("/api/shifts/shift_1")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 when shift does not exist", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue(null);

    const res = await request
      .delete("/api/shifts/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("cancels the shift for ADMIN", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      ...MOCK_SHIFT,
      location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" },
      assignments: [],
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        shift: { update: vi.fn() },
        shiftAssignment: { updateMany: vi.fn() },
        swapRequest: { updateMany: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .delete("/api/shifts/shift_1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(204); // noContent
  });
});

// ---------------------------------------------------------------------------
// POST /api/shifts/:id/publish
// ---------------------------------------------------------------------------
describe("POST /api/shifts/:id/publish", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .post("/api/shifts/shift_1/publish")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 when shift does not exist", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue(null);

    const res = await request
      .post("/api/shifts/nonexistent/publish")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("publishes a DRAFT shift", async () => {
    const publishedShift = { ...MOCK_SHIFT, status: "PUBLISHED", publishedAt: now };
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      ...MOCK_SHIFT,
      status: "DRAFT",
      location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" },
      assignments: [],
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        shift: { update: vi.fn().mockResolvedValue(publishedShift) },
        auditLog: { create: vi.fn() },
      } as never),
    );
    // After publish tx, controller calls prisma.shiftAssignment.findMany
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([]);

    const res = await request
      .post("/api/shifts/shift_1/publish")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/shifts/:id/audit
// ---------------------------------------------------------------------------
describe("GET /api/shifts/:id/audit", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .get("/api/shifts/shift_1/audit")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("returns audit log for the shift", async () => {
    const auditEntry = {
      id: "audit_1",
      entityType: "Shift",
      entityId: "shift_1",
      action: "published",
      before: null,
      after: { status: "PUBLISHED" },
      performedBy: "user_admin",
      performer: { id: "user_admin", name: "Admin User" },
      performedAt: new Date(),
      shiftId: "shift_1",
      locationId: "loc_1",
    };
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([auditEntry] as never);

    const res = await request
      .get("/api/shifts/shift_1/audit")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ action: "published" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/shifts/:shiftId/assignments
// ---------------------------------------------------------------------------
describe("POST /api/shifts/:shiftId/assignments", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .post("/api/shifts/shift_1/assignments")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ userId: "user_staff_1" });
    expect(res.status).toBe(403);
  });

  it("returns 404 when shift does not exist", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue(null);

    const res = await request
      .post("/api/shifts/nonexistent/assignments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: "cuseraaaaaaaaaa" }); // valid CUID format

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/shifts/:shiftId/assignments/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/shifts/:shiftId/assignments/:id", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .delete("/api/shifts/shift_1/assignments/asgn_1")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });
});
