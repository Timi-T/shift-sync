/**
 * Availability controller.
 *
 * GET    /api/availability              — get current user's windows
 * GET    /api/availability/:userId      — get any user's windows (manager/admin)
 * POST   /api/availability              — create a window
 * PUT    /api/availability/:id          — update a window
 * DELETE /api/availability/:id          — delete a window
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok, created, noContent } from "@/shared/lib/response.js";
import { NotFoundError, ForbiddenOperationError } from "@/shared/lib/errors.js";
import { broadcastToLocation } from "@/shared/services/socket.service.js";
import type { CreateAvailabilityInput, UpdateAvailabilityInput } from "@shift-sync/shared";

export const availabilityController = {
  async listForUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const targetId = (req.params.userId as string | undefined) ?? req.user!.sub;
      const actor = req.user!;

      if (actor.role === "STAFF" && actor.sub !== targetId) {
        throw new ForbiddenOperationError("You can only view your own availability");
      }

      const windows = await prisma.availabilityWindow.findMany({
        where: { userId: targetId as string },
        orderBy: [{ type: "asc" }, { dayOfWeek: "asc" }, { date: "asc" }],
      });

      ok(res, windows.map((w) => ({
        ...w,
        date: w.date?.toISOString().slice(0, 10) ?? null,
        effectiveFrom: w.effectiveFrom?.toISOString() ?? null,
        effectiveTo: w.effectiveTo?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      })));
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateAvailabilityInput;
      const user = req.user!;

      const window = await prisma.availabilityWindow.create({
        data: {
          userId: user.sub,
          type: body.type,
          dayOfWeek: body.type === "RECURRING" ? body.dayOfWeek : null,
          startTime: body.startTime,
          endTime: body.endTime,
          date: body.type === "EXCEPTION" ? new Date(body.date) : null,
          available: body.type === "EXCEPTION" ? body.available : true,
          effectiveFrom: body.type === "RECURRING" && body.effectiveFrom
            ? new Date(body.effectiveFrom) : null,
          effectiveTo: body.type === "RECURRING" && body.effectiveTo
            ? new Date(body.effectiveTo) : null,
        },
      });

      // Notify managers of affected locations about the availability change
      const certifications = await prisma.locationCertification.findMany({
        where: { userId: user.sub },
        select: { locationId: true },
      });

      for (const { locationId } of certifications) {
        broadcastToLocation(locationId, "SWAP_UPDATED", {
          type: "availability_changed",
          userId: user.sub,
        });
      }

      created(res, {
        ...window,
        date: window.date?.toISOString().slice(0, 10) ?? null,
        effectiveFrom: window.effectiveFrom?.toISOString() ?? null,
        effectiveTo: window.effectiveTo?.toISOString() ?? null,
        createdAt: window.createdAt.toISOString(),
        updatedAt: window.updatedAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as UpdateAvailabilityInput;
      const user = req.user!;

      const windowId = req.params.id as string;
      const window = await prisma.availabilityWindow.findUnique({
        where: { id: windowId },
      });

      if (!window) throw new NotFoundError("AvailabilityWindow", windowId);
      if (window.userId !== user.sub && user.role === "STAFF") {
        throw new ForbiddenOperationError("You can only update your own availability");
      }

      const updated = await prisma.availabilityWindow.update({
        where: { id: windowId },
        data: {
          ...(body.startTime ? { startTime: body.startTime } : {}),
          ...(body.endTime ? { endTime: body.endTime } : {}),
          ...(body.available !== undefined ? { available: body.available } : {}),
        },
      });

      ok(res, {
        ...updated,
        date: updated.date?.toISOString().slice(0, 10) ?? null,
        effectiveFrom: updated.effectiveFrom?.toISOString() ?? null,
        effectiveTo: updated.effectiveTo?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const windowId = req.params.id as string;

      const window = await prisma.availabilityWindow.findUnique({
        where: { id: windowId },
      });

      if (!window) throw new NotFoundError("AvailabilityWindow", windowId);
      if (window.userId !== user.sub && user.role === "STAFF") {
        throw new ForbiddenOperationError("You can only delete your own availability");
      }

      await prisma.availabilityWindow.delete({ where: { id: windowId } });
      noContent(res);
    } catch (err) {
      next(err);
    }
  },
};
