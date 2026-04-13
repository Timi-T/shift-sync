import { Router } from "express";
import { swapsController } from "@/features/swaps/swaps.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { authorize } from "@/shared/middleware/authorize.js";
import { validate } from "@/shared/middleware/validate.js";
import { createSwapRequestSchema, approveSwapSchema, rejectSwapSchema } from "@shift-sync/shared";

export const swapRoutes = Router();

swapRoutes.use(authenticate);

swapRoutes.get("/", swapsController.list);
swapRoutes.post("/", authorize("STAFF"), validate("body", createSwapRequestSchema), swapsController.create);

// Staff actions
swapRoutes.post("/:id/accept", authorize("STAFF"), swapsController.accept);
swapRoutes.post("/:id/cancel", authorize("STAFF"), swapsController.cancel);
swapRoutes.post("/:id/claim", authorize("STAFF"), swapsController.claim);

// Manager actions
swapRoutes.post("/:id/approve", authorize("ADMIN", "MANAGER"), validate("body", approveSwapSchema), swapsController.approve);
swapRoutes.post("/:id/reject", authorize("ADMIN", "MANAGER"), validate("body", rejectSwapSchema), swapsController.reject);
