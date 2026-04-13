import { Router } from "express";
import { availabilityController } from "@/features/availability/availability.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { validate } from "@/shared/middleware/validate.js";
import { createAvailabilitySchema, updateAvailabilitySchema } from "@shift-sync/shared";

export const availabilityRoutes = Router();

availabilityRoutes.use(authenticate);

availabilityRoutes.get("/", availabilityController.listForUser);
availabilityRoutes.get("/:userId", availabilityController.listForUser);
availabilityRoutes.post("/", validate("body", createAvailabilitySchema), availabilityController.create);
availabilityRoutes.put("/:id", validate("body", updateAvailabilitySchema), availabilityController.update);
availabilityRoutes.delete("/:id", availabilityController.remove);
