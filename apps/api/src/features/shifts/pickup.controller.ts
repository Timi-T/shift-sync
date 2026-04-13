/**
 * Shift Pickup controller.
 *
 * POST   /api/shifts/:shiftId/pickup          — staff requests to pick up a shift
 * GET    /api/shifts/:shiftId/pickup          — manager lists pickup requests for a shift
 * GET    /api/shifts/pickup-requests          — manager lists all pending pickup requests
 * POST   /api/shifts/:shiftId/pickup/:reqId/approve — manager approves → creates assignment
 * POST   /api/shifts/:shiftId/pickup/:reqId/reject  — manager rejects
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok, created } from "@/shared/lib/response.js";
import {
  NotFoundError,
  ForbiddenOperationError,
  ConflictError,
} from "@/shared/lib/errors.js";
import { createNotification } from "@/features/notifications/notification.service.js";
import { emitToUsers } from "@/shared/services/socket.service.js";

async function assertManagerAccess(
  locationId: string,
  userId: string,
  role: string,
): Promise<void> {
  if (role === "ADMIN") return;
  const access = await prisma.locationManager.findUnique({
    where: { userId_locationId: { userId, locationId } },
  });
  if (!access)
    throw new ForbiddenOperationError(
      "You are not a manager of this location",
    );
}

export const pickupController = {
  /**
   * Staff requests to pick up an open shift.
   * Validates:
   *  - Shift exists and is PUBLISHED
   *  - Shift has open slots
   *  - Staff is certified at the location and has the required skill
   *  - No duplicate request
   */
  async request(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.shiftId as string;
      const staff = req.user!;

      const shift = await prisma.shift.findUnique({
        where: { id: shiftId },
        include: {
          location: true,
          skill: true,
          assignments: { where: { status: "CONFIRMED" } },
        },
      });

      if (!shift) throw new NotFoundError("Shift", shiftId);

      if (shift.status !== "PUBLISHED") {
        throw new ForbiddenOperationError("Only published shifts can be picked up");
      }

      const openSlots =
        shift.headcount - shift.assignments.length;
      if (openSlots <= 0) {
        throw new ForbiddenOperationError("This shift is already fully staffed");
      }

      // Check location certification
      const certified = await prisma.locationCertification.findUnique({
        where: {
          userId_locationId: { userId: staff.sub, locationId: shift.locationId },
        },
      });
      if (!certified) {
        throw new ForbiddenOperationError(
          "You are not certified to work at this location",
        );
      }

      // Check skill
      const hasSkill = await prisma.userSkill.findUnique({
        where: { userId_skillId: { userId: staff.sub, skillId: shift.skillId } },
      });
      if (!hasSkill) {
        throw new ForbiddenOperationError(
          `You do not have the required skill: ${shift.skill.name}`,
        );
      }

      // Check not already assigned
      const alreadyAssigned = await prisma.shiftAssignment.findUnique({
        where: { shiftId_userId: { shiftId, userId: staff.sub } },
      });
      if (alreadyAssigned) {
        throw new ConflictError("You are already assigned to this shift");
      }

      // Create or find existing request
      const existing = await prisma.shiftPickupRequest.findUnique({
        where: { shiftId_userId: { shiftId, userId: staff.sub } },
      });
      if (existing) {
        if (existing.status === "PENDING") {
          throw new ConflictError("You already have a pending request for this shift");
        }
        // If previously rejected, allow re-request by updating
        const updated = await prisma.shiftPickupRequest.update({
          where: { id: existing.id },
          data: { status: "PENDING", managerNote: null, resolvedBy: null },
        });

        // Notify managers
        await notifyManagers(shiftId, shift.locationId, staff.name, shift);

        ok(res, updated);
        return;
      }

      const pickupReq = await prisma.shiftPickupRequest.create({
        data: { shiftId, userId: staff.sub },
        include: { shift: { include: { location: true, skill: true } }, user: true },
      });

      // Notify managers of this location
      await notifyManagers(shiftId, shift.locationId, staff.name, shift);

      created(res, pickupReq);
    } catch (err) {
      next(err);
    }
  },

  /** List all pending pickup requests across all shifts (manager/admin only). */
  async listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const manager = req.user!;

      let locationFilter: string[] | undefined;
      if (manager.role === "MANAGER") {
        const managed = await prisma.locationManager.findMany({
          where: { userId: manager.sub },
          select: { locationId: true },
        });
        locationFilter = managed.map((m) => m.locationId);
      }

      const requests = await prisma.shiftPickupRequest.findMany({
        where: {
          status: "PENDING",
          ...(locationFilter
            ? { shift: { locationId: { in: locationFilter } } }
            : {}),
        },
        include: {
          shift: { include: { location: true, skill: true } },
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      ok(res, requests);
    } catch (err) {
      next(err);
    }
  },

  /** List pickup requests for a specific shift (manager/admin only). */
  async listForShift(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.shiftId as string;
      const manager = req.user!;

      const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
      if (!shift) throw new NotFoundError("Shift", shiftId);
      await assertManagerAccess(shift.locationId, manager.sub, manager.role);

      const requests = await prisma.shiftPickupRequest.findMany({
        where: { shiftId },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      ok(res, requests);
    } catch (err) {
      next(err);
    }
  },

  /** Manager approves a pickup request → creates a ShiftAssignment. */
  async approve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.shiftId as string;
      const reqId = req.params.reqId as string;
      const manager = req.user!;
      const { managerNote } = req.body as { managerNote?: string };

      const pickupReq = await prisma.shiftPickupRequest.findUnique({
        where: { id: reqId },
        include: {
          shift: { include: { location: true, skill: true, assignments: { where: { status: "CONFIRMED" } } } },
          user: true,
        },
      });

      if (!pickupReq || pickupReq.shiftId !== shiftId)
        throw new NotFoundError("PickupRequest", reqId);

      if (pickupReq.status !== "PENDING")
        throw new ForbiddenOperationError("This request has already been resolved");

      await assertManagerAccess(
        pickupReq.shift.locationId,
        manager.sub,
        manager.role,
      );

      // Check there's still a slot open
      const openSlots = pickupReq.shift.headcount - pickupReq.shift.assignments.length;
      if (openSlots <= 0) {
        throw new ForbiddenOperationError(
          "The shift is now fully staffed — no open slots remain",
        );
      }

      // Transactionally approve request + create assignment
      const [updated] = await prisma.$transaction([
        prisma.shiftPickupRequest.update({
          where: { id: reqId },
          data: { status: "APPROVED", managerNote: managerNote ?? null, resolvedBy: manager.sub },
        }),
        prisma.shiftAssignment.create({
          data: { shiftId, userId: pickupReq.userId, assignedBy: manager.sub },
        }),
      ]);

      // Notify the staff member
      await createNotification({
        userId: pickupReq.userId,
        type: "SHIFT_ASSIGNED",
        title: "Shift pickup approved!",
        message: `Your request to pick up the ${pickupReq.shift.skill.name} shift at ${pickupReq.shift.location.name} has been approved.`,
        data: { shiftId },
      });

      emitToUsers([pickupReq.userId], "SHIFT_UPDATED", { shiftId });

      ok(res, { message: "Pickup request approved and assignment created", request: updated });
    } catch (err) {
      next(err);
    }
  },

  /** Manager rejects a pickup request. */
  async reject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.shiftId as string;
      const reqId = req.params.reqId as string;
      const manager = req.user!;
      const { managerNote } = req.body as { managerNote?: string };

      const pickupReq = await prisma.shiftPickupRequest.findUnique({
        where: { id: reqId },
        include: {
          shift: { include: { location: true, skill: true } },
          user: true,
        },
      });

      if (!pickupReq || pickupReq.shiftId !== shiftId)
        throw new NotFoundError("PickupRequest", reqId);

      if (pickupReq.status !== "PENDING")
        throw new ForbiddenOperationError("This request has already been resolved");

      await assertManagerAccess(
        pickupReq.shift.locationId,
        manager.sub,
        manager.role,
      );

      const updated = await prisma.shiftPickupRequest.update({
        where: { id: reqId },
        data: { status: "REJECTED", managerNote: managerNote ?? null, resolvedBy: manager.sub },
      });

      // Notify the staff member
      await createNotification({
        userId: pickupReq.userId,
        type: "SWAP_REJECTED",
        title: "Shift pickup declined",
        message: `Your request to pick up the ${pickupReq.shift.skill.name} shift at ${pickupReq.shift.location.name} was not approved.${managerNote ? ` Note: ${managerNote}` : ""}`,
        data: { shiftId },
      });

      ok(res, { message: "Pickup request rejected", request: updated });
    } catch (err) {
      next(err);
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function notifyManagers(
  shiftId: string,
  locationId: string,
  staffName: string,
  shift: { location: { name: string }; skill: { name: string }; startTime: Date },
): Promise<void> {
  const managers = await prisma.locationManager.findMany({
    where: { locationId },
    select: { userId: true },
  });

  // Also notify ADMINs
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  const recipientIds = [
    ...managers.map((m) => m.userId),
    ...admins.map((a) => a.id),
  ];

  const uniqueIds = [...new Set(recipientIds)];

  await Promise.all(
    uniqueIds.map((userId) =>
      createNotification({
        userId,
        type: "DROP_CLAIMED",
        title: "Shift pickup request",
        message: `${staffName} wants to pick up the ${shift.skill.name} shift at ${shift.location.name}.`,
        data: { shiftId, locationId },
      }),
    ),
  );

  emitToUsers(uniqueIds, "PICKUP_REQUESTED", { shiftId });
}
