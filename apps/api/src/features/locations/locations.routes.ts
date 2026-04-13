import { Router } from "express";
import { locationsController } from "@/features/locations/locations.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { authorize } from "@/shared/middleware/authorize.js";
import { validate } from "@/shared/middleware/validate.js";
import { createLocationSchema, updateLocationSchema } from "@shift-sync/shared";

export const locationRoutes = Router();

locationRoutes.use(authenticate);

locationRoutes.get("/skills", locationsController.listSkills);
locationRoutes.get("/", locationsController.list);
locationRoutes.post("/", authorize("ADMIN"), validate("body", createLocationSchema), locationsController.create);
locationRoutes.get("/:id", locationsController.getById);
locationRoutes.put("/:id", authorize("ADMIN"), validate("body", updateLocationSchema), locationsController.update);
locationRoutes.get("/:id/staff", authorize("ADMIN", "MANAGER"), locationsController.listStaff);
