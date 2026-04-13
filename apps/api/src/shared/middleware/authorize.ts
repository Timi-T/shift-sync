/**
 * Role-based authorization middleware factory.
 *
 * Usage:
 *   router.post("/shifts", authenticate, authorize("MANAGER", "ADMIN"), handler)
 *
 * This must be used AFTER `authenticate` (which populates req.user).
 * Additionally, managers are scoped to their own locations — the controller
 * is responsible for enforcing that location-level restriction.
 */

import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";
import { ForbiddenError, UnauthorizedError } from "@/shared/lib/errors.js";

/**
 * Returns a middleware that allows only users with the specified roles.
 *
 * @param roles - One or more roles that are permitted to proceed.
 */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(
        new ForbiddenError(
          `This action requires one of the following roles: ${roles.join(", ")}`,
        ),
      );
      return;
    }

    next();
  };
}
