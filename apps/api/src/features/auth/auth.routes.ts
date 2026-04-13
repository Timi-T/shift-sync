import { Router } from "express";
import { authController } from "@/features/auth/auth.controller.js";
import { authenticate } from "@/shared/middleware/authenticate.js";
import { validate } from "@/shared/middleware/validate.js";
import { loginSchema } from "@shift-sync/shared";

export const authRoutes = Router();

authRoutes.post("/login", validate("body", loginSchema), authController.login);
authRoutes.post("/logout", authController.logout);
authRoutes.get("/me", authenticate, authController.me);
