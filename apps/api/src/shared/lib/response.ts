/**
 * Express response helpers.
 *
 * All responses use a consistent JSON envelope:
 *   Success: { ok: true,  data: T }
 *   Error:   { ok: false, error: string, code?: string, details?: unknown }
 *
 * Using helpers instead of writing res.json({...}) inline in every handler
 * enforces the contract and makes the response shape immediately obvious.
 */

import type { Response } from "express";

/** Send a 200 OK with data. */
export function ok<T>(res: Response, data: T): void {
  res.status(200).json({ ok: true, data });
}

/** Send a 201 Created with data. */
export function created<T>(res: Response, data: T): void {
  res.status(201).json({ ok: true, data });
}

/** Send a 204 No Content (for DELETEs). */
export function noContent(res: Response): void {
  res.status(204).send();
}

/** Send a structured error response. */
export function apiError(
  res: Response,
  message: string,
  status: number,
  code?: string,
  details?: unknown,
): void {
  res.status(status).json({
    ok: false,
    error: message,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  });
}
