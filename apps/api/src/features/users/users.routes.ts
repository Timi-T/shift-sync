import { Router } from "express";
import { usersController } from "@/features/users/users.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { authorize } from "@/shared/middleware/authorize.js";
import { validate } from "@/shared/middleware/validate.js";
import { createUserSchema, updateUserSchema } from "@shift-sync/shared";

export const userRoutes = Router();

userRoutes.use(authenticate);

userRoutes.get("/", authorize("ADMIN", "MANAGER"), usersController.list);
userRoutes.post("/", authorize("ADMIN"), validate("body", createUserSchema), usersController.create);
userRoutes.get("/:id", usersController.getById);
userRoutes.put("/:id", validate("body", updateUserSchema), usersController.update);
userRoutes.patch("/:id/role", authorize("ADMIN"), usersController.patchRole);
userRoutes.get("/:id/hours", usersController.getHoursSummary);
