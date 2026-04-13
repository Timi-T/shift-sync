import { Router } from "express";
import { shiftsController } from "@/features/shifts/shifts.controller.js";
import { assignmentsController } from "@/features/shifts/assignments.controller.js";
import { pickupController } from "@/features/shifts/pickup.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { authorize } from "@/shared/middleware/authorize.js";
import { validate } from "@/shared/middleware/validate.js";
import { createShiftSchema, updateShiftSchema, createAssignmentSchema } from "@shift-sync/shared";

export const shiftRoutes = Router();

shiftRoutes.use(authenticate);

// On-duty dashboard — available to all authenticated users
shiftRoutes.get("/on-duty", shiftsController.onDuty);

// Pickup requests list — must come before /:id to avoid shadowing
shiftRoutes.get("/pickup-requests", authorize("ADMIN", "MANAGER"), pickupController.listAll);

// Shift CRUD
shiftRoutes.get("/", shiftsController.list);
shiftRoutes.post("/", authorize("ADMIN", "MANAGER"), validate("body", createShiftSchema), shiftsController.create);
shiftRoutes.get("/:id", shiftsController.getById);
shiftRoutes.put("/:id", authorize("ADMIN", "MANAGER"), validate("body", updateShiftSchema), shiftsController.update);
shiftRoutes.delete("/:id", authorize("ADMIN", "MANAGER"), shiftsController.cancel);

// Publish
shiftRoutes.post("/:id/publish", authorize("ADMIN", "MANAGER"), shiftsController.publish);
shiftRoutes.post("/publish", authorize("ADMIN", "MANAGER"), shiftsController.publish); // week-level publish
shiftRoutes.post("/publish-week", authorize("ADMIN", "MANAGER"), shiftsController.publish); // alias for frontend

// Audit history
shiftRoutes.get("/:id/audit", authorize("ADMIN", "MANAGER"), shiftsController.getAuditLog);

// Assignments (nested under shifts)
shiftRoutes.post(
  "/:shiftId/assignments",
  authorize("ADMIN", "MANAGER"),
  validate("body", createAssignmentSchema),
  assignmentsController.create,
);
shiftRoutes.delete(
  "/:shiftId/assignments/:id",
  authorize("ADMIN", "MANAGER"),
  assignmentsController.remove,
);
shiftRoutes.post(
  "/:shiftId/assignments/preview",
  authorize("ADMIN", "MANAGER"),
  assignmentsController.preview,
);

// Pickup requests (staff self-service → manager approval)
shiftRoutes.post("/:shiftId/pickup", pickupController.request);
shiftRoutes.get("/:shiftId/pickup", authorize("ADMIN", "MANAGER"), pickupController.listForShift);
shiftRoutes.post("/:shiftId/pickup/:reqId/approve", authorize("ADMIN", "MANAGER"), pickupController.approve);
shiftRoutes.post("/:shiftId/pickup/:reqId/reject", authorize("ADMIN", "MANAGER"), pickupController.reject);
