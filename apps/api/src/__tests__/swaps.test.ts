/**
 * Integration tests — Swap & Drop Request routes
 *
 * POST   /api/swap-requests                  — create SWAP or DROP
 * GET    /api/swap-requests                  — list (role-scoped)
 * POST   /api/swap-requests/:id/accept       — receiver accepts SWAP
 * POST   /api/swap-requests/:id/cancel       — initiator cancels
 * POST   /api/swap-requests/:id/claim        — staff claims DROP
 * POST   /api/swap-requests/:id/approve      — manager approves
 * POST   /api/swap-requests/:id/reject       — manager rejects
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
const futureStart = new Date(now.getTime() + 72 * 60 * 60 * 1000);
const futureEnd = new Date(futureStart.getTime() + 8 * 60 * 60 * 1000);

// Valid CUID-format IDs (Zod cuid regex: /^c[^\s-]{8,}$/i)
const ASGN_ID = "caaaaaaaaaaaaaaa";
const RECV_ID = "cbbbbbbbbbbbbbb";
const STAFF_ID = "user_sarah"; // matches staffToken sub from helpers.ts

const MOCK_SHIFT = {
  id: "shift_1",
  locationId: "loc_1",
  skillId: "skill_1",
  startTime: futureStart,
  endTime: futureEnd,
  location: { id: "loc_1", name: "Downtown", timezone: "America/New_York" },
  skill: { id: "skill_1", name: "Barista" },
  assignments: [],
};

const MOCK_ASSIGNMENT = {
  id: ASGN_ID,
  userId: STAFF_ID,
  shiftId: "shift_1",
  status: "CONFIRMED",
  shift: MOCK_SHIFT,
  user: { id: STAFF_ID, name: "Sarah" },
};

const MOCK_SWAP = {
  id: "swap_1",
  type: "SWAP",
  assignmentId: ASGN_ID,
  initiatorId: STAFF_ID,
  receiverId: RECV_ID,
  shiftId: "shift_1",
  status: "PENDING_ACCEPTANCE",
  expiresAt: null,
  createdAt: now,
  updatedAt: now,
  shift: {
    ...MOCK_SHIFT,
    assignments: [],
  },
  initiator: { id: STAFF_ID, name: "Sarah", email: "sarah@example.com", role: "STAFF", desiredHoursPerWeek: 32 },
  receiver: { id: RECV_ID, name: "Bob", email: "bob@example.com", role: "STAFF", desiredHoursPerWeek: 32 },
};

// ---------------------------------------------------------------------------
// GET /api/swap-requests
// ---------------------------------------------------------------------------
describe("GET /api/swap-requests", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.get("/api/swap-requests");
    expect(res.status).toBe(401);
  });

  it("returns all swap requests for ADMIN", async () => {
    vi.mocked(prisma.swapRequest.findMany).mockResolvedValue([MOCK_SWAP] as never);

    const res = await request
      .get("/api/swap-requests")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: "swap_1", type: "SWAP" });
  });

  it("scopes STAFF to their own swap requests", async () => {
    vi.mocked(prisma.swapRequest.findMany).mockResolvedValue([]);

    await request
      .get("/api/swap-requests")
      .set("Authorization", `Bearer ${staffToken}`);

    const call = vi.mocked(prisma.swapRequest.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({
      OR: expect.arrayContaining([
        expect.objectContaining({ initiatorId: expect.any(String) }),
      ]),
    });
  });

  it("scopes MANAGER to their managed locations", async () => {
    vi.mocked(prisma.locationManager.findMany).mockResolvedValue([
      { locationId: "loc_1" },
    ] as never);
    vi.mocked(prisma.swapRequest.findMany).mockResolvedValue([]);

    await request
      .get("/api/swap-requests")
      .set("Authorization", `Bearer ${managerToken}`);

    const call = vi.mocked(prisma.swapRequest.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({
      shift: { locationId: { in: ["loc_1"] } },
    });
  });

  it("filters by status when provided", async () => {
    vi.mocked(prisma.swapRequest.findMany).mockResolvedValue([]);

    await request
      .get("/api/swap-requests?status=PENDING_MANAGER")
      .set("Authorization", `Bearer ${adminToken}`);

    const call = vi.mocked(prisma.swapRequest.findMany).mock.calls[0]![0];
    expect(call?.where).toMatchObject({ status: "PENDING_MANAGER" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/swap-requests (create)
// ---------------------------------------------------------------------------
describe("POST /api/swap-requests", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request.post("/api/swap-requests").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 when assignment does not exist", async () => {
    vi.mocked(prisma.shiftAssignment.findUnique).mockResolvedValue(null);

    const res = await request
      .post("/api/swap-requests")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "DROP", assignmentId: ASGN_ID }); // valid CUID, but mock returns null

    expect(res.status).toBe(404);
  });

  it("returns 403 when user tries to swap someone else's assignment", async () => {
    vi.mocked(prisma.shiftAssignment.findUnique).mockResolvedValue({
      ...MOCK_ASSIGNMENT,
      userId: "cotherotherotherother", // not the requesting staff user
    } as never);

    const res = await request
      .post("/api/swap-requests")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "DROP", assignmentId: ASGN_ID });

    expect(res.status).toBe(403);
  });

  it("returns 403 when pending swap limit is reached", async () => {
    vi.mocked(prisma.shiftAssignment.findUnique).mockResolvedValue(MOCK_ASSIGNMENT as never);
    vi.mocked(prisma.swapRequest.count).mockResolvedValue(3); // MAX_PENDING = 3

    const res = await request
      .post("/api/swap-requests")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "DROP", assignmentId: ASGN_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("pending");
  });

  it("creates DROP request successfully", async () => {
    vi.mocked(prisma.shiftAssignment.findUnique).mockResolvedValue(MOCK_ASSIGNMENT as never);
    vi.mocked(prisma.swapRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]); // no eligible staff to notify

    const createdSwap = { ...MOCK_SWAP, type: "DROP", receiverId: null };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        swapRequest: { create: vi.fn().mockResolvedValue(createdSwap) },
        shiftAssignment: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .post("/api/swap-requests")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "DROP", assignmentId: ASGN_ID });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it("returns 409/constraint error when SWAP receiver lacks skill", async () => {
    vi.mocked(prisma.shiftAssignment.findUnique).mockResolvedValue(MOCK_ASSIGNMENT as never);
    vi.mocked(prisma.swapRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: RECV_ID,
      name: "Bob",
      skills: [], // no matching skill
      locationCertifications: [{ locationId: "loc_1" }],
    } as never);

    const res = await request
      .post("/api/swap-requests")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "SWAP", assignmentId: ASGN_ID, receiverId: RECV_ID });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("SKILL_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// POST /api/swap-requests/:id/cancel
// ---------------------------------------------------------------------------
describe("POST /api/swap-requests/:id/cancel", () => {
  it("returns 404 when swap does not exist", async () => {
    vi.mocked(prisma.swapRequest.findUnique).mockResolvedValue(null);

    const res = await request
      .post("/api/swap-requests/nonexistent/cancel")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 403 when non-initiator tries to cancel", async () => {
    vi.mocked(prisma.swapRequest.findUnique).mockResolvedValue({
      ...MOCK_SWAP,
      initiatorId: "different_user",
      shift: { ...MOCK_SHIFT, location: MOCK_SHIFT.location },
    } as never);

    const res = await request
      .post("/api/swap-requests/swap_1/cancel")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  it("cancels the swap and restores assignment", async () => {
    vi.mocked(prisma.swapRequest.findUnique).mockResolvedValue({
      ...MOCK_SWAP,
      initiatorId: STAFF_ID, // matches staffToken sub ("user_sarah")
      shift: { ...MOCK_SHIFT, location: MOCK_SHIFT.location },
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        swapRequest: { update: vi.fn() },
        shiftAssignment: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .post("/api/swap-requests/swap_1/cancel")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain("cancelled");
  });
});

// ---------------------------------------------------------------------------
// POST /api/swap-requests/:id/approve
// ---------------------------------------------------------------------------
describe("POST /api/swap-requests/:id/approve", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .post("/api/swap-requests/swap_1/approve")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 when swap does not exist", async () => {
    vi.mocked(prisma.swapRequest.findUnique).mockResolvedValue(null);

    const res = await request
      .post("/api/swap-requests/nonexistent/approve")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 403 when swap is not PENDING_MANAGER", async () => {
    vi.mocked(prisma.swapRequest.findUnique).mockResolvedValue({
      ...MOCK_SWAP,
      status: "PENDING_ACCEPTANCE",
      shift: { ...MOCK_SHIFT, location: MOCK_SHIFT.location, skill: MOCK_SHIFT.skill },
      assignment: MOCK_ASSIGNMENT,
      initiator: { name: "Alice" },
      receiver: { name: "Bob" },
    } as never);

    const res = await request
      .post("/api/swap-requests/swap_1/approve")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
  });

  it("approves the swap and transfers assignment", async () => {
    vi.mocked(prisma.swapRequest.findUnique).mockResolvedValue({
      ...MOCK_SWAP,
      status: "PENDING_MANAGER",
      receiverId: "user_staff_2",
      shift: { ...MOCK_SHIFT, location: MOCK_SHIFT.location, skill: MOCK_SHIFT.skill },
      assignment: MOCK_ASSIGNMENT,
      initiator: { name: "Alice" },
      receiver: { name: "Bob" },
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        shiftAssignment: { update: vi.fn(), upsert: vi.fn() },
        swapRequest: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .post("/api/swap-requests/swap_1/approve")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ managerNote: "Approved for personal reasons" });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain("approved");
  });
});

// ---------------------------------------------------------------------------
// POST /api/swap-requests/:id/reject
// ---------------------------------------------------------------------------
describe("POST /api/swap-requests/:id/reject", () => {
  it("returns 403 for STAFF", async () => {
    const res = await request
      .post("/api/swap-requests/swap_1/reject")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects the swap and restores assignment", async () => {
    vi.mocked(prisma.swapRequest.findUnique).mockResolvedValue({
      ...MOCK_SWAP,
      status: "PENDING_MANAGER",
      shift: { ...MOCK_SHIFT, location: MOCK_SHIFT.location },
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        swapRequest: { update: vi.fn() },
        shiftAssignment: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never),
    );

    const res = await request
      .post("/api/swap-requests/swap_1/reject")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ managerNote: "Scheduling conflict" });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain("rejected");
  });
});
