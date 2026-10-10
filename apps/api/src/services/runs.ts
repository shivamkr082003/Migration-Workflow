import { and, asc, count, desc, eq, getTableColumns, inArray, ne, sql } from "drizzle-orm";
import { planHash, runPlan, type MigrationReport, type TargetRow } from "@mw/core";
import { config } from "../config.js";
import { db, type Tx } from "../db/client.js";
import { planVersions, recordResults, runs, sourceRecords, targetCustomers } from "../db/schema.js";
import { AppError, conflict, notFound, unprocessable } from "../errors.js";
import { logger } from "../logger.js";
import { audit } from "./audit.js";
import { inputs, loadSourceRecords } from "./inputs.js";
import { withTargetLock } from "./locks.js";
import { getVersionRow, latestDryRun, type PlanVersionRow } from "./plans.js";

const CHUNK_SIZE = 25;

export type RunRow = typeof runs.$inferSelect;

/* ---------- target row <-> schema-field mapping (driven by the table's column names) ---------- */

const targetColumns = Object.entries(getTableColumns(targetCustomers)).map(([prop, col]) => ({ prop, name: col.name }));

function toTargetInsert(row: TargetRow, versionId: string, runId: string) {
  const values: Record<string, unknown> = { loadedByPlanVersionId: versionId, loadedByRunId: runId };
  for (const f of inputs().target.fields) {
    const col = targetColumns.find((c) => c.name === f.name)!;
    values[col.prop] = row[f.name] ?? null;
  }
  return values as typeof targetCustomers.$inferInsert;
}

export function fromTargetRow(dbRow: typeof targetCustomers.$inferSelect): TargetRow {
  const out: TargetRow = {};
  for (const f of inputs().target.fields) {
    const col = targetColumns.find((c) => c.name === f.name)!;
    out[f.name] = (dbRow as Record<string, unknown>)[col.prop] as TargetRow[string];
  }
  return out;
}

/* ---------- shared helpers ---------- */

async function computeReport(version: PlanVersionRow): Promise<MigrationReport> {
  const { source, target } = inputs();
  return runPlan(await loadSourceRecords(), version.content, source, target);
}

async function saveRecordResults(tx: Tx | typeof db, runId: string, report: MigrationReport) {
  const rows = report.outcomes.map((o) => ({
    runId,
    rowNumber: o.row,
    sourceKey: o.sourceKey,
    targetKey: o.targetKey,
    status: o.status,
    output: o.output,
    errors: o.errors,
  }));
  for (let i = 0; i < rows.length; i += 200) await tx.insert(recordResults).values(rows.slice(i, i + 200));
}

const reportFields = (r: MigrationReport) => ({
  checksum: r.checksum,
  counts: r.counts,
  errorsByCode: r.errorsByCode,
  errorsByField: r.errorsByField,
});

/* ---------- dry run ---------- */

/** Runs the plan without touching the target. Allowed on drafts so reviewers can iterate. */
export async function dryRun(versionId: string, actor: string): Promise<RunRow> {
  const version = await getVersionRow(versionId);
  if (version.status === "rejected" || version.status === "superseded") {
    throw conflict("VERSION_NOT_ACTIVE", `Version ${version.version} is ${version.status}`);
  }
  const started = Date.now();
  const report = await computeReport(version);
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({ planVersionId: versionId, kind: "dry_run", status: "succeeded", planHash: report.planHash, triggeredBy: actor, finishedAt: new Date(), ...reportFields(report) })
      .returning();
    await saveRecordResults(tx, run!.id, report);
    await audit(tx, {
      actor,
      action: "dry_run.completed",
      planId: version.planId,
      planVersionId: versionId,
      runId: run!.id,
      details: { version: version.version, counts: report.counts, checksum: report.checksum, durationMs: Date.now() - started },
    });
    return run!;
  });
}

/* ---------- execute ---------- */

export interface ExecuteOptions {
  faultInjection?: { failAfterRows: number } | null;
}

/** Thrown deliberately by fault injection to simulate a crash mid-load. */
class SimulatedFailure extends Error {}

