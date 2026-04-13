/**
 * Integration tests — Audit routes
 *
 * GET /api/audit         — list audit logs (admin/manager)
 * GET /api/audit/export  — export CSV (admin only)
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/shared/lib/prisma.js";
import {
  request,
  adminToken,
  managerToken,
  staffToken,
} from "@/shared/tests/helpers.js";

const MOCK_LOG = {
  id: "audit_1",
  entityType: "Shift",
  entityId: "shift_1",
  action: "published",
  before: null,
  after: { status: "PUBLISHED" },
  performedBy: "user_admin",
  performer: { id: "user_admin", name: "Admin User" },
  shiftId: "shift_1",
  locationId: "loc_1",
  performedAt: new Date("2026-04-10T10:00:00Z"),
};

describe("GET /api/audit", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/audit");
    expect(res.status).toBe(401);
  });

  it("returns 403 for STAFF role", async () => {
    const res = await request
      .get("/api/audit")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  it("returns paginated audit logs for ADMIN", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([MOCK_LOG] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1);

    const res = await request
      .get("/api/audit")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ entityType: "Shift", action: "published" }),
      ]),
      total: 1,
      page: 1,
      hasMore: false,
    });
  });

  it("returns paginated audit logs for MANAGER", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([MOCK_LOG] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1);

    const res = await request
      .get("/api/audit")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
  });

  it("passes locationId filter to Prisma", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0);

    await request
      .get("/api/audit?locationId=loc_1")
      .set("Authorization", `Bearer ${adminToken}`);

    const findManyCall = vi.mocked(prisma.auditLog.findMany).mock.calls[0]![0];
    expect(findManyCall?.where).toMatchObject({ locationId: "loc_1" });
  });

  it("passes entityType filter to Prisma", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0);

    await request
      .get("/api/audit?entityType=Shift")
      .set("Authorization", `Bearer ${adminToken}`);

    const findManyCall = vi.mocked(prisma.auditLog.findMany).mock.calls[0]![0];
    expect(findManyCall?.where).toMatchObject({ entityType: "Shift" });
  });

  it("passes date range filters to Prisma", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0);

    await request
      .get("/api/audit?startDate=2026-04-01&endDate=2026-04-30")
      .set("Authorization", `Bearer ${adminToken}`);

    const findManyCall = vi.mocked(prisma.auditLog.findMany).mock.calls[0]![0];
    expect(findManyCall?.where).toMatchObject({
      performedAt: {
        gte: new Date("2026-04-01"),
        lte: new Date("2026-04-30"),
      },
    });
  });

  it("respects page and pageSize query params", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(100);

    const res = await request
      .get("/api/audit?page=2&pageSize=10")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(2);
    expect(res.body.data.pageSize).toBe(10);

    const findManyCall = vi.mocked(prisma.auditLog.findMany).mock.calls[0]![0];
    expect(findManyCall?.skip).toBe(10); // (page 2 - 1) * 10
    expect(findManyCall?.take).toBe(10);
  });

  it("includes performerName in response items", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([MOCK_LOG] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1);

    const res = await request
      .get("/api/audit")
      .set("Authorization", `Bearer ${adminToken}`);

    const item = res.body.data.items[0];
    expect(item.performerName).toBe("Admin User");
    expect(item.performedAt).toBe("2026-04-10T10:00:00.000Z");
  });
});

describe("GET /api/audit/export", () => {
  it("returns 403 for MANAGER (admin-only endpoint)", async () => {
    const res = await request
      .get("/api/audit/export")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 for STAFF", async () => {
    const res = await request
      .get("/api/audit/export")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  it("returns CSV content for ADMIN", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([MOCK_LOG] as never);

    const res = await request
      .get("/api/audit/export")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.text).toContain("id,entityType,entityId,action");
    expect(res.text).toContain("audit_1");
    expect(res.text).toContain("published");
  });

  it("includes date range in the filename when provided", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

    const res = await request
      .get("/api/audit/export?startDate=2026-04-01&endDate=2026-04-30")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.headers["content-disposition"]).toContain("2026-04-01");
    expect(res.headers["content-disposition"]).toContain("2026-04-30");
  });
});
