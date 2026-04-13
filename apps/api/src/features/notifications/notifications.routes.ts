import { Router } from "express";
import { notificationsController } from "@/features/notifications/notifications.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";

export const notificationRoutes = Router();

notificationRoutes.use(authenticate);

notificationRoutes.get("/",           notificationsController.list);
notificationRoutes.get("/count",      notificationsController.unreadCount);
notificationRoutes.post("/read-all",  notificationsController.markAllRead);
notificationRoutes.post("/:id/read",  notificationsController.markOneRead);
notificationRoutes.post("/read",      notificationsController.markRead);
notificationRoutes.put("/preferences", notificationsController.updatePreferences);
