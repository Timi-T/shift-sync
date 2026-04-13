/**
 * Analytics controller.
 *
 * GET /api/analytics/overtime    — overtime projections for a week
 * GET /api/analytics/fairness    — premium shift fairness report for a location
 * GET /api/analytics/hours       — staff hours distribution for a location/week
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok } from "@/shared/lib/response.js";
import { NotFoundError } from "@/shared/lib/errors.js";
import { getOvertimeProjections } from "@/features/analytics/overtime.service.js";
import { getFairnessReport } from "@/features/analytics/fairness.service.js";
import { getWeekStartUtc } from "@/shared/services/timezone.service.js";
import { differenceInMinutes } from "date-fns";

export const analyticsController = {
  async overtime(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { weekStart, locationId } = req.query as Record<string, string>;
      const anchor = weekStart ? new Date(weekStart) : new Date();
      const projections = await getOvertimeProjections(anchor, locationId);
      ok(res, projections);
    } catch (err) {
      next(err);
    }
  },

  async fairness(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { locationId, startDate, endDate } = req.query as Record<string, string>;

      if (!locationId) {
        throw new NotFoundError("locationId query param is required");
      }

      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location) throw new NotFoundError("Location", locationId);

      const start = startDate ? new Date(startDate) : new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const report = await getFairnessReport(locationId, start, end);
      ok(res, report);
    } catch (err) {
      next(err);
    }
  },

  async hoursDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { locationId, weekStart } = req.query as Record<string, string>;
      const anchor = weekStart ? new Date(weekStart) : new Date();
      const wStart = getWeekStartUtc(anchor);
      const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);

      const assignments = await prisma.shiftAssignment.findMany({
        where: {
          status: { not: "CANCELLED" },
          shift: {
            status: { not: "CANCELLED" },
            startTime: { gte: wStart, lte: wEnd },
            ...(locationId ? { locationId } : {}),
          },
        },
        include: {
          user: { select: { id: true, name: true, desiredHoursPerWeek: true } },
          shift: {
            select: {
              id: true, startTime: true, endTime: true, isPremium: true,
              location: { select: { name: true } },
            },
          },
        },
      });

      const byUser = new Map<string, {
        userId: string; name: string; desiredHoursPerWeek: number | null;
        scheduledHours: number; premiumShiftCount: number;
        assignments: Array<{
          shiftId: string; startTime: string; endTime: string;
          locationName: string; isPremium: boolean; durationHours: number;
        }>;
      }>();

      for (const a of assignments) {
        const entry = byUser.get(a.userId) ?? {
          userId: a.userId,
          name: a.user.name,
          desiredHoursPerWeek: a.user.desiredHoursPerWeek,
          scheduledHours: 0,
          premiumShiftCount: 0,
          assignments: [],
        };

        const hours = differenceInMinutes(a.shift.endTime, a.shift.startTime) / 60;
        entry.scheduledHours += hours;
        if (a.shift.isPremium) entry.premiumShiftCount++;
        entry.assignments.push({
          shiftId: a.shift.id,
          startTime: a.shift.startTime.toISOString(),
          endTime: a.shift.endTime.toISOString(),
          locationName: a.shift.location.name,
          isPremium: a.shift.isPremium,
          durationHours: hours,
        });

        byUser.set(a.userId, entry);
      }

      const result = Array.from(byUser.values()).map((e) => ({
        ...e,
        hoursDelta: e.desiredHoursPerWeek != null
          ? e.scheduledHours - e.desiredHoursPerWeek
          : null,
      }));

      result.sort((a, b) => b.scheduledHours - a.scheduledHours);

      ok(res, result);
    } catch (err) {
      next(err);
    }
  },
};
