/**
 * Zod request validation middleware factory.
 *
 * Validates `req.body`, `req.query`, or `req.params` against a Zod schema.
 * On failure, passes a 400 ValidationError to the error handler with structured
 * Zod field errors so the client can display per-field messages.
 *
 * Usage:
 *   router.post(
 *     "/shifts",
 *     validate("body", createShiftSchema),
 *     shiftsController.create
 *   )
 */

import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { ZodError } from "zod";
import { ValidationError } from "@/shared/lib/errors.js";

type Target = "body" | "query" | "params";

/**
 * Returns a middleware that validates `req[target]` against the provided schema.
 * Replaces the raw request data with the parsed (coerced) Zod output.
 */
export function validate<T>(target: Target, schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[target]);
      // Replace with parsed output (handles defaults, type coercions, etc.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any)[target] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          new ValidationError("Invalid request data", err.flatten()),
        );
      } else {
        next(err);
      }
    }
  };
}
