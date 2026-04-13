/**
 * Route registry — mounts all API routers onto the Express app.
 *
 * All routes are prefixed with /api. Authentication and authorization
 * are applied per-router, not globally, to allow the health check and
 * login endpoints to remain public.
 */

import { Router } from "express";
import { authRoutes } from "@/features/auth/auth.routes.js";
import { userRoutes } from "@/features/users/users.routes.js";
import { locationRoutes } from "@/features/locations/locations.routes.js";
import { shiftRoutes } from "@/features/shifts/shifts.routes.js";
import { swapRoutes } from "@/features/swaps/swaps.routes.js";
import { availabilityRoutes } from "@/features/availability/availability.routes.js";
import { notificationRoutes } from "@/features/notifications/notifications.routes.js";
import { analyticsRoutes } from "@/features/analytics/analytics.routes.js";
import { auditRoutes } from "@/features/audit/audit.routes.js";

export function createApiRouter(): Router {
  const router = Router();

  router.use("/auth", authRoutes);
  router.use("/users", userRoutes);
  router.use("/locations", locationRoutes);
  router.use("/shifts", shiftRoutes);
  router.use("/swap-requests", swapRoutes);
  router.use("/availability", availabilityRoutes);
  router.use("/notifications", notificationRoutes);
  router.use("/analytics", analyticsRoutes);
  router.use("/audit", auditRoutes);

  return router;
}
