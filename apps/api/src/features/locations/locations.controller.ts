/**
 * Locations controller.
 *
 * GET    /api/locations        — list locations (scoped by role)
 * POST   /api/locations        — create location (admin)
 * GET    /api/locations/:id    — get location detail
 * PUT    /api/locations/:id    — update (admin)
 * GET    /api/locations/:id/staff — all certified staff for a location
 * GET    /api/locations/skills    — all skill definitions
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok, created } from "@/shared/lib/response.js";
import { NotFoundError } from "@/shared/lib/errors.js";
import type { CreateLocationInput, UpdateLocationInput } from "@shift-sync/shared";

export const locationsController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      let where = {};

      if (user.role === "MANAGER") {
        const managed = await prisma.locationManager.findMany({
          where: { userId: user.sub },
          select: { locationId: true },
        });
        where = { id: { in: managed.map((m) => m.locationId) } };
      } else if (user.role === "STAFF") {
        const certs = await prisma.locationCertification.findMany({
          where: { userId: user.sub },
          select: { locationId: true },
        });
        where = { id: { in: certs.map((c) => c.locationId) } };
      }

      const locations = await prisma.location.findMany({
        where,
        include: {
          managers: { select: { userId: true } },
        },
        orderBy: { name: "asc" },
      });

      ok(res, locations.map((l) => ({
        id: l.id,
        name: l.name,
        timezone: l.timezone,
        address: l.address,
        managerIds: l.managers.map((m) => m.userId),
      })));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const location = await prisma.location.findUnique({
        where: { id },
        include: { managers: { select: { userId: true } } },
      });

      if (!location) throw new NotFoundError("Location", id);

      ok(res, {
        id: location.id,
        name: location.name,
        timezone: location.timezone,
        address: location.address,
        managerIds: location.managers.map((m) => m.userId),
      });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateLocationInput;
      const actor = req.user!;

      const location = await prisma.$transaction(async (tx) => {
        const loc = await tx.location.create({
          data: { name: body.name, timezone: body.timezone, address: body.address },
        });

        if (body.managerIds?.length) {
          await tx.locationManager.createMany({
            data: body.managerIds.map((userId) => ({ userId, locationId: loc.id })),
            skipDuplicates: true,
          });
        }

        await tx.auditLog.create({
          data: {
            entityType: "Location", entityId: loc.id,
            action: "created",
            after: { name: body.name, timezone: body.timezone },
            performedBy: actor.sub, locationId: loc.id,
          },
        });

        return loc;
      });

      created(res, { id: location.id, name: location.name, timezone: location.timezone, address: location.address });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as UpdateLocationInput;
      const actor = req.user!;
      const id = req.params.id as string;

      const location = await prisma.location.findUnique({ where: { id } });
      if (!location) throw new NotFoundError("Location", id);

      const updated = await prisma.$transaction(async (tx) => {
        const upd = await tx.location.update({
          where: { id },
          data: {
            ...(body.name ? { name: body.name } : {}),
            ...(body.timezone ? { timezone: body.timezone } : {}),
            ...(body.address ? { address: body.address } : {}),
          },
        });

        if (body.managerIds !== undefined) {
          await tx.locationManager.deleteMany({ where: { locationId: id } });
          if (body.managerIds.length > 0) {
            await tx.locationManager.createMany({
              data: body.managerIds.map((userId) => ({ userId, locationId: id })),
            });
          }
        }

        await tx.auditLog.create({
          data: {
            entityType: "Location", entityId: id,
            action: "updated",
            before: { name: location.name, timezone: location.timezone },
            after: { name: body.name ?? location.name, timezone: body.timezone ?? location.timezone },
            performedBy: actor.sub, locationId: id,
          },
        });

        return upd;
      });

      ok(res, { id: updated.id, name: updated.name, timezone: updated.timezone, address: updated.address });
    } catch (err) {
      next(err);
    }
  },

  async listStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const locationId = req.params.id as string;
      const skillId = req.query.skillId as string | undefined;

      const certifications = await prisma.locationCertification.findMany({
        where: {
          locationId,
          user: {
            role: "STAFF",
            ...(skillId ? { skills: { some: { skillId } } } : {}),
          },
        },
        include: {
          user: {
            select: {
              id: true, name: true, email: true, role: true, desiredHoursPerWeek: true,
              skills: { include: { skill: { select: { id: true, name: true } } } },
            },
          },
        },
      });

      ok(res, certifications.map((c) => ({
        id: c.user.id,
        name: c.user.name,
        email: c.user.email,
        role: c.user.role,
        desiredHoursPerWeek: c.user.desiredHoursPerWeek,
        skills: c.user.skills.map((s) => s.skill),
        certifiedAt: c.certifiedAt.toISOString(),
      })));
    } catch (err) {
      next(err);
    }
  },

  async listSkills(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const skills = await prisma.skill.findMany({ orderBy: { name: "asc" } });
      ok(res, skills);
    } catch (err) {
      next(err);
    }
  },
};
