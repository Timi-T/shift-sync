/**
 * Redis client (ioredis) for distributed locking.
 *
 * Used exclusively for the concurrent-assignment race condition guard:
 * two managers attempting to assign the same staff member to overlapping
 * shifts at the exact same moment. A short-lived Redis lock is acquired
 * per staff member before the Prisma transaction runs. This is the only
 * place in the codebase where Redis is required.
 *
 * If Redis is unavailable, the constraint checks still run inside a Prisma
 * serializable transaction, so the failure mode is a slightly higher risk of
 * a duplicate assignment in a true high-concurrency environment — not a crash.
 *
 * For the test environment, the lock is mocked (see __tests__/setup.ts).
 */

import { Redis } from "ioredis";

let redisClient: Redis | null = null;

/**
 * Lazily initialise and return the Redis client.
 * Calling this multiple times returns the same instance.
 */
export function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redisClient.on("error", (err) => {
      // Log but don't crash — the app degrades gracefully without Redis.
      console.error("[Redis] Connection error:", err.message);
    });
  }
  return redisClient;
}

// ---------------------------------------------------------------------------
// Distributed lock helpers
// ---------------------------------------------------------------------------

const LOCK_TTL_MS = 5_000; // Locks expire after 5 seconds regardless.
const LOCK_PREFIX = "lock:assign:";

/**
 * Acquire a Redis lock for a specific staff member.
 * Returns true if the lock was acquired, false if someone else holds it.
 *
 * Uses the SET NX PX pattern — atomic, no separate GET + SET race.
 */
export async function acquireAssignmentLock(
  userId: string,
  requestId: string,
): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `${LOCK_PREFIX}${userId}`;
    const result = await redis.set(key, requestId, "PX", LOCK_TTL_MS, "NX");
    return result === "OK";
  } catch {
    // Redis unavailable — allow the operation; Prisma transaction is the fallback.
    return true;
  }
}

/**
 * Release a Redis lock for a staff member.
 * Only releases the lock if the requestId matches (prevents releasing another
 * request's lock due to TTL expiry + re-acquisition).
 */
export async function releaseAssignmentLock(
  userId: string,
  requestId: string,
): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${LOCK_PREFIX}${userId}`;
    // Lua script ensures atomicity of check-then-delete.
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, key, requestId);
  } catch {
    // Best-effort release — TTL will clean up automatically.
  }
}

/**
 * Convenience wrapper: run a function while holding an assignment lock.
 * Throws a ConflictError if the lock cannot be acquired.
 */
export async function withAssignmentLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await acquireAssignmentLock(userId, requestId);

  if (!acquired) {
    const { ConflictError } = await import("@/shared/lib/errors.js");
    throw new ConflictError(
      "Another manager is currently assigning this staff member. Please try again in a moment.",
      userId,
    );
  }

  try {
    return await fn();
  } finally {
    await releaseAssignmentLock(userId, requestId);
  }
}
