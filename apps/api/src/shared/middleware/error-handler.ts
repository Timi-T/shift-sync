/**
 * Central Express error handler.
 *
 * Must be registered as the LAST middleware in the Express app:
 *   app.use(errorHandler)
 *
 * Maps typed application errors to structured JSON responses. Unrecognised
 * errors are logged and returned as 500 without leaking internal details.
 */

import type { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import {
  NotFoundError,
  ConstraintError,
  ValidationError,
  ConflictError,
  ForbiddenOperationError,
  UnauthorizedError,
  ForbiddenError,
} from "@/shared/lib/errors.js";
import { apiError } from "@/shared/lib/response.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // ── Known application errors ──────────────────────────────────────────────

  if (err instanceof UnauthorizedError) {
    apiError(res, err.message, 401, "UNAUTHORIZED");
    return;
  }

  if (err instanceof ForbiddenError || err instanceof ForbiddenOperationError) {
    apiError(res, err.message, 403, "FORBIDDEN");
    return;
  }

  if (err instanceof NotFoundError) {
    apiError(res, err.message, 404, "NOT_FOUND");
    return;
  }

  if (err instanceof ValidationError) {
    apiError(res, err.message, 400, "VALIDATION_ERROR", err.issues);
    return;
  }

  if (err instanceof ConstraintError) {
    apiError(res, err.message, 422, err.code, err.details);
    return;
  }

  if (err instanceof ConflictError) {
    apiError(res, err.message, 409, "CONFLICT", {
      conflictingResource: err.conflictingResource,
    });
    return;
  }

  // ── Prisma errors ─────────────────────────────────────────────────────────

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      // Unique constraint violation
      apiError(res, "A record with these values already exists", 409, "CONFLICT");
      return;
    }
    if (err.code === "P2025") {
      // Record not found (triggered by update/delete on missing record)
      apiError(res, "The requested record was not found", 404, "NOT_FOUND");
      return;
    }
    if (err.code === "P2003") {
      // Foreign key constraint failure
      apiError(res, "Referenced resource does not exist", 422, "INVALID_REFERENCE");
      return;
    }
  }

  // ── Unexpected errors ─────────────────────────────────────────────────────

  // Log full error server-side but never expose internal details to the client.
  console.error("[Unhandled Error]", {
    method: req.method,
    path: req.path,
    error: err,
  });

  apiError(res, "An unexpected error occurred", 500, "INTERNAL_ERROR");
}
