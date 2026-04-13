/**
 * Swap & Drop Requests controller.
 *
 * POST   /api/swap-requests                  — create swap or drop request
 * GET    /api/swap-requests                  — list (filtered by status/location)
 * POST   /api/swap-requests/:id/accept       — receiver accepts a SWAP
 * POST   /api/swap-requests/:id/cancel       — initiator cancels before approval
 * POST   /api/swap-requests/:id/claim        — staff claims an open DROP
 * POST   /api/swap-requests/:id/approve      — manager approves
 * POST   /api/swap-requests/:id/reject       — manager rejects
 *
 * State machine:
 *   SWAP: PENDING_ACCEPTANCE → (receiver accepts) → PENDING_MANAGER → APPROVED | REJECTED
 *   DROP: PENDING_ACCEPTANCE → (anyone claims)    → PENDING_MANAGER → APPROVED | REJECTED
 *   Either: PENDING_* → (initiator cancels) → CANCELLED
 *   DROP:   PENDING_ACCEPTANCE → (no one claims before expiry) → EXPIRED (cron)
 */

import type { Request, Response, NextFunction } from "express";
import { addHours } from "date-fns";
import { prisma } from "@/shared/lib/prisma.js";
import { ok, created } from "@/shared/lib/response.js";
import { NotFoundError, ForbiddenOperationError, ConstraintError } from "@/shared/lib/errors.js";
import { checkConstraints } from "@/features/shifts/constraints.service.js";
import { broadcastToLocation, emitToUsers, emitToUser } from "@/shared/services/socket.service.js";
import {
  notifySwapRequested,
  notifyDropAvailable,
  notifySwapOutcome,
  notifyManagerSwapPending,
} from "@/features/notifications/notification.service.js";
import type { CreateSwapRequestInput, ApproveSwapInput, RejectSwapInput } from "@shift-sync/shared";