export async function execute(versionId: string, actor: string, opts: ExecuteOptions = {}): Promise<RunRow> {
  const version = await getVersionRow(versionId);
  if (version.status !== "approved") {
    throw conflict("PLAN_NOT_APPROVED", `Version ${version.version} is ${version.status}. Only the approved version can be executed.`);
  }
  if (planHash(version.content) !== version.contentHash) {
    throw conflict("PLAN_HASH_MISMATCH", "The approved plan's content does not match its recorded hash. Refusing to execute.");
  }
  const dry = await latestDryRun(versionId);
  if (!dry || dry.planHash !== version.contentHash) {
    throw conflict("DRY_RUN_REQUIRED", "A successful dry run of the approved version is required before execution.");
  }
  if (opts.faultInjection && !config.ALLOW_FAULT_INJECTION) {
    throw new AppError(403, "FAULT_INJECTION_DISABLED", "Fault injection is disabled on this deployment.");
  }

  const holder = `execute:${versionId}:${Date.now()}`;
  return withTargetLock(holder, async () => {
    const others = await db.$count(targetCustomers, ne(targetCustomers.loadedByPlanVersionId, versionId));
    if (others > 0) {
      throw conflict("TARGET_HAS_OTHER_LOAD", `The target holds ${others} row(s) loaded by another plan version. Roll that migration back first.`);
    }

    const report = await computeReport(version);
    if (report.checksum !== dry.checksum) {
      throw conflict(
        "SOURCE_CHANGED_SINCE_DRY_RUN",
        "Transforming the source now gives a different result than the reviewed dry run. Run a new dry run and review it before executing.",
        { dryRunChecksum: dry.checksum, currentChecksum: report.checksum },
      );
    }

    const previous = await db
      .select()
      .from(runs)
      .where(and(eq(runs.planVersionId, versionId), eq(runs.kind, "execute")))
      .orderBy(desc(runs.startedAt));
    const activePrev = previous.find((r) => r.status !== "rolled_back") ?? null;

    const [run] = await db
      .insert(runs)
      .values({
        planVersionId: versionId,
        kind: "execute",
        status: "running",
        attempt: previous.length + 1,
        retryOfRunId: activePrev?.id ?? null,
        planHash: report.planHash,
        triggeredBy: actor,
        faultInjection: opts.faultInjection ?? null,
        ...reportFields(report),
      })
      .returning();
    const runId = run!.id;
    await saveRecordResults(db, runId, report);
    await audit(db, {
      actor,
      action: activePrev ? "execute.retried" : "execute.started",
      planId: version.planId,
      planVersionId: versionId,
      runId,
      details: { version: version.version, attempt: run!.attempt, retryOfRunId: activePrev?.id ?? null, toLoad: report.counts.accepted, faultInjection: opts.faultInjection ?? null },
    });

    const accepted = report.outcomes.filter((o) => o.status === "accepted" && o.output);
    let inserted = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < accepted.length; i += CHUNK_SIZE) {
        const chunk = accepted.slice(i, i + CHUNK_SIZE);
        // Each chunk commits on its own, like a real batch loader; a crash leaves earlier chunks in place.
        await db.transaction(async (tx) => {
          const res = await tx
            .insert(targetCustomers)
            .values(chunk.map((o) => toTargetInsert(o.output!, versionId, runId)))
            .onConflictDoNothing({ target: targetCustomers.customerId })
            .returning({ id: targetCustomers.customerId });
          inserted += res.length;
          skipped += chunk.length - res.length;
          await tx.update(runs).set({ inserted, skippedExisting: skipped }).where(eq(runs.id, runId));
        });
        const processed = i + chunk.length;
        if (opts.faultInjection && processed >= opts.faultInjection.failAfterRows && processed < accepted.length) {
          throw new SimulatedFailure(`Simulated crash after ${processed} of ${accepted.length} rows (fault injection)`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof SimulatedFailure)) logger.error({ err, runId }, "execution failed");
      const [failed] = await db.update(runs).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(runs.id, runId)).returning();
      await audit(db, {
        actor,
        action: "execute.failed",
        planId: version.planId,
        planVersionId: versionId,
        runId,
        details: { attempt: run!.attempt, inserted, skippedExisting: skipped, error: message },
      });
      return failed!;
    }

    const [done] = await db.update(runs).set({ status: "succeeded", finishedAt: new Date() }).where(eq(runs.id, runId)).returning();
    await audit(db, {
      actor,
      action: "execute.succeeded",
      planId: version.planId,
      planVersionId: versionId,
      runId,
      details: { attempt: run!.attempt, inserted, skippedExisting: skipped, accepted: accepted.length, rejected: report.counts.rejected },
    });
    return done!;
  });
}

