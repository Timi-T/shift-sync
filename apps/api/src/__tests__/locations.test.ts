/**
 * Integration tests — Locations routes
 *
 * GET    /api/locations         — list (scoped by role)
 * POST   /api/locations         — create (admin only)
 * GET    /api/locations/:id     — get by ID
 * PUT    /api/locations/:id     — update (admin only)
 * GET    /api/locations/skills  — list all skills
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/shared/lib/prisma.js";
import {
  request,
  adminToken,
  managerToken,
  staffToken,
} from "@/shared/tests/helpers.js";

const MOCK_LOCATION = {
  id: "loc_1",
  name: "Downtown Branch",
  timezone: "America/New_York",
  address: "123 Main St, New York, NY",
  managers: [{ userId: "user_mgr_west" }],
};

const MOCK_SKILL = { id: "skill_1", name: "Barista" };

describe("GET /api/locations/skills", () => {
  it("requires authentication", async () => {
    const res = await request.get("/api/locations/skills");
    expect(res.status).toBe(401);
  });

  it("returns all skills", async () => {
    vi.mocked(prisma.skill.findMany).mockResolvedValue([MOCK_SKILL] as never);

    const res = await request
      .get("/api/locations/skills")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual([MOCK_SKILL]);
  });
});

describe("GET /api/locations", () => {
  it("requires authentication", async () => {
    const res = await request.get("/api/locations");
    expect(res.status).toBe(401);
  });

  it("returns all locations for ADMIN", async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValue([MOCK_LOCATION] as never);

    const res = await request
      .get("/api/locations")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: "loc_1", name: "Downtown Branch" });
  });

  it("scopes results to managed locations for MANAGER", async () => {
    vi.mocked(prisma.locationManager.findMany).mockResolvedValue([
      { locationId: "loc_1" },
    ] as never);
    vi.mocked(prisma.location.findMany).mockResolvedValue([MOCK_LOCATION] as never);

    const res = await request
      .get("/api/locations")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    // Manager's findMany should filter by their managed location IDs
    const findManyCall = vi.mocked(prisma.location.findMany).mock.calls[0]![0];
    expect(findManyCall?.where).toMatchObject({ id: { in: ["loc_1"] } });
  });
});

describe("POST /api/locations", () => {
  const validBody = {
    name: "Uptown Branch",
    timezone: "America/Chicago",
    address: "456 Oak Ave, Chicago, IL",
  };

  it("returns 403 for non-admin roles", async () => {
    const managerRes = await request
      .post("/api/locations")
      .set("Authorization", `Bearer ${managerToken}`)
      .send(validBody);
    expect(managerRes.status).toBe(403);

    const staffRes = await request
      .post("/api/locations")
      .set("Authorization", `Bearer ${staffToken}`)
      .send(validBody);
    expect(staffRes.status).toBe(403);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request
      .post("/api/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "X" }); // too short, missing timezone and address

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("creates a location and returns 201 for ADMIN", async () => {
    const created = { id: "loc_new", ...validBody };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        location: {
          create: vi.fn().mockResolvedValue(created),
        },
        locationManager: { createMany: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never);
    });

    const res = await request
      .post("/api/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({ name: validBody.name, timezone: validBody.timezone });
  });
});

describe("GET /api/locations/:id", () => {
  it("returns 404 when location does not exist", async () => {
    vi.mocked(prisma.location.findUnique).mockResolvedValue(null);

    const res = await request
      .get("/api/locations/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("returns the location when found", async () => {
    vi.mocked(prisma.location.findUnique).mockResolvedValue(MOCK_LOCATION as never);

    const res = await request
      .get("/api/locations/loc_1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: "loc_1", name: "Downtown Branch" });
  });
});

describe("PUT /api/locations/:id", () => {
  it("returns 403 for MANAGER", async () => {
    const res = await request
      .put("/api/locations/loc_1")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when location does not exist", async () => {
    vi.mocked(prisma.location.findUnique).mockResolvedValue(null);

    const res = await request
      .put("/api/locations/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Updated Name" });

    expect(res.status).toBe(404);
  });

  it("updates the location for ADMIN", async () => {
    const updated = { ...MOCK_LOCATION, name: "Updated Branch" };

    vi.mocked(prisma.location.findUnique).mockResolvedValue(MOCK_LOCATION as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        location: { update: vi.fn().mockResolvedValue(updated) },
        locationManager: { deleteMany: vi.fn(), createMany: vi.fn() },
        auditLog: { create: vi.fn() },
      } as never);
    });

    const res = await request
      .put("/api/locations/loc_1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Updated Branch" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Updated Branch" });
  });
});
