import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { isUniqueViolation } from "../db/errors.js";
import { executionLocks } from "../db/schema.js";
import { conflict } from "../errors.js";

export const TARGET_LOCK = "target_customers_v2";

/**
 * Serialises executions and rollbacks against the target. Backed by a primary-key insert so
 * it holds across processes sharing the database, not just within this Node process.
 */
export async function withTargetLock<T>(holder: string, fn: () => Promise<T>): Promise<T> {
  try {
    await db.insert(executionLocks).values({ resource: TARGET_LOCK, holder });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("MIGRATION_IN_PROGRESS", "Another execution or rollback is running against the target. Try again when it finishes.");
    }
    throw err;
  }
  try {
    return await fn();
  } finally {
    await db.delete(executionLocks).where(and(eq(executionLocks.resource, TARGET_LOCK), eq(executionLocks.holder, holder)));
  }
}
