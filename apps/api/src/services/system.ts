import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentRuns, executionLocks, runs } from "../db/schema.js";
import { logger } from "../logger.js";
import { audit } from "./audit.js";
import { seedIfEmpty } from "./inputs.js";

/**
 * After a restart nothing can still be running in this process, so in-flight work is
 * marked failed and stale locks are released. (Single-instance deployment assumption,
 * documented in the README.)
 */
export async function recoverInterruptedWork() {
  const failedRuns = await db
    .update(runs)
    .set({ status: "failed", error: "Interrupted by a server restart", finishedAt: new Date() })
    .where(eq(runs.status, "running"))
    .returning({ id: runs.id });
  const failedAgents = await db
    .update(agentRuns)
    .set({ status: "failed", error: "Interrupted by a server restart", finishedAt: new Date() })
    .where(eq(agentRuns.status, "running"))
    .returning({ id: agentRuns.id });
  const locks = await db.delete(executionLocks).returning();
  if (failedRuns.length || failedAgents.length || locks.length) {
    await audit(db, { actor: "system", action: "system.recovered", details: { runs: failedRuns.map((r) => r.id), agentRuns: failedAgents.map((r) => r.id), locksReleased: locks.length } });
    logger.warn({ runs: failedRuns.length, agentRuns: failedAgents.length, locks: locks.length }, "recovered interrupted work");
  }
}

/** Wipes all workbench state and reloads the provided inputs. Demo/review convenience only. */
export async function resetDemo(actor: string) {
  await db.execute(
    sql`TRUNCATE target_customers_v2, record_results, runs, agent_runs, plan_versions, plans, execution_locks, audit_events, source_records RESTART IDENTITY CASCADE`,
  );
  await seedIfEmpty();
  await audit(db, { actor, action: "system.reset" });
}