/* ---------- rollback ---------- */

/** Removes every row this plan version loaded (across all attempts) and marks those runs rolled back. */
export async function rollback(versionId: string, actor: string, reason: string) {
  const version = await getVersionRow(versionId);
  return withTargetLock(`rollback:${versionId}:${Date.now()}`, () =>
    db.transaction(async (tx) => {
      const active = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.planVersionId, versionId), eq(runs.kind, "execute"), inArray(runs.status, ["succeeded", "failed"])));
      if (!active.length) throw conflict("NOTHING_TO_ROLL_BACK", `Version ${version.version} has no loaded execution to roll back.`);

      const deleted = await tx
        .delete(targetCustomers)
        .where(eq(targetCustomers.loadedByPlanVersionId, versionId))
        .returning({ id: targetCustomers.customerId, runId: targetCustomers.loadedByRunId });
      const perRun = new Map<string, number>();
      for (const d of deleted) perRun.set(d.runId, (perRun.get(d.runId) ?? 0) + 1);
      const now = new Date();
      for (const r of active) {
        await tx
          .update(runs)
          .set({ status: "rolled_back", rolledBackAt: now, rolledBackBy: actor, rowsDeletedOnRollback: perRun.get(r.id) ?? 0 })
          .where(eq(runs.id, r.id));
      }
      await audit(tx, {
        actor,
        action: "rollback.completed",
        planId: version.planId,
        planVersionId: versionId,
        details: { version: version.version, rowsDeleted: deleted.length, runIds: active.map((r) => r.id), reason },
      });
      return { versionId, rowsDeleted: deleted.length, runsRolledBack: active.map((r) => r.id) };
    }),
  );
}

/* ---------- reconciliation ---------- */

export interface ReconciliationCheck {
  name: string;
  expected: number;
  actual: number;
  pass: boolean;
}

/** Compares what the plan says should be in the target against what is actually there. */
export async function reconcile(versionId: string) {
  const version = await getVersionRow(versionId);
  const executions = await db
    .select()
    .from(runs)
    .where(and(eq(runs.planVersionId, versionId), eq(runs.kind, "execute")))
    .orderBy(desc(runs.startedAt));
  const active = executions.filter((r) => r.status !== "rolled_back");
  const latest = active[0] ?? null;

  const report = await computeReport(version);
  const expected = new Map(report.outcomes.filter((o) => o.status === "accepted").map((o) => [o.targetKey!, o.output!]));
  const targetRows = await db.select().from(targetCustomers).where(eq(targetCustomers.loadedByPlanVersionId, versionId));
  const total = await db.$count(targetCustomers);
  const actual = new Map(targetRows.map((r) => [r.customerId, fromTargetRow(r)]));

  const missing = [...expected.keys()].filter((k) => !actual.has(k)).sort();
  const unexpected = [...actual.keys()].filter((k) => !expected.has(k)).sort();
  const mismatched: { key: string; fields: { field: string; expected: unknown; actual: unknown }[] }[] = [];
  for (const [key, exp] of expected) {
    const act = actual.get(key);
    if (!act) continue;
    const fields = Object.keys(exp)
      .filter((f) => exp[f] !== act[f])
      .map((f) => ({ field: f, expected: exp[f], actual: act[f] }));
    if (fields.length) mismatched.push({ key, fields });
  }

  const c = report.counts;
  const checks: ReconciliationCheck[] = [
    { name: "Source total = accepted + rejected", expected: c.source, actual: c.accepted + c.rejected, pass: c.source === c.accepted + c.rejected },
    { name: "Target rows = accepted records", expected: c.accepted, actual: actual.size, pass: c.accepted === actual.size },
    { name: "No accepted record missing from target", expected: 0, actual: missing.length, pass: missing.length === 0 },
    { name: "No unexpected rows in target", expected: 0, actual: unexpected.length, pass: unexpected.length === 0 },
    { name: "Loaded values match transformed values", expected: 0, actual: mismatched.length, pass: mismatched.length === 0 },
  ];

  const status = !latest
    ? executions.length
      ? "rolled_back"
      : "not_loaded"
    : checks.every((x) => x.pass)
      ? "matched"
      : latest.status === "failed"
        ? "incomplete"
        : "mismatched";

  return {
    versionId,
    version: version.version,
    status,
    latestExecution: latest && { id: latest.id, status: latest.status, attempt: latest.attempt, inserted: latest.inserted, skippedExisting: latest.skippedExisting },
    totals: { source: c.source, accepted: c.accepted, rejected: c.rejected, targetRowsForVersion: actual.size, targetRowsTotal: total },
    checks,
    missingKeys: missing.slice(0, 50),
    unexpectedKeys: unexpected.slice(0, 50),
    mismatched: mismatched.slice(0, 20),
    checkedAt: new Date().toISOString(),
  };
}

