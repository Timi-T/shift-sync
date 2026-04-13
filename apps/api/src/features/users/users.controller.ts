/**
 * Users controller.
 *
 * GET    /api/users               — list all users (admin) or staff for a location (manager)
 * POST   /api/users               — create a user (admin only)
 * GET    /api/users/:id           — get user detail
 * PUT    /api/users/:id           — update user profile / skills / certifications
 * DELETE /api/users/:id           — deactivate (admin only)
 * GET    /api/users/:id/hours     — weekly hours summary for staff member
 */

import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/lib/prisma.js";
import { ok, created, noContent } from "@/shared/lib/response.js";
import { NotFoundError, ForbiddenOperationError } from "@/shared/lib/errors.js";
import type { CreateUserInput, UpdateUserInput } from "@shift-sync/shared";
import { getWeekStartUtc, getWeekEndUtc } from "@/shared/services/timezone.service.js";
import { differenceInMinutes } from "date-fns";

export const usersController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { locationId, role, skillId } = req.query as Record<string, string>;

      let locationFilter: string[] | undefined;

      if (user.role === "MANAGER") {
        const managed = await prisma.locationManager.findMany({
          where: { userId: user.sub },
          select: { locationId: true },
        });
        locationFilter = managed.map((m) => m.locationId);
      }

      const users = await prisma.user.findMany({
        where: {
          ...(role ? { role: role as "ADMIN" | "MANAGER" | "STAFF" } : {}),
          ...(skillId ? { skills: { some: { skillId } } } : {}),
          ...(locationId || locationFilter
            ? {
              locationCertifications: {
                some: { locationId: locationId ?? { in: locationFilter } },
              },
            }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          desiredHoursPerWeek: true,
          skills: { include: { skill: { select: { id: true, name: true } } } },
          locationCertifications: {
            include: {
              location: { select: { id: true, name: true, timezone: true } },
            },
          },
          managedLocations: {
            include: {
              location: { select: { id: true, name: true, timezone: true } },
            },
          },
        },
        orderBy: { name: "asc" },
      });

      ok(res, users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        desiredHoursPerWeek: u.desiredHoursPerWeek,
        skills: u.skills.map((s) => s.skill),
        locationCertifications: u.role === "MANAGER"
          ? u.managedLocations.map((m) => m.location)
          : u.locationCertifications.map((c) => c.location),
      })));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params.id as string;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          desiredHoursPerWeek: true,
          notificationPreference: { select: { inApp: true, email: true } },
          skills: { include: { skill: { select: { id: true, name: true } } } },
          locationCertifications: {
            include: {
              location: { select: { id: true, name: true, timezone: true } },
            },
          },
          managedLocations: {
            include: {
              location: { select: { id: true, name: true, timezone: true } },
            },
          },
        },
      });

      if (!user) throw new NotFoundError("User", userId);

      ok(res, {
        ...user,
        skills: user.skills.map((s) => s.skill),
        // For staff: use locationCertifications; for managers: use managedLocations
        locationCertifications: user.role === "MANAGER"
          ? user.managedLocations.map((m) => m.location)
          : user.locationCertifications.map((c) => c.location),
        managedLocations: undefined,
      });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateUserInput;
      const actor = req.user!;

      const passwordHash = await bcrypt.hash(body.password, 10);

      const newUser = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            name: body.name,
            email: body.email.toLowerCase().trim(),
            passwordHash,
            role: body.role,
            desiredHoursPerWeek: body.desiredHoursPerWeek ?? null,
          },
        });

        if (body.skillIds?.length) {
          await tx.userSkill.createMany({
            data: body.skillIds.map((skillId) => ({ userId: u.id, skillId })),
            skipDuplicates: true,
          });
        }

        if (body.locationIds?.length) {
          if (body.role === "MANAGER") {
            await tx.locationManager.createMany({
              data: body.locationIds.map((locationId) => ({ userId: u.id, locationId })),
              skipDuplicates: true,
            });
          } else {
            await tx.locationCertification.createMany({
              data: body.locationIds.map((locationId) => ({
                userId: u.id,
                locationId,
                certifiedBy: actor.sub,
              })),
              skipDuplicates: true,
            });
          }
        }

        await tx.notificationPreference.create({
          data: { userId: u.id, inApp: true, email: false },
        });

        await tx.auditLog.create({
          data: {
            entityType: "User", entityId: u.id,
            action: "created",
            after: { name: u.name, email: u.email, role: u.role },
            performedBy: actor.sub,
          },
        });

        return u;
      });

      created(res, { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as UpdateUserInput;
      const actor = req.user!;
      const targetId = req.params.id as string;

      // Staff can only update themselves; managers can update their staff
      if (actor.role === "STAFF" && actor.sub !== targetId) {
        throw new ForbiddenOperationError("You can only update your own profile");
      }

      const existing = await prisma.user.findUnique({ where: { id: targetId } });
      if (!existing) throw new NotFoundError("User", targetId);

      // Determine the effective role of the target user (may change within tx)
      const targetRole = existing.role;

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetId },
          data: {
            ...(body.name ? { name: body.name } : {}),
            ...(body.desiredHoursPerWeek !== undefined
              ? { desiredHoursPerWeek: body.desiredHoursPerWeek }
              : {}),
          },
        });

        if (body.skillIds !== undefined && actor.role !== "STAFF") {
          await tx.userSkill.deleteMany({ where: { userId: targetId } });
          if (body.skillIds.length > 0) {
            await tx.userSkill.createMany({
              data: body.skillIds.map((skillId) => ({ userId: targetId, skillId })),
            });
          }
        }

        if (body.locationIds !== undefined && actor.role !== "STAFF") {
          if (targetRole === "MANAGER") {
            // Manager locations go into the LocationManager join table
            await tx.locationManager.deleteMany({ where: { userId: targetId } });
            if (body.locationIds.length > 0) {
              await tx.locationManager.createMany({
                data: body.locationIds.map((locationId) => ({ userId: targetId, locationId })),
              });
            }
          } else {
            // Staff (or admin) — use LocationCertification
            await tx.locationCertification.deleteMany({ where: { userId: targetId } });
            if (body.locationIds.length > 0) {
              await tx.locationCertification.createMany({
                data: body.locationIds.map((locationId) => ({
                  userId: targetId,
                  locationId,
                  certifiedBy: actor.sub,
                })),
              });
            }
          }
        }

        if (body.notificationPreference) {
          await tx.notificationPreference.upsert({
            where: { userId: targetId },
            update: body.notificationPreference,
            create: { userId: targetId, ...body.notificationPreference },
          });
        }

        await tx.auditLog.create({
          data: {
            entityType: "User", entityId: targetId,
            action: "updated",
            before: { name: existing.name },
            after: { name: body.name ?? existing.name },
            performedBy: actor.sub,
          },
        });
      });

      ok(res, { message: "User updated successfully" });
    } catch (err) {
      next(err);
    }
  },

  async patchRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { role } = req.body as { role: string };
      const actor = req.user!;
      const targetId = req.params.id as string;

      if (!["ADMIN", "MANAGER", "STAFF"].includes(role)) {
        throw new ForbiddenOperationError(`Invalid role: ${role}`);
      }

      const existing = await prisma.user.findUnique({ where: { id: targetId } });
      if (!existing) throw new NotFoundError("User", targetId);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetId },
          data: { role: role as "ADMIN" | "MANAGER" | "STAFF" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "User", entityId: targetId,
            action: "role_changed",
            before: { role: existing.role },
            after: { role },
            performedBy: actor.sub,
          },
        });
      });

      ok(res, { message: "Role updated successfully" });
    } catch (err) {
      next(err);
    }
  },

  async getHoursSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const { weekStart } = req.query as { weekStart?: string };

      const anchor = weekStart ? new Date(weekStart) : new Date();
      const start = getWeekStartUtc(anchor);
      const end = getWeekEndUtc(anchor);

      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, desiredHoursPerWeek: true },
      });
      if (!user) throw new NotFoundError("User", id);

      const assignments = await prisma.shiftAssignment.findMany({
        where: {
          userId: id,
          status: { not: "CANCELLED" },
          shift: { status: { not: "CANCELLED" }, startTime: { gte: start, lte: end } },
        },
        include: {
          shift: {
            select: {
              id: true,
              startTime: true,
              endTime: true,
              isPremium: true,
              location: { select: { name: true } },
            },
          },
        },
      });

      const scheduledHours = assignments.reduce(
        (sum, a) => sum + differenceInMinutes(a.shift.endTime, a.shift.startTime) / 60,
        0,
      );

      const premiumShiftCount = assignments.filter((a) => a.shift.isPremium).length;

      ok(res, {
        userId: user.id,
        name: user.name,
        scheduledHours,
        desiredHoursPerWeek: user.desiredHoursPerWeek,
        hoursDelta: user.desiredHoursPerWeek != null
          ? scheduledHours - user.desiredHoursPerWeek
          : null,
        premiumShiftCount,
        assignments: assignments.map((a) => ({
          shiftId: a.shift.id,
          startTime: a.shift.startTime.toISOString(),
          endTime: a.shift.endTime.toISOString(),
          locationName: a.shift.location.name,
          isPremium: a.shift.isPremium,
          durationHours: differenceInMinutes(a.shift.endTime, a.shift.startTime) / 60,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
};
