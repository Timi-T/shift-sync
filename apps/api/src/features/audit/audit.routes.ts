import { Router } from "express";
import { auditController } from "@/features/audit/audit.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { authorize } from "@/shared/middleware/authorize.js";

export const auditRoutes = Router();

auditRoutes.use(authenticate, authorize("ADMIN", "MANAGER"));

auditRoutes.get("/", auditController.list);
auditRoutes.get("/export", authorize("ADMIN"), auditController.exportCsv);
