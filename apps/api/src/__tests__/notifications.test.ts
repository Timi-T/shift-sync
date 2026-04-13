/**
 * Integration tests — Notifications routes
 *
 * GET   /api/notifications                — list notifications
 * GET   /api/notifications/count          — unread count
 * POST  /api/notifications/read-all       — mark all as read
 * POST  /api/notifications/:id/read       — mark one as read
 * POST  /api/notifications/read           — bulk mark as read
 * PUT   /api/notifications/preferences    — update preferences
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/shared/lib/prisma.js";
import {
  request,
  adminToken,
  staffToken,
} from "@/shared/tests/helpers.js";

const now = new Date();

const MOCK_NOTIFICATION = {
  id: "notif_1",
  userId: "user_staff",
  type: "SWAP_REQUESTED",
  title: "New Swap Request",
  message: "Alice wants to swap with you",
  data: { swapRequestId: "swap_1" },
  read: false,
  readAt: null,
  createdAt: now,
};

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------
describe("GET /api/notifications", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("returns user notifications", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([MOCK_NOTIFICATION] as never);

    const res = await request
      .get("/api/notifications")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: "notif_1",
      type: "SWAP_REQUESTED",
      title: "New Swap Request",
      body: "Alice wants to swap with you", // mapped from message
      read: false,
    });
  });

  it("filters to unread-only when unreadOnly=true", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);

    await request
      .get("/api/notifications?unreadOnly=true")
      .set("Authorization", `Bearer ${staffToken}`);

    const call = vi.mocked(prisma.notification.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({ read: false });
  });
});

// ---------------------------------------------------------------------------
// GET /api/notifications/count
// ---------------------------------------------------------------------------
describe("GET /api/notifications/count", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/notifications/count");
    expect(res.status).toBe(401);
  });

  it("returns unread notification count", async () => {
    vi.mocked(prisma.notification.count).mockResolvedValue(5);

    const res = await request
      .get("/api/notifications/count")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ count: 5 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all
// ---------------------------------------------------------------------------
describe("POST /api/notifications/read-all", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.post("/api/notifications/read-all");
    expect(res.status).toBe(401);
  });

  it("marks all notifications as read", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 3 });

    const res = await request
      .post("/api/notifications/read-all")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 3 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/:id/read
// ---------------------------------------------------------------------------
describe("POST /api/notifications/:id/read", () => {
  it("marks a single notification as read", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 });

    const res = await request
      .post("/api/notifications/notif_1/read")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 1 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read (bulk)
// ---------------------------------------------------------------------------
describe("POST /api/notifications/read (bulk)", () => {
  it("marks multiple notifications as read", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 2 });

    const res = await request
      .post("/api/notifications/read")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ ids: ["notif_1", "notif_2"] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 2 });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/notifications/preferences
// ---------------------------------------------------------------------------
describe("PUT /api/notifications/preferences", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.put("/api/notifications/preferences").send({});
    expect(res.status).toBe(401);
  });

  it("updates notification preferences", async () => {
    const prefs = { userId: "user_staff", inApp: true, email: true };
    vi.mocked(prisma.notificationPreference.upsert).mockResolvedValue(prefs as never);

    const res = await request
      .put("/api/notifications/preferences")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ inApp: true, email: true });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ inApp: true, email: true });
  });

  it("allows ADMIN to update their preferences", async () => {
    const prefs = { userId: "user_admin", inApp: false, email: true };
    vi.mocked(prisma.notificationPreference.upsert).mockResolvedValue(prefs as never);

    const res = await request
      .put("/api/notifications/preferences")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ inApp: false, email: true });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ inApp: false, email: true });
  });
});
