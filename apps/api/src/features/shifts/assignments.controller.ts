/**
 * Assignments controller.
 *
 * POST   /api/shifts/:shiftId/assignments          — assign staff to a shift
 * DELETE /api/shifts/:shiftId/assignments/:id       — remove an assignment
 * POST   /api/shifts/:shiftId/assignments/preview   — what-if overtime preview
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok, created, noContent } from "@/shared/lib/response.js";
import { NotFoundError, ForbiddenOperationError, ConstraintError, ConflictError } from "@/shared/lib/errors.js";
import { checkConstraints } from "@/features/shifts/constraints.service.js";
import { previewOvertimeImpact } from "@/features/analytics/overtime.service.js";
import { withAssignmentLock } from "@/shared/lib/redis.js";
import { broadcastToLocation, broadcastConflict } from "@/shared/services/socket.service.js";
import { notifyShiftAssigned, notifyOvertimeWarning } from "@/features/notifications/notification.service.js";
import type { CreateAssignmentInput } from "@shift-sync/shared";

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

async function assertManagerAccess(locationId: string, userId: string, role: string): Promise<void> {
  if (role === "ADMIN") return;
  const access = await prisma.locationManager.findUnique({
    where: { userId_locationId: { userId, locationId } },
  });
  if (!access) throw new ForbiddenOperationError("You are not a manager of this location");
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export const assignmentsController = {
  /**
   * Assign a staff member to a shift.
   *
   * Flow:
   *  1. Acquire Redis lock for the user (prevents simultaneous assignments)
   *  2. Run all scheduling constraints
   *  3. If hard block → reject with violations + suggestions
   *  4. If 7th consecutive day + no override → reject
   *  5. Create assignment inside a serializable Prisma transaction
   *  6. Log to audit trail
   *  7. Emit real-time events
   *  8. Notify the assigned staff member
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.shiftId as string;
      const body = req.body as CreateAssignmentInput;
      const manager = req.user!;

      const shift = await prisma.shift.findUnique({
        where: { id: shiftId },
        include: { location: true },
      });
      if (!shift) throw new NotFoundError("Shift", shiftId);

      await assertManagerAccess(shift.locationId, manager.sub, manager.role);

      if (shift.status === "CANCELLED") {
        throw new ForbiddenOperationError("Cannot assign staff to a cancelled shift");
      }

      // Acquire distributed lock to prevent simultaneous-assignment race condition.
      const assignment = await withAssignmentLock(body.userId, async () => {
        // Run constraint engine inside the lock
        const constraintResult = await checkConstraints(
          body.userId,
          shiftId,
          body.overrideReason,
        );

        if (!constraintResult.valid) {
          throw new ConstraintError(
            "Assignment violates scheduling constraints",
            "CONSTRAINT_VIOLATION",
            {
              violations: constraintResult.violations,
              warnings: constraintResult.warnings,
              suggestions: constraintResult.suggestions,
            },
          );
        }

        // All checks passed — create inside a serializable transaction
        return prisma.$transaction(
          async (tx) => {
            // Double-check headcount inside the transaction
            const existingCount = await tx.shiftAssignment.count({
              where: { shiftId, status: { not: "CANCELLED" } },
            });
            if (existingCount >= shift.headcount) {
              throw new ConflictError(
                "This shift is already fully staffed",
                shiftId,
              );
            }

            // Check that the user isn't already assigned (race guard)
            const existing = await tx.shiftAssignment.findUnique({
              where: { shiftId_userId: { shiftId, userId: body.userId } },
            });
            if (existing && existing.status !== "CANCELLED") {
              throw new ConflictError(
                "This staff member is already assigned to this shift",
                body.userId,
              );
            }

            const newAssignment = await tx.shiftAssignment.upsert({
              where: { shiftId_userId: { shiftId, userId: body.userId } },
              update: { status: "CONFIRMED", assignedBy: manager.sub },
              create: { shiftId, userId: body.userId, assignedBy: manager.sub },
              include: {
                user: { select: { id: true, name: true, email: true, role: true, desiredHoursPerWeek: true } },
              },
            });

            // Record manager override for 7th consecutive day if provided
            if (body.overrideReason) {
              const hasSeventhDayWarning = constraintResult.warnings.some(
                (w) => w.code === "SEVENTH_CONSECUTIVE_DAY",
              );
              if (hasSeventhDayWarning) {
                await tx.managerOverride.create({
                  data: {
                    type: "SEVENTH_CONSECUTIVE_DAY",
                    reason: body.overrideReason,
                    shiftId,
                    userId: body.userId,
                    grantedBy: manager.sub,
                  },
                });
              }
            }

            await tx.auditLog.create({
              data: {
                entityType: "ShiftAssignment",
                entityId: newAssignment.id,
                action: "assigned",
                after: { userId: body.userId, shiftId, assignedBy: manager.sub },
                performedBy: manager.sub,
                shiftId,
                locationId: shift.locationId,
              },
            });

            return { assignment: newAssignment, warnings: constraintResult.warnings };
          },
          { isolationLevel: "Serializable" },
        );
      });

      // Emit real-time conflict notification to other managers viewing this location
      broadcastConflict(
        shift.locationId,
        { conflictingUserId: body.userId, conflictingUserName: assignment.assignment.user.name, shiftId },
        manager.sub,
      );

      // Broadcast assignment to all location subscribers
      broadcastToLocation(shift.locationId, "ASSIGNMENT_CREATED", {
        shiftId,
        assignment: {
          ...assignment.assignment,
          assignedAt: assignment.assignment.assignedAt.toISOString(),
          updatedAt: assignment.assignment.updatedAt.toISOString(),
        },
      });

      // Notify the assigned staff member
      const shiftStart = shift.startTime.toLocaleString("en-US", {
        timeZone: shift.location.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      await notifyShiftAssigned(body.userId, shift.location.name, shiftId, shiftStart);

      // Warn managers if this assignment creates an overtime situation
      const overtime = await previewOvertimeImpact(body.userId, shiftId);
      if (overtime.overtimeHours > 0) {
        const managerIds = await prisma.locationManager.findMany({
          where: { locationId: shift.locationId },
          select: { userId: true },
        });
        await notifyOvertimeWarning(
          managerIds.map((m) => m.userId),
          assignment.assignment.user.name,
          overtime.currentWeekHours,
          body.userId,
        );
      }

      created(res, {
        ...assignment.assignment,
        assignedAt: assignment.assignment.assignedAt.toISOString(),
        updatedAt: assignment.assignment.updatedAt.toISOString(),
        warnings: assignment.warnings,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Remove an assignment from a shift.
   * Cannot remove if there's an active swap request involving this assignment.
   */
  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.shiftId as string;
      const assignmentId = req.params.id as string;
      const manager = req.user!;

      const assignment = await prisma.shiftAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          shift: { include: { location: true } },
          user: { select: { id: true, name: true } },
        },
      });

      if (!assignment || assignment.shiftId !== shiftId) {
        throw new NotFoundError("Assignment", assignmentId);
      }

      await assertManagerAccess(assignment.shift.locationId, manager.sub, manager.role);

      // Check for active swap requests on this assignment
      const activeSwap = await prisma.swapRequest.findFirst({
        where: {
          assignmentId,
          status: { in: ["PENDING_ACCEPTANCE", "PENDING_MANAGER"] },
        },
      });

      if (activeSwap) {
        throw new ForbiddenOperationError(
          "This assignment has a pending swap request. Cancel the swap request before removing the assignment.",
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.shiftAssignment.update({
          where: { id: assignmentId },
          data: { status: "CANCELLED" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "ShiftAssignment",
            entityId: assignmentId,
            action: "removed",
            before: { userId: assignment.userId, status: assignment.status },
            after: { status: "CANCELLED" },
            performedBy: manager.sub,
            shiftId,
            locationId: assignment.shift.locationId,
          },
        });
      });

      broadcastToLocation(assignment.shift.locationId, "ASSIGNMENT_REMOVED", {
        shiftId,
        assignmentId,
        userId: assignment.userId,
      });

      noContent(res);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Preview the overtime impact of a proposed assignment without persisting it.
   * Used by the "what-if" panel in the manager UI.
   */
  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shiftId = req.params.shiftId as string;
      const { userId } = req.body as { userId: string };

      const [constraintResult, overtimeImpact] = await Promise.all([
        checkConstraints(userId, shiftId),
        previewOvertimeImpact(userId, shiftId),
      ]);

      // Flatten constraintResult to the top level so the frontend can read
      // `data.valid`, `data.violations`, etc. directly, with overtimeImpact alongside.
      ok(res, { ...constraintResult, overtimeImpact });
    } catch (err) {
      next(err);
    }
  },
};
