/**
 * Shifts controller.
 *
 * GET    /api/shifts                    — list shifts (filterable by location, week, status)
 * POST   /api/shifts                    — create a shift (manager/admin)
 * GET    /api/shifts/:id                — get single shift with assignments
 * PUT    /api/shifts/:id                — update a shift (before cutoff)
 * DELETE /api/shifts/:id                — cancel a shift
 * POST   /api/shifts/:id/publish        — publish a shift (or a whole week)
 * GET    /api/shifts/:id/audit          — audit history for a shift
 * GET    /api/shifts/on-duty            — currently active shifts (live dashboard)
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok, created, noContent } from "@/shared/lib/response.js";
import { NotFoundError, ForbiddenOperationError } from "@/shared/lib/errors.js";
import { isPremiumShift } from "@/shared/services/timezone.service.js";
import { broadcastToLocation, emitToUsers } from "@/shared/services/socket.service.js";
import { notifyShiftPublished, notifyShiftChanged } from "@/features/notifications/notification.service.js";
import type { CreateShiftInput, ShiftStatus, UpdateShiftInput } from "@shift-sync/shared";

// ---------------------------------------------------------------------------
// Edit cutoff guard
// ---------------------------------------------------------------------------

const CUTOFF_HOURS = parseInt(process.env.SCHEDULE_EDIT_CUTOFF_HOURS ?? "48", 10);

function isEditAllowed(shift: { startTime: Date; status: string }): boolean {
  if (shift.status === "DRAFT") return true;
  const hoursUntilShift =
    (shift.startTime.getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursUntilShift >= CUTOFF_HOURS;
}

// ---------------------------------------------------------------------------
// Authorization helpers — managers can only touch their locations
// ---------------------------------------------------------------------------

async function assertManagerAccess(
  locationId: string,
  userId: string,
  role: string,
): Promise<void> {
  if (role === "ADMIN") return;
  const access = await prisma.locationManager.findUnique({
    where: { userId_locationId: { userId, locationId } },
  });
  if (!access) {
    throw new ForbiddenOperationError(
      "You are not assigned as a manager of this location",
    );
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export const shiftsController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const locationId = req.query.locationId as string | undefined;
      const weekStart = req.query.weekStart as string | undefined;
      const status = req.query.status as ShiftStatus | undefined;
      const user = req.user!;

      let locationFilter: string[] | undefined;

      if (user.role === "MANAGER") {
        const managed = await prisma.locationManager.findMany({
          where: { userId: user.sub },
          select: { locationId: true },
        });
        locationFilter = managed.map((m) => m.locationId);
        if (locationId && locationFilter.includes(locationId)) {
          locationFilter = [locationId];
        } else if (locationId) {
          locationFilter = [];
        }
      } else if (user.role === "STAFF") {
        const certs = await prisma.locationCertification.findMany({
          where: { userId: user.sub },
          select: { locationId: true },
        });
        locationFilter = certs.map((c) => c.locationId);
        if (locationId && locationFilter.includes(locationId)) {
          locationFilter = [locationId];
        } else if (locationId) {
          locationFilter = [];
        }
      }

      const weekFilter = weekStart
        ? {
          startTime: { gte: new Date(weekStart) },
          endTime: {
            lte: new Date(
              new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000,
            ),
          },
        }
        : {};

      const statusFilter: { status?: { not?: ShiftStatus } | ShiftStatus } =
        user.role === "STAFF"
          ? { status: "PUBLISHED" }
          : status
            ? { status }
            : {};

      const shifts = await prisma.shift.findMany({
        where: {
          ...(locationFilter
            ? { locationId: { in: locationFilter } }
            : locationId
              ? { locationId }
              : {}),
          ...weekFilter,
          ...statusFilter,
        },
        include: {
          location: { select: { id: true, name: true, timezone: true } },
          skill: { select: { id: true, name: true } },
          assignments: {
            where: { status: { not: "CANCELLED" } },
            include: {
              user: {
                select: {
                  id: true, name: true, email: true, role: true, desiredHoursPerWeek: true,
                },
              },
            },
          },
        },
        orderBy: { startTime: "asc" },
      });

      ok(res, shifts.map((s) => ({
        ...s,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        publishedAt: s.publishedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        openSlots: s.headcount - s.assignments.filter((a) => a.status === "CONFIRMED").length,
        assignments: s.assignments.map((a) => ({
          ...a,
          assignedAt: a.assignedAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      })));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const shift = await prisma.shift.findUnique({
        where: { id },
        include: {
          location: { select: { id: true, name: true, timezone: true } },
          skill: { select: { id: true, name: true } },
          assignments: {
            where: { status: { not: "CANCELLED" } },
            include: {
              user: {
                select: {
                  id: true, name: true, email: true, role: true, desiredHoursPerWeek: true,
                },
              },
            },
          },
        },
      });

      if (!shift) throw new NotFoundError("Shift", id);

      ok(res, {
        ...shift,
        startTime: shift.startTime.toISOString(),
        endTime: shift.endTime.toISOString(),
        publishedAt: shift.publishedAt?.toISOString() ?? null,
        createdAt: shift.createdAt.toISOString(),
        updatedAt: shift.updatedAt.toISOString(),
        openSlots: shift.headcount - shift.assignments.filter((a) => a.status === "CONFIRMED").length,
        assignments: shift.assignments.map((a) => ({
          ...a,
          assignedAt: a.assignedAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateShiftInput;
      const user = req.user!;

      await assertManagerAccess(body.locationId, user.sub, user.role);

      const [location, skill] = await Promise.all([
        prisma.location.findUnique({ where: { id: body.locationId } }),
        prisma.skill.findUnique({ where: { id: body.skillId } }),
      ]);

      if (!location) throw new NotFoundError("Location", body.locationId);
      if (!skill) throw new NotFoundError("Skill", body.skillId);

      const startTime = new Date(body.startTime);
      const endTime = new Date(body.endTime);
      const isPremium = isPremiumShift(startTime, location.timezone);

      const shift = await prisma.$transaction(async (tx) => {
        const newShift = await tx.shift.create({
          data: {
            locationId: body.locationId,
            skillId: body.skillId,
            startTime,
            endTime,
            headcount: body.headcount,
            isPremium,
            createdBy: user.sub,
          },
          include: {
            location: { select: { id: true, name: true, timezone: true } },
            skill: { select: { id: true, name: true } },
          },
        });

        await tx.auditLog.create({
          data: {
            entityType: "Shift",
            entityId: newShift.id,
            action: "created",
            after: { locationId: body.locationId, skillId: body.skillId, startTime: body.startTime, endTime: body.endTime, headcount: body.headcount },
            performedBy: user.sub,
            shiftId: newShift.id,
            locationId: body.locationId,
          },
        });

        return newShift;
      });

      broadcastToLocation(body.locationId, "SHIFT_CREATED", {
        ...shift,
        startTime: shift.startTime.toISOString(),
        endTime: shift.endTime.toISOString(),
      });

      created(res, {
        ...shift,
        startTime: shift.startTime.toISOString(),
        endTime: shift.endTime.toISOString(),
        publishedAt: null,
        createdAt: shift.createdAt.toISOString(),
        updatedAt: shift.updatedAt.toISOString(),
        openSlots: shift.headcount,
        assignments: [],
      });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as UpdateShiftInput;
      const user = req.user!;
      const id = req.params.id as string;

      const shift = await prisma.shift.findUnique({
        where: { id },
        include: { location: true },
      });

      if (!shift) throw new NotFoundError("Shift", id);

      await assertManagerAccess(shift.locationId, user.sub, user.role);

      if (!isEditAllowed(shift)) {
        throw new ForbiddenOperationError(
          `This shift starts in less than ${CUTOFF_HOURS} hours and can no longer be edited.`,
        );
      }

      const before = {
        startTime: shift.startTime.toISOString(),
        endTime: shift.endTime.toISOString(),
        headcount: shift.headcount,
        skillId: shift.skillId,
      };

      const startTime = body.startTime ? new Date(body.startTime) : shift.startTime;
      const endTime = body.endTime ? new Date(body.endTime) : shift.endTime;
      const isPremium = isPremiumShift(startTime, shift.location.timezone);

      const updated = await prisma.$transaction(async (tx) => {
        const updatedShift = await tx.shift.update({
          where: { id },
          data: {
            ...(body.startTime ? { startTime } : {}),
            ...(body.endTime ? { endTime } : {}),
            ...(body.headcount ? { headcount: body.headcount } : {}),
            ...(body.skillId ? { skillId: body.skillId } : {}),
            isPremium,
          },
          include: {
            location: { select: { id: true, name: true, timezone: true } },
            skill: { select: { id: true, name: true } },
            assignments: {
              where: { status: { not: "CANCELLED" } },
              include: {
                user: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } },
              },
            },
          },
        });

        const pendingSwaps = await tx.swapRequest.findMany({
          where: {
            shiftId: id,
            status: { in: ["PENDING_ACCEPTANCE", "PENDING_MANAGER"] },
          },
          select: { id: true, initiatorId: true, receiverId: true },
        });

        if (pendingSwaps.length > 0) {
          await tx.swapRequest.updateMany({
            where: { id: { in: pendingSwaps.map((s) => s.id) } },
            data: { status: "CANCELLED" },
          });
        }

        await tx.auditLog.create({
          data: {
            entityType: "Shift",
            entityId: id,
            action: "updated",
            before,
            after: {
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              headcount: body.headcount ?? shift.headcount,
              skillId: body.skillId ?? shift.skillId,
            },
            performedBy: user.sub,
            shiftId: id,
            locationId: shift.locationId,
          },
        });

        return { updatedShift, pendingSwaps };
      });

      const assignedUserIds = updated.updatedShift.assignments.map((a) => a.userId);
      if (assignedUserIds.length > 0) {
        await Promise.all(
          assignedUserIds.map((uid) =>
            notifyShiftChanged(uid, shift.location.name, id, "Shift details were modified"),
          ),
        );
      }

      for (const swap of updated.pendingSwaps) {
        const notifyIds = [swap.initiatorId, swap.receiverId].filter(Boolean) as string[];
        emitToUsers(notifyIds, "SWAP_UPDATED", {
          swapRequestId: swap.id,
          status: "CANCELLED",
          reason: "The shift was modified by a manager",
        });
      }

      broadcastToLocation(shift.locationId, "SHIFT_UPDATED", { shiftId: id });

      ok(res, {
        ...updated.updatedShift,
        startTime: updated.updatedShift.startTime.toISOString(),
        endTime: updated.updatedShift.endTime.toISOString(),
        publishedAt: updated.updatedShift.publishedAt?.toISOString() ?? null,
        createdAt: updated.updatedShift.createdAt.toISOString(),
        updatedAt: updated.updatedShift.updatedAt.toISOString(),
        openSlots:
          updated.updatedShift.headcount -
          updated.updatedShift.assignments.filter((a) => a.status === "CONFIRMED").length,
        assignments: updated.updatedShift.assignments.map((a) => ({
          ...a,
          assignedAt: a.assignedAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },

  async publish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { weekStart, locationId } = req.body as { weekStart?: string; locationId?: string };
      const shiftId = req.params.id as string | undefined;

      if (shiftId) {
        const shift = await prisma.shift.findUnique({
          where: { id: shiftId },
          include: { location: true },
        });
        if (!shift) throw new NotFoundError("Shift", shiftId);

        await assertManagerAccess(shift.locationId, user.sub, user.role);

        if (shift.status !== "DRAFT") {
          throw new ForbiddenOperationError("Only DRAFT shifts can be published");
        }

        const updated = await prisma.$transaction(async (tx) => {
          const pub = await tx.shift.update({
            where: { id: shiftId },
            data: { status: "PUBLISHED", publishedAt: new Date() },
          });

          await tx.auditLog.create({
            data: {
              entityType: "Shift", entityId: shiftId,
              action: "published",
              before: { status: "DRAFT" }, after: { status: "PUBLISHED" },
              performedBy: user.sub, shiftId, locationId: shift.locationId,
            },
          });

          return pub;
        });

        const assignments = await prisma.shiftAssignment.findMany({
          where: { shiftId, status: { not: "CANCELLED" } },
          select: { userId: true },
        });
        const userIds = assignments.map((a) => a.userId);
        if (userIds.length > 0) {
          await notifyShiftPublished(userIds, shift.location.name, shift.startTime.toISOString().slice(0, 10));
        }

        broadcastToLocation(shift.locationId, "SHIFT_PUBLISHED", { shiftId });

        ok(res, { ...updated, publishedAt: updated.publishedAt?.toISOString() });
        return;
      }

      if (!weekStart || !locationId) {
        throw new Error("weekStart and locationId are required to publish a week");
      }

      const weekStartDate = new Date(weekStart);
      const weekEndDate = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      await assertManagerAccess(locationId, user.sub, user.role);

      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location) throw new NotFoundError("Location", locationId);

      const draftShifts = await prisma.shift.findMany({
        where: { locationId, status: "DRAFT", startTime: { gte: weekStartDate, lt: weekEndDate } },
        select: { id: true },
      });

      const shiftIds = draftShifts.map((s) => s.id);

      await prisma.shift.updateMany({
        where: { id: { in: shiftIds } },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });

      const assignments = await prisma.shiftAssignment.findMany({
        where: { shiftId: { in: shiftIds }, status: { not: "CANCELLED" } },
        select: { userId: true },
      });
      const uniqueUserIds = [...new Set(assignments.map((a) => a.userId))];
      if (uniqueUserIds.length > 0) {
        await notifyShiftPublished(uniqueUserIds, location.name, weekStart);
      }

      broadcastToLocation(locationId, "SHIFT_PUBLISHED", { weekStart, locationId, count: shiftIds.length });

      ok(res, { published: shiftIds.length, shiftIds });
    } catch (err) {
      next(err);
    }
  },

  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const id = req.params.id as string;

      const shift = await prisma.shift.findUnique({
        where: { id },
        include: {
          location: true,
          assignments: { where: { status: { not: "CANCELLED" } }, select: { userId: true } },
        },
      });

      if (!shift) throw new NotFoundError("Shift", id);
      await assertManagerAccess(shift.locationId, user.sub, user.role);

      await prisma.$transaction(async (tx) => {
        await tx.shift.update({ where: { id }, data: { status: "CANCELLED" } });
        await tx.shiftAssignment.updateMany({
          where: { shiftId: id, status: { not: "CANCELLED" } },
          data: { status: "CANCELLED" },
        });
        await tx.swapRequest.updateMany({
          where: { shiftId: id, status: { in: ["PENDING_ACCEPTANCE", "PENDING_MANAGER"] } },
          data: { status: "CANCELLED" },
        });
        await tx.auditLog.create({
          data: {
            entityType: "Shift", entityId: id,
            action: "cancelled",
            before: { status: shift.status }, after: { status: "CANCELLED" },
            performedBy: user.sub, shiftId: id, locationId: shift.locationId,
          },
        });
      });

      const assignedUserIds = shift.assignments.map((a) => a.userId);
      if (assignedUserIds.length > 0) {
        await Promise.all(
          assignedUserIds.map((uid) =>
            notifyShiftChanged(uid, shift.location.name, id, "Shift was cancelled"),
          ),
        );
      }

      broadcastToLocation(shift.locationId, "SHIFT_CANCELLED", { shiftId: id });

      noContent(res);
    } catch (err) {
      next(err);
    }
  },

  async getAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.id as string;
      const logs = await prisma.auditLog.findMany({
        where: { shiftId },
        include: { performer: { select: { id: true, name: true } } },
        orderBy: { performedAt: "desc" },
      });

      ok(res, logs.map((l) => ({
        ...l,
        performerName: l.performer.name,
        performedAt: l.performedAt.toISOString(),
      })));
    } catch (err) {
      next(err);
    }
  },

  async onDuty(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const now = new Date();

      const activeShifts = await prisma.shift.findMany({
        where: {
          status: "PUBLISHED",
          startTime: { lte: now },
          endTime: { gte: now },
        },
        include: {
          location: { select: { id: true, name: true, timezone: true } },
          skill: { select: { id: true, name: true } },
          assignments: {
            where: { status: "CONFIRMED" },
            include: {
              user: { select: { id: true, name: true, role: true } },
            },
          },
        },
      });

      ok(res, activeShifts.map((s) => ({
        ...s,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        assignments: s.assignments.map((a) => ({
          ...a,
          assignedAt: a.assignedAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      })));
    } catch (err) {
      next(err);
    }
  },
};
