/**
 * Application-level error classes.
 *
 * Each error maps to an HTTP status code. The central error handler in
 * src/middleware/error-handler.ts converts these to structured JSON responses.
 * Using typed errors instead of string codes makes catch blocks explicit and
 * type-safe.
 */

/** HTTP 404 — the requested resource does not exist. */
export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(resource: string, id?: string) {
    super(id ? `${resource} '${id}' not found` : `${resource} not found`);
    this.name = "NotFoundError";
  }
}

/**
 * HTTP 422 — a scheduling constraint was violated.
 * The constraint checker returns structured violations; this wraps them for
 * the error handler.
 */
export class ConstraintError extends Error {
  readonly statusCode = 422;
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ConstraintError";
  }
}

/** HTTP 400 — request payload failed Zod validation. */
export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * HTTP 409 — a concurrent operation conflict was detected.
 * e.g., two managers assigning the same bartender simultaneously.
 */
export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(
    message: string,
    public readonly conflictingResource?: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * HTTP 403 — the operation is not permitted in the current state.
 * e.g., editing a published shift after the edit cutoff window.
 * Distinct from auth 403s, which are thrown by the authorize middleware.
 */
export class ForbiddenOperationError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenOperationError";
  }
}

/** HTTP 401 — authentication required or token invalid. */
export class UnauthorizedError extends Error {
  readonly statusCode = 401;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** HTTP 403 — authenticated but insufficient role. */
export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}
