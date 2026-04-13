/**
 * Audit controller.
 *
 * GET /api/audit         — query audit logs (admin/manager; filter by location, date range, entity)
 * GET /api/audit/export  — export CSV of audit logs for a date range + location (admin only)
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok } from "@/shared/lib/response.js";

export const auditController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { locationId, startDate, endDate, entityType, page = "1", pageSize = "50" } =
        req.query as Record<string, string>;

      const skip = (parseInt(page, 10) - 1) * parseInt(pageSize, 10);
      const take = parseInt(pageSize, 10);

      const where = {
        ...(locationId ? { locationId } : {}),
        ...(entityType ? { entityType } : {}),
        ...(startDate || endDate
          ? {
              performedAt: {
                ...(startDate ? { gte: new Date(startDate) } : {}),
                ...(endDate ? { lte: new Date(endDate) } : {}),
              },
            }
          : {}),
      };

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: { performer: { select: { id: true, name: true } } },
          orderBy: { performedAt: "desc" },
          skip,
          take,
        }),
        prisma.auditLog.count({ where }),
      ]);

      ok(res, {
        items: logs.map((l) => ({
          ...l,
          performerName: l.performer.name,
          performedAt: l.performedAt.toISOString(),
        })),
        total,
        page: parseInt(page, 10),
        pageSize: take,
        hasMore: skip + take < total,
      });
    } catch (err) {
      next(err);
    }
  },

  async exportCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { locationId, startDate, endDate } = req.query as Record<string, string>;

      const logs = await prisma.auditLog.findMany({
        where: {
          ...(locationId ? { locationId } : {}),
          performedAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {}),
          },
        },
        include: { performer: { select: { name: true } } },
        orderBy: { performedAt: "asc" },
      });

      const header = "id,entityType,entityId,action,performedBy,performerName,performedAt,locationId";
      const rows = logs.map((l) =>
        [
          l.id,
          l.entityType,
          l.entityId,
          l.action,
          l.performedBy,
          `"${l.performer.name}"`,
          l.performedAt.toISOString(),
          l.locationId ?? "",
        ].join(","),
      );

      const csv = [header, ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-${startDate ?? "all"}-to-${endDate ?? "all"}.csv"`,
      );
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
};
