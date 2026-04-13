/**
 * Integration tests — Availability routes
 *
 * GET    /api/availability              — current user's windows
 * GET    /api/availability/:userId      — any user's windows (manager/admin)
 * POST   /api/availability              — create window
 * PUT    /api/availability/:id          — update window
 * DELETE /api/availability/:id          — delete window
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

const MOCK_WINDOW = {
  id: "avail_1",
  userId: "user_sarah", // matches staffToken sub from helpers.ts
  type: "RECURRING" as const,
  dayOfWeek: 1, // Monday
  startTime: "09:00",
  endTime: "17:00",
  date: null,
  available: true,
  effectiveFrom: null,
  effectiveTo: null,
  createdAt: now,
  updatedAt: now,
};

// ---------------------------------------------------------------------------
// GET /api/availability (own)
// ---------------------------------------------------------------------------
describe("GET /api/availability", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/availability");
    expect(res.status).toBe(401);
  });

  it("returns current user's availability windows", async () => {
    vi.mocked(prisma.availabilityWindow.findMany).mockResolvedValue([MOCK_WINDOW] as never);

    const res = await request
      .get("/api/availability")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ type: "RECURRING", dayOfWeek: 1 });
  });
});

// ---------------------------------------------------------------------------
// GET /api/availability/:userId
// ---------------------------------------------------------------------------
describe("GET /api/availability/:userId", () => {
  it("returns 403 when STAFF tries to view another user's availability", async () => {
    const res = await request
      .get("/api/availability/other_user")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  it("returns availability for any user for ADMIN", async () => {
    vi.mocked(prisma.availabilityWindow.findMany).mockResolvedValue([MOCK_WINDOW] as never);

    const res = await request
      .get("/api/availability/user_staff")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("allows MANAGER to view staff availability", async () => {
    vi.mocked(prisma.availabilityWindow.findMany).mockResolvedValue([MOCK_WINDOW] as never);

    const res = await request
      .get("/api/availability/user_staff")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/availability
// ---------------------------------------------------------------------------
describe("POST /api/availability", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.post("/api/availability").send({});
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request
      .post("/api/availability")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "INVALID_TYPE" });

    expect(res.status).toBe(400);
  });

  it("creates a RECURRING availability window", async () => {
    vi.mocked(prisma.availabilityWindow.create).mockResolvedValue(MOCK_WINDOW as never);
    vi.mocked(prisma.locationCertification.findMany).mockResolvedValue([]);

    const res = await request
      .post("/api/availability")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        type: "RECURRING",
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "17:00",
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({ type: "RECURRING", dayOfWeek: 1 });
  });

  it("creates an EXCEPTION (day-off) window", async () => {
    const exceptionWindow = {
      ...MOCK_WINDOW,
      type: "EXCEPTION" as const,
      dayOfWeek: null,
      date: new Date("2026-05-01"),
      available: false,
    };
    vi.mocked(prisma.availabilityWindow.create).mockResolvedValue(exceptionWindow as never);
    vi.mocked(prisma.locationCertification.findMany).mockResolvedValue([]);

    const res = await request
      .post("/api/availability")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        type: "EXCEPTION",
        date: "2026-05-01",
        startTime: "00:00",
        endTime: "23:59",
        available: false,
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/availability/:id
// ---------------------------------------------------------------------------
describe("PUT /api/availability/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.put("/api/availability/avail_1").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 when window does not exist", async () => {
    vi.mocked(prisma.availabilityWindow.findUnique).mockResolvedValue(null);

    const res = await request
      .put("/api/availability/nonexistent")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ startTime: "10:00" });

    expect(res.status).toBe(404);
  });

  it("returns 403 when STAFF tries to update another user's window", async () => {
    vi.mocked(prisma.availabilityWindow.findUnique).mockResolvedValue({
      ...MOCK_WINDOW,
      userId: "different_user",
    } as never);

    const res = await request
      .put("/api/availability/avail_1")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ startTime: "10:00" });

    expect(res.status).toBe(403);
  });

  it("updates the window successfully", async () => {
    const updated = { ...MOCK_WINDOW, startTime: "10:00" };
    vi.mocked(prisma.availabilityWindow.findUnique).mockResolvedValue(MOCK_WINDOW as never);
    vi.mocked(prisma.availabilityWindow.update).mockResolvedValue(updated as never);

    const res = await request
      .put("/api/availability/avail_1")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ startTime: "10:00" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ startTime: "10:00" });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/availability/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/availability/:id", () => {
  it("returns 404 when window does not exist", async () => {
    vi.mocked(prisma.availabilityWindow.findUnique).mockResolvedValue(null);

    const res = await request
      .delete("/api/availability/nonexistent")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 403 when STAFF tries to delete another user's window", async () => {
    vi.mocked(prisma.availabilityWindow.findUnique).mockResolvedValue({
      ...MOCK_WINDOW,
      userId: "different_user",
    } as never);

    const res = await request
      .delete("/api/availability/avail_1")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  it("deletes the window and returns 204", async () => {
    vi.mocked(prisma.availabilityWindow.findUnique).mockResolvedValue(MOCK_WINDOW as never);
    vi.mocked(prisma.availabilityWindow.delete).mockResolvedValue(MOCK_WINDOW as never);

    const res = await request
      .delete("/api/availability/avail_1")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(204);
  });
});
