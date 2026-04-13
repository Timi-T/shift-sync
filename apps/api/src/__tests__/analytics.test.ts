/**
 * Integration tests — Analytics routes
 *
 * GET /api/analytics/overtime   — overtime projections (admin/manager only)
 * GET /api/analytics/fairness   — premium shift fairness report
 * GET /api/analytics/hours      — staff hours distribution
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/shared/lib/prisma.js";
import {
  request,
  adminToken,
  managerToken,
  staffToken,
} from "@/shared/tests/helpers.js";

// Mock the analytics services so we don't need their full DB queries
vi.mock("@/features/analytics/overtime.service.js", () => ({
  getOvertimeProjections: vi.fn().mockResolvedValue([]),
  previewOvertimeImpact: vi.fn(),
}));

vi.mock("@/features/analytics/fairness.service.js", () => ({
  getFairnessReport: vi.fn().mockResolvedValue({
    locationId: "loc_1",
    staff: [],
    totalPremiumShifts: 0,
  }),
}));

import { getOvertimeProjections } from "@/features/analytics/overtime.service.js";
import { getFairnessReport } from "@/features/analytics/fairness.service.js";

const now = new Date();
const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

const shiftStart = new Date(weekStart.getTime() + 9 * 60 * 60 * 1000);
const shiftEnd = new Date(shiftStart.getTime() + 8 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Authorization — all analytics routes are admin/manager only
// ---------------------------------------------------------------------------
describe("Analytics auth guard", () => {
  it("returns 401 for unauthenticated overtime request", async () => {
    const res = await request.get("/api/analytics/overtime");
    expect(res.status).toBe(401);
  });

  it("returns 403 for STAFF on overtime", async () => {
    const res = await request
      .get("/api/analytics/overtime")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 for STAFF on fairness", async () => {
    const res = await request
      .get("/api/analytics/fairness?locationId=loc_1")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 for STAFF on hours", async () => {
    const res = await request
      .get("/api/analytics/hours")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/overtime
// ---------------------------------------------------------------------------
describe("GET /api/analytics/overtime", () => {
  it("returns overtime projections for ADMIN", async () => {
    const mockProjection = {
      userId: "user_staff_1",
      name: "Alice Staff",
      currentWeekHours: 42,
      overtimeHours: 2,
      desiredHoursPerWeek: 40,
      warnings: [{ type: "OVER_40H", severity: "warning", message: "Projected at 42.0h" }],
      overtimeAssignments: [],
    };

    vi.mocked(getOvertimeProjections).mockResolvedValue([mockProjection] as never);

    const res = await request
      .get("/api/analytics/overtime")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      userId: "user_staff_1",
      overtimeHours: 2,
    });
  });

  it("returns overtime projections for MANAGER", async () => {
    vi.mocked(getOvertimeProjections).mockResolvedValue([]);

    const res = await request
      .get("/api/analytics/overtime")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("passes locationId and weekStart to the service", async () => {
    vi.mocked(getOvertimeProjections).mockResolvedValue([]);

    await request
      .get("/api/analytics/overtime?locationId=loc_1&weekStart=2026-04-07")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(getOvertimeProjections).toHaveBeenCalledWith(
      new Date("2026-04-07"),
      "loc_1",
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/fairness
// ---------------------------------------------------------------------------
describe("GET /api/analytics/fairness", () => {
  it("returns 400 (not found error) when locationId is missing", async () => {
    const res = await request
      .get("/api/analytics/fairness")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 404 when location does not exist", async () => {
    vi.mocked(prisma.location.findUnique).mockResolvedValue(null);

    const res = await request
      .get("/api/analytics/fairness?locationId=nonexistent")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("returns fairness report for valid location", async () => {
    vi.mocked(prisma.location.findUnique).mockResolvedValue({
      id: "loc_1",
      name: "Downtown",
      timezone: "America/New_York",
    } as never);

    const mockReport = {
      locationId: "loc_1",
      staff: [
        { userId: "user_staff_1", name: "Alice", premiumShiftCount: 3, totalShiftCount: 10 },
      ],
      totalPremiumShifts: 3,
    };
    vi.mocked(getFairnessReport).mockResolvedValue(mockReport as never);

    const res = await request
      .get("/api/analytics/fairness?locationId=loc_1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ locationId: "loc_1", totalPremiumShifts: 3 });
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/hours
// ---------------------------------------------------------------------------
describe("GET /api/analytics/hours", () => {
  it("returns hours distribution for all staff", async () => {
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([
      {
        userId: "user_staff_1",
        user: { id: "user_staff_1", name: "Alice", desiredHoursPerWeek: 40 },
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
      .get("/api/analytics/hours")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      userId: "user_staff_1",
      name: "Alice",
      scheduledHours: 8,
      desiredHoursPerWeek: 40,
      hoursDelta: -32,
    });
  });

  it("returns empty array when no assignments exist", async () => {
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([]);

    const res = await request
      .get("/api/analytics/hours")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("filters by locationId when provided", async () => {
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([]);

    await request
      .get("/api/analytics/hours?locationId=loc_1")
      .set("Authorization", `Bearer ${adminToken}`);

    const call = vi.mocked(prisma.shiftAssignment.findMany).mock.calls[0]![0];
    expect(call?.where?.shift).toMatchObject({ locationId: "loc_1" });
  });

  it("returns null hoursDelta for staff with no desiredHoursPerWeek", async () => {
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([
      {
        userId: "user_staff_2",
        user: { id: "user_staff_2", name: "Bob", desiredHoursPerWeek: null },
        shift: {
          id: "shift_2",
          startTime: shiftStart,
          endTime: shiftEnd,
          isPremium: true,
          location: { name: "Uptown" },
        },
      },
    ] as never);

    const res = await request
      .get("/api/analytics/hours")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].hoursDelta).toBeNull();
    expect(res.body.data[0].premiumShiftCount).toBe(1);
  });
});
