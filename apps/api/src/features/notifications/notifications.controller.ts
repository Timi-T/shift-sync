/**
 * Notifications controller.
 *
 * GET   /api/notifications            — list the current user's notifications
 * GET   /api/notifications/count      — unread count (for the bell badge)
 * POST  /api/notifications/read-all   — mark all as read
 * POST  /api/notifications/:id/read   — mark one as read
 * POST  /api/notifications/read       — bulk mark as read
 * PUT   /api/notifications/preferences — update notification preferences
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/shared/lib/prisma.js";
import { ok } from "@/shared/lib/response.js";

export const notificationsController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { unreadOnly } = req.query as { unreadOnly?: string };
      const userId = req.user!.sub;

      const notifications = await prisma.notification.findMany({
        where: {
          userId,
          ...(unreadOnly === "true" ? { read: false } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      ok(res, notifications.map((n) => ({
        id: n.id,
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.message,   // Prisma column is `message`; shared type & frontend call it `body`
        data: n.data as Record<string, unknown> | null,
        read: n.read,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })));
    } catch (err) {
      next(err);
    }
  },

  async unreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const count = await prisma.notification.count({
        where: { userId: req.user!.sub, read: false },
      });
      ok(res, { count });
    } catch (err) {
      next(err);
    }
  },

  async markOneRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.sub;
      await prisma.notification.updateMany({
        where: { id: req.params.id as string, userId },
        data: { read: true, readAt: new Date() },
      });
      ok(res, { updated: 1 });
    } catch (err) {
      next(err);
    }
  },

  async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { ids } = req.body as { ids: string[] };
      const userId = req.user!.sub;

      await prisma.notification.updateMany({
        where: { id: { in: ids }, userId },
        data: { read: true, readAt: new Date() },
      });

      ok(res, { updated: ids.length });
    } catch (err) {
      next(err);
    }
  },

  async markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await prisma.notification.updateMany({
        where: { userId: req.user!.sub, read: false },
        data: { read: true, readAt: new Date() },
      });

      ok(res, { updated: result.count });
    } catch (err) {
      next(err);
    }
  },

  async updatePreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { inApp, email } = req.body as { inApp: boolean; email: boolean };
      const userId = req.user!.sub;

      const prefs = await prisma.notificationPreference.upsert({
        where: { userId },
        update: { inApp, email },
        create: { userId, inApp, email },
      });

      ok(res, prefs);
    } catch (err) {
      next(err);
    }
  },
};
