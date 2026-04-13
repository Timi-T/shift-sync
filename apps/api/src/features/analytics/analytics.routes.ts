import { Router } from "express"
import { analyticsController } from "@/features/analytics/analytics.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { authorize } from "@/shared/middleware/authorize.js";

export const analyticsRoutes = Router();

analyticsRoutes.use(authenticate, authorize("ADMIN", "MANAGER"));

analyticsRoutes.get("/overtime", analyticsController.overtime);
analyticsRoutes.get("/fairness", analyticsController.fairness);
analyticsRoutes.get("/hours", analyticsController.hoursDistribution);