/* ---------- queries ---------- */

export async function listRuns(filter: { versionId?: string; limit?: number }) {
  return db
    .select()
    .from(runs)
    .where(filter.versionId ? eq(runs.planVersionId, filter.versionId) : undefined)
    .orderBy(desc(runs.startedAt))
    .limit(filter.limit ?? 50);
}

export async function getRun(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw notFound("Run");
  return run;
}

/** Per-record results joined with the original source payload, for evidence views. */
export async function getRunRecords(runId: string, q: { status?: "accepted" | "rejected"; field?: string; limit: number; offset: number }) {
  await getRun(runId);
  const where = and(
    eq(recordResults.runId, runId),
    q.status ? eq(recordResults.status, q.status) : undefined,
    q.field ? sql`${recordResults.errors} @> ${JSON.stringify([{ field: q.field }])}::jsonb` : undefined,
  );
  const [rows, total] = await Promise.all([
    db
      .select({ result: recordResults, source: sourceRecords.payload })
      .from(recordResults)
      .leftJoin(sourceRecords, eq(sourceRecords.rowNumber, recordResults.rowNumber))
      .where(where)
      .orderBy(asc(recordResults.rowNumber))
      .limit(q.limit)
      .offset(q.offset),
    db.$count(recordResults, where),
  ]);
  return { total, items: rows.map((r) => ({ ...r.result, source: r.source })) };
}

export async function listTargetRows(limit: number, offset: number) {
  const [rows, total] = await Promise.all([
    db.select().from(targetCustomers).orderBy(asc(targetCustomers.customerId)).limit(limit).offset(offset),
    db.$count(targetCustomers),
  ]);
  return { total, items: rows };
}

/** Ensures a fault-injection request is well-formed before reaching execute. */
export function parseFaultInjection(v: unknown): ExecuteOptions["faultInjection"] {
  if (v == null) return null;
  const n = (v as { failAfterRows?: unknown }).failAfterRows;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw unprocessable("INVALID_FAULT_INJECTION", "failAfterRows must be a positive integer");
  return { failAfterRows: n };
}

/** Which plan versions currently own rows in the target, so the UI can explain TARGET_HAS_OTHER_LOAD. */
export async function targetSummary() {
  const rows = await db
    .select({ planVersionId: targetCustomers.loadedByPlanVersionId, version: planVersions.version, status: planVersions.status, rows: count() })
    .from(targetCustomers)
    .innerJoin(planVersions, eq(planVersions.id, targetCustomers.loadedByPlanVersionId))
    .groupBy(targetCustomers.loadedByPlanVersionId, planVersions.version, planVersions.status)
    .orderBy(asc(planVersions.version));
  return { total: rows.reduce((a, r) => a + r.rows, 0), byVersion: rows };
}