const MAX_PENDING = parseInt(process.env.MAX_PENDING_SWAP_REQUESTS ?? "3", 10);
const DROP_EXPIRY_HOURS = parseInt(process.env.DROP_REQUEST_EXPIRY_HOURS ?? "24", 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getManagerIdsForLocation(locationId: string): Promise<string[]> {
  const managers = await prisma.locationManager.findMany({
    where: { locationId },
    select: { userId: true },
  });
  return managers.map((m) => m.userId);
}

function serializeSwap(swap: Record<string, unknown>) {
  return {
    ...swap,
    expiresAt: swap.expiresAt instanceof Date ? swap.expiresAt.toISOString() : swap.expiresAt,
    createdAt: swap.createdAt instanceof Date ? swap.createdAt.toISOString() : swap.createdAt,
    updatedAt: swap.updatedAt instanceof Date ? swap.updatedAt.toISOString() : swap.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export const swapsController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const status = req.query.status as string | undefined;
      const locationId = req.query.locationId as string | undefined;

      // Scope: staff see only their own; managers see their locations; admin sees all
      const where: Record<string, unknown> = {};

      if (user.role === "STAFF") {
        where.OR = [{ initiatorId: user.sub }, { receiverId: user.sub }];
      } else if (user.role === "MANAGER") {
        const managed = await prisma.locationManager.findMany({
          where: { userId: user.sub },
          select: { locationId: true },
        });
        where.shift = { locationId: { in: managed.map((m) => m.locationId) } };
      }

      if (status) where.status = status;
      if (locationId && user.role !== "STAFF") {
        where.shift = { locationId };
      }

      const swaps = await prisma.swapRequest.findMany({
        where,
        include: {
          initiator: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } },
          receiver: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } },
          shift: {
            include: {
              location: { select: { id: true, name: true, timezone: true } },
              skill: { select: { id: true, name: true } },
              assignments: {
                where: { status: { not: "CANCELLED" } },
                include: { user: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      ok(res, swaps.map(serializeSwap));
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateSwapRequestInput;
      const user = req.user!;

      // Load the assignment being swapped/dropped
      const assignment = await prisma.shiftAssignment.findUnique({
        where: { id: body.assignmentId },
        include: {
          shift: {
            include: { location: true, skill: true },
          },
          user: true,
        },
      });

      if (!assignment) throw new NotFoundError("Assignment", body.assignmentId);

      // Only the assigned staff member can initiate
      if (assignment.userId !== user.sub) {
        throw new ForbiddenOperationError("You can only swap your own assignments");
      }

      if (assignment.status === "CANCELLED") {
        throw new ForbiddenOperationError("Cannot swap a cancelled assignment");
      }

      // Enforce max pending requests
      const pendingCount = await prisma.swapRequest.count({
        where: {
          initiatorId: user.sub,
          status: { in: ["PENDING_ACCEPTANCE", "PENDING_MANAGER"] },
        },
      });

      if (pendingCount >= MAX_PENDING) {
        throw new ForbiddenOperationError(
          `You already have ${pendingCount} pending swap/drop requests. Maximum is ${MAX_PENDING}. Resolve or cancel existing requests first.`,
        );
      }

      // For SWAP: validate the receiver exists, has the skill, and is certified
      if (body.type === "SWAP") {
        const receiver = await prisma.user.findUnique({
          where: { id: body.receiverId },
          include: {
            skills: true,
            locationCertifications: true,
          },
        });

        if (!receiver) throw new NotFoundError("User", body.receiverId);

        const hasSkill = receiver.skills.some(
          (s) => s.skillId === assignment.shift.skillId,
        );
        const isCertified = receiver.locationCertifications.some(
          (c) => c.locationId === assignment.shift.locationId,
        );

        if (!hasSkill) {
          throw new ConstraintError(
            `${receiver.name} does not have the "${assignment.shift.skill.name}" skill required for this shift`,
            "SKILL_MISMATCH",
          );
        }

        if (!isCertified) {
          throw new ConstraintError(
            `${receiver.name} is not certified to work at ${assignment.shift.location.name}`,
            "LOCATION_NOT_CERTIFIED",
          );
        }
      }

      const expiresAt =
        body.type === "DROP"
          ? addHours(assignment.shift.startTime, -DROP_EXPIRY_HOURS)
          : null;

      const swap = await prisma.$transaction(async (tx) => {
        const newSwap = await tx.swapRequest.create({
          data: {
            type: body.type,
            assignmentId: body.assignmentId,
            initiatorId: user.sub,
            receiverId: body.type === "SWAP" ? body.receiverId : null,
            shiftId: assignment.shiftId,
            status: "PENDING_ACCEPTANCE",
            expiresAt,
          },
          include: {
            initiator: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } },
            receiver: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } },
            shift: {
              include: {
                location: { select: { id: true, name: true, timezone: true } },
                skill: { select: { id: true, name: true } },
                assignments: {
                  where: { status: { not: "CANCELLED" } },
                  include: { user: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } } },
                },
              },
            },
          },
        });

        await tx.shiftAssignment.update({
          where: { id: body.assignmentId },
          data: { status: "PENDING_SWAP" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "SwapRequest", entityId: newSwap.id,
            action: "created",
            after: { type: body.type, status: "PENDING_ACCEPTANCE", initiatorId: user.sub },
            performedBy: user.sub,
            shiftId: assignment.shiftId,
            locationId: assignment.shift.locationId,
          },
        });

        return newSwap;
      });

      // Notifications
      if (body.type === "SWAP" && body.receiverId) {
        await notifySwapRequested(
          body.receiverId,
          user.name,
          assignment.shiftId,
          swap.id,
        );
      } else {
        // DROP — notify all eligible staff for the location
        const eligible = await prisma.user.findMany({
          where: {
            id: { not: user.sub },
            role: "STAFF",
            locationCertifications: { some: { locationId: assignment.shift.locationId } },
            skills: { some: { skillId: assignment.shift.skillId } },
          },
          select: { id: true },
        });

        if (eligible.length > 0) {
          const shiftStart = assignment.shift.startTime.toLocaleDateString();
          await notifyDropAvailable(
            eligible.map((e) => e.id),
            assignment.shiftId,
            assignment.shift.location.name,
            shiftStart,
          );
        }
      }

      emitToUsers(
        [user.sub, ...(body.type === "SWAP" ? [body.receiverId] : [])],
        "SWAP_CREATED",
        serializeSwap(swap as unknown as Record<string, unknown>),
      );

      created(res, serializeSwap(swap as unknown as Record<string, unknown>));
    } catch (err) {
      next(err);
    }
  },

  /**
   * Receiver accepts a SWAP request.
   * Constraint check: ensure the receiver doesn't violate rules by taking this shift.
   */
  async accept(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const id = req.params.id as string;
      const swap = await prisma.swapRequest.findUnique({
        where: { id },
        include: { shift: { include: { location: true } }, assignment: true },
      });

      if (!swap) throw new NotFoundError("SwapRequest", id);
      if (swap.receiverId !== user.sub) {
        throw new ForbiddenOperationError("Only the designated receiver can accept this swap");
      }
      if (swap.status !== "PENDING_ACCEPTANCE") {
        throw new ForbiddenOperationError(`Cannot accept a swap in '${swap.status}' status`);
      }

      // Constraint check for the receiver taking the initiator's shift
      const constraintResult = await checkConstraints(user.sub, swap.shiftId);
      if (!constraintResult.valid) {
        throw new ConstraintError(
          "Accepting this swap would violate scheduling constraints",
          "CONSTRAINT_VIOLATION",
          { violations: constraintResult.violations, suggestions: constraintResult.suggestions },
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        const upd = await tx.swapRequest.update({
          where: { id },
          data: { status: "PENDING_MANAGER" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "SwapRequest", entityId: id,
            action: "accepted",
            before: { status: "PENDING_ACCEPTANCE" }, after: { status: "PENDING_MANAGER" },
            performedBy: user.sub,
            shiftId: swap.shiftId, locationId: swap.shift.locationId,
          },
        });

        return upd;
      });

      // Notify managers that approval is needed
      const managerIds = await getManagerIdsForLocation(swap.shift.locationId);
      const initiator = await prisma.user.findUnique({ where: { id: swap.initiatorId }, select: { name: true } });
      await notifyManagerSwapPending(managerIds, initiator!.name, user.name, swap.shiftId, swap.id);

      emitToUsers([swap.initiatorId, user.sub], "SWAP_UPDATED", {
        swapRequestId: swap.id, status: "PENDING_MANAGER",
      });

      ok(res, serializeSwap(updated as unknown as Record<string, unknown>));
    } catch (err) {
      next(err);
    }
  },

  /**
   * Any eligible staff member claims an open DROP request.
   */
  async claim(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const id = req.params.id as string;
      const swap = await prisma.swapRequest.findUnique({
        where: { id },
        include: {
          shift: { include: { location: true, skill: true } },
          initiator: { select: { name: true } },
        },
      });

      if (!swap) throw new NotFoundError("SwapRequest", id);
      if (swap.type !== "DROP") throw new ForbiddenOperationError("Only DROP requests can be claimed");
      if (swap.status !== "PENDING_ACCEPTANCE") {
        throw new ForbiddenOperationError(`This drop request is no longer available (status: ${swap.status})`);
      }
      if (swap.expiresAt && swap.expiresAt < new Date()) {
        throw new ForbiddenOperationError("This drop request has expired");
      }
      if (swap.initiatorId === user.sub) {
        throw new ForbiddenOperationError("You cannot claim your own drop request");
      }

      // Verify the claimant has the skill and certification
      const claimant = await prisma.user.findUniqueOrThrow({
        where: { id: user.sub },
        include: { skills: true, locationCertifications: true },
      });

      if (!claimant.skills.some((s) => s.skillId === swap.shift.skillId)) {
        throw new ForbiddenOperationError(`You do not have the "${swap.shift.skill.name}" skill for this shift`);
      }
      if (!claimant.locationCertifications.some((c) => c.locationId === swap.shift.locationId)) {
        throw new ForbiddenOperationError(`You are not certified to work at ${swap.shift.location.name}`);
      }

      // Full constraint check for the claimant
      const constraintResult = await checkConstraints(user.sub, swap.shiftId);
      if (!constraintResult.valid) {
        throw new ConstraintError(
          "Claiming this shift would violate scheduling constraints",
          "CONSTRAINT_VIOLATION",
          { violations: constraintResult.violations, suggestions: constraintResult.suggestions },
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        const upd = await tx.swapRequest.update({
          where: { id },
          data: { status: "PENDING_MANAGER", receiverId: user.sub },
        });

        await tx.auditLog.create({
          data: {
            entityType: "SwapRequest", entityId: id,
            action: "claimed",
            before: { status: "PENDING_ACCEPTANCE", receiverId: null },
            after: { status: "PENDING_MANAGER", receiverId: user.sub },
            performedBy: user.sub,
            shiftId: swap.shiftId, locationId: swap.shift.locationId,
          },
        });

        return upd;
      });

      const managerIds = await getManagerIdsForLocation(swap.shift.locationId);
      await notifyManagerSwapPending(managerIds, swap.initiator.name, user.name, swap.shiftId, swap.id);

      emitToUser(swap.initiatorId, "SWAP_UPDATED", { swapRequestId: swap.id, status: "PENDING_MANAGER", claimedBy: user.name });

      ok(res, serializeSwap(updated as unknown as Record<string, unknown>));
    } catch (err) {
      next(err);
    }
  },

  /**
   * Initiator cancels before manager approval.
   * "Regret Swap" evaluation scenario.
   */
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const id = req.params.id as string;
      const swap = await prisma.swapRequest.findUnique({
        where: { id },
        include: { shift: { include: { location: true } } },
      });

      if (!swap) throw new NotFoundError("SwapRequest", id);
      if (swap.initiatorId !== user.sub) {
        throw new ForbiddenOperationError("Only the initiator can cancel a swap request");
      }
      if (!["PENDING_ACCEPTANCE", "PENDING_MANAGER"].includes(swap.status)) {
        throw new ForbiddenOperationError(`Cannot cancel a swap in '${swap.status}' status`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.swapRequest.update({
          where: { id },
          data: { status: "CANCELLED" },
        });

        // Restore the initiator's assignment to CONFIRMED
        await tx.shiftAssignment.update({
          where: { id: swap.assignmentId },
          data: { status: "CONFIRMED" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "SwapRequest", entityId: id,
            action: "cancelled",
            before: { status: swap.status }, after: { status: "CANCELLED" },
            performedBy: user.sub,
            shiftId: swap.shiftId, locationId: swap.shift.locationId,
          },
        });
      });

      await notifySwapOutcome(
        swap.initiatorId, swap.receiverId, "CANCELLED",
        swap.shiftId, swap.id,
      );

      const notifyIds = [swap.initiatorId, swap.receiverId].filter(Boolean) as string[];
      emitToUsers(notifyIds, "SWAP_UPDATED", { swapRequestId: swap.id, status: "CANCELLED" });

      ok(res, { message: "Swap request cancelled. Your original assignment is restored." });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Manager approves a PENDING_MANAGER swap.
   * The actual assignment transfer happens here.
   */
  async approve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as ApproveSwapInput;
      const manager = req.user!;
      const id = req.params.id as string;

      const swap = await prisma.swapRequest.findUnique({
        where: { id },
        include: {
          assignment: true,
          shift: { include: { location: true, skill: true } },
          initiator: { select: { name: true } },
          receiver: { select: { name: true } },
        },
      });

      if (!swap) throw new NotFoundError("SwapRequest", id);
      if (swap.status !== "PENDING_MANAGER") {
        throw new ForbiddenOperationError(`Cannot approve a swap in '${swap.status}' status`);
      }

      // Verify manager has access to the shift's location
      if (manager.role !== "ADMIN") {
        const access = await prisma.locationManager.findUnique({
          where: { userId_locationId: { userId: manager.sub, locationId: swap.shift.locationId } },
        });
        if (!access) throw new ForbiddenOperationError("You are not a manager of this location");
      }

      if (!swap.receiverId) {
        throw new ForbiddenOperationError("Cannot approve a swap with no receiver");
      }

      await prisma.$transaction(async (tx) => {
        // Cancel initiator's assignment
        await tx.shiftAssignment.update({
          where: { id: swap.assignmentId },
          data: { status: "CANCELLED" },
        });

        // Create or confirm receiver's assignment
        await tx.shiftAssignment.upsert({
          where: { shiftId_userId: { shiftId: swap.shiftId, userId: swap.receiverId! } },
          update: { status: "CONFIRMED", assignedBy: manager.sub },
          create: {
            shiftId: swap.shiftId,
            userId: swap.receiverId!,
            assignedBy: manager.sub,
          },
        });

        await tx.swapRequest.update({
          where: { id },
          data: { status: "APPROVED", approvedBy: manager.sub, managerNote: body.managerNote },
        });

        await tx.auditLog.create({
          data: {
            entityType: "SwapRequest", entityId: id,
            action: "approved",
            before: { status: "PENDING_MANAGER" }, after: { status: "APPROVED", approvedBy: manager.sub },
            performedBy: manager.sub,
            shiftId: swap.shiftId, locationId: swap.shift.locationId,
          },
        });
      });

      await notifySwapOutcome(
        swap.initiatorId, swap.receiverId, "APPROVED",
        swap.shiftId, swap.id, body.managerNote,
      );

      broadcastToLocation(swap.shift.locationId, "SWAP_UPDATED", {
        swapRequestId: swap.id, status: "APPROVED",
      });

      ok(res, { message: "Swap approved. The assignment has been transferred." });
    } catch (err) {
      next(err);
    }
  },

  async reject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as RejectSwapInput;
      const manager = req.user!;
      const id = req.params.id as string;

      const swap = await prisma.swapRequest.findUnique({
        where: { id },
        include: { shift: { include: { location: true } } },
      });

      if (!swap) throw new NotFoundError("SwapRequest", id);
      if (swap.status !== "PENDING_MANAGER") {
        throw new ForbiddenOperationError(`Cannot reject a swap in '${swap.status}' status`);
      }

      if (manager.role !== "ADMIN") {
        const access = await prisma.locationManager.findUnique({
          where: { userId_locationId: { userId: manager.sub, locationId: swap.shift.locationId } },
        });
        if (!access) throw new ForbiddenOperationError("You are not a manager of this location");
      }

      await prisma.$transaction(async (tx) => {
        await tx.swapRequest.update({
          where: { id },
          data: { status: "REJECTED", approvedBy: manager.sub, managerNote: body.managerNote },
        });

        // Restore initiator's assignment
        await tx.shiftAssignment.update({
          where: { id: swap.assignmentId },
          data: { status: "CONFIRMED" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "SwapRequest", entityId: id,
            action: "rejected",
            before: { status: "PENDING_MANAGER" },
            after: { status: "REJECTED", reason: body.managerNote },
            performedBy: manager.sub,
            shiftId: swap.shiftId, locationId: swap.shift.locationId,
          },
        });
      });

      await notifySwapOutcome(
        swap.initiatorId, swap.receiverId, "REJECTED",
        swap.shiftId, swap.id, body.managerNote,
      );

      emitToUsers(
        [swap.initiatorId, ...(swap.receiverId ? [swap.receiverId] : [])],
        "SWAP_UPDATED",
        { swapRequestId: swap.id, status: "REJECTED", reason: body.managerNote },
      );

      ok(res, { message: "Swap request rejected." });
    } catch (err) {
      next(err);
    }
  },
};
