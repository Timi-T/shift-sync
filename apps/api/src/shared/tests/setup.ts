/**
 * Vitest global test setup for apps/api.
 *
 * - Mocks the Prisma client so unit tests don't hit a real database.
 * - Mocks Redis so lock tests don't need a running Redis instance.
 * - Integration tests import a real PrismaClient pointed at a TEST_DATABASE_URL.
 */

import { vi, beforeEach, afterEach } from "vitest";

// ── Mock Prisma for unit tests ─────────────────────────────────────────────
// Integration tests that need a real DB should un-mock in their own file.
vi.mock("@/shared/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    location: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    skill: { findUnique: vi.fn(), findMany: vi.fn() },
    shift: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    shiftAssignment: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    swapRequest: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    availabilityWindow: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    locationManager: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    locationCertification: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    userSkill: { createMany: vi.fn(), deleteMany: vi.fn() },
    notification: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    notificationPreference: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    managerOverride: { create: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

// ── Mock Redis ─────────────────────────────────────────────────────────────
vi.mock("@/shared/lib/redis.js", () => ({
  withAssignmentLock: vi.fn((_userId: string, fn: () => unknown) => fn()),
  acquireAssignmentLock: vi.fn(async () => true),
  releaseAssignmentLock: vi.fn(async () => {}),
  getRedis: vi.fn(),
}));

// ── Mock Socket service ────────────────────────────────────────────────────
vi.mock("@/shared/services/socket.service.js", () => ({
  broadcastToLocation: vi.fn(),
  emitToUser: vi.fn(),
  emitToUsers: vi.fn(),
  broadcastConflict: vi.fn(),
  setSocketServer: vi.fn(),
}));

// ── Mock Notification service ──────────────────────────────────────────────
vi.mock("@/features/notifications/notification.service.js", () => ({
  createNotification: vi.fn(),
  createNotifications: vi.fn(),
  notifyShiftPublished: vi.fn(),
  notifyShiftAssigned: vi.fn(),
  notifyShiftChanged: vi.fn(),
  notifySwapRequested: vi.fn(),
  notifyDropAvailable: vi.fn(),
  notifySwapOutcome: vi.fn(),
  notifyManagerSwapPending: vi.fn(),
  notifyOvertimeWarning: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
