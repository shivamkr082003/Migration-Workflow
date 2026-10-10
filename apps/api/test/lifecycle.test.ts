import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { sourceRecords, targetCustomers } from "../src/db/schema.js";
import { withTargetLock } from "../src/services/locks.js";
import { agentDraft, answeredVersion, approvedVersion, get, planId, post } from "./helpers.js";

const targetCount = () => db.$count(targetCustomers);

describe("approval gate", () => {
  it("refuses to execute a draft", async () => {
    const pid = await planId();
    const draft = await agentDraft(pid);
    const res = await post(`/versions/${draft.id}/executions`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAN_NOT_APPROVED");
    expect(await targetCount()).toBe(0);
  });

  it("requires blocking questions to be answered", async () => {
    const pid = await planId();
    const draft = await agentDraft(pid);
    await post(`/versions/${draft.id}/dry-runs`);
    const res = await post(`/versions/${draft.id}/approve`, { acknowledgeHighRisk: true });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PLAN_INVALID");
    expect(res.body.error.details.map((d: { code: string }) => d.code)).toContain("UNANSWERED_BLOCKING_QUESTION");
  });

  it("requires a dry run of the exact version and explicit acknowledgement of high-risk mappings", async () => {
    const pid = await planId();
    const v = await answeredVersion(pid, await agentDraft(pid));
    expect((await post(`/versions/${v.id}/approve`, { acknowledgeHighRisk: true })).body.error.code).toBe("DRY_RUN_REQUIRED");
    await post(`/versions/${v.id}/dry-runs`);
    expect((await post(`/versions/${v.id}/approve`, {})).body.error.code).toBe("HIGH_RISK_NOT_ACKNOWLEDGED");
    const ok = await post(`/versions/${v.id}/approve`, { acknowledgeHighRisk: true, note: "LGTM" }, "Asha");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "approved", decidedBy: "Asha", decisionNote: "LGTM" });
  });

  it("supersedes the previously approved version and keeps approved versions immutable", async () => {
    const pid = await planId();
    const first = await approvedVersion(pid);
    const second = await approvedVersion(pid);
    expect((await get(`/versions/${first}`)).body.status).toBe("superseded");
    expect((await get(`/versions/${second}`)).body.status).toBe("approved");
    expect((await post(`/versions/${second}/approve`, { acknowledgeHighRisk: true })).body.error.code).toBe("VERSION_NOT_DRAFT");
  });

  it("lets a reviewer reject a draft with a reason", async () => {
    const pid = await planId();
    const draft = await agentDraft(pid);
    const res = await post(`/versions/${draft.id}/reject`, { reason: "Phone handling is wrong" });
    expect(res.body).toMatchObject({ status: "rejected", decisionNote: "Phone handling is wrong" });
    expect((await post(`/versions/${draft.id}/dry-runs`)).body.error.code).toBe("VERSION_NOT_ACTIVE");
  });
});

describe("versioning", () => {
  it("creates a new version for every edit and diffs them field by field", async () => {
    const pid = await planId();
    const draft = await agentDraft(pid);
    const content = structuredClone(draft.content);
    content.mappings = content.mappings.map((m: { target: string }) =>
      m.target === "phone_e164" ? { ...m, steps: [{ rule: "null_if_blank", params: {} }, { rule: "normalize_phone", params: { default_country_code: "1" } }] } : m,
    );
    const v2 = (await post(`/plans/${pid}/versions`, { content, parentVersionId: draft.id })).body;
    expect(v2.version).toBe(draft.version + 1);
    expect(v2.parentVersionId).toBe(draft.id);
    expect((await get(`/versions/${draft.id}`)).body.content).toEqual(draft.content);

    const diff = (await get(`/versions/${v2.id}/diff?against=${draft.id}`)).body;
    expect(diff.mappings).toHaveLength(1);
    expect(diff.mappings[0]).toMatchObject({ target: "phone_e164", change: "changed" });
  });

  it("rejects malformed plan content with a clear error", async () => {
    const pid = await planId();
    const res = await post(`/plans/${pid}/versions`, { content: { mappings: [{ target: "email", steps: [{ rule: "eval_js" }] }] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PLAN_SHAPE");
  });
});

describe("dry run", () => {
  it("is deterministic and preserves field-level evidence without touching the target", async () => {
    const pid = await planId();
    const draft = await agentDraft(pid);
    const a = (await post(`/versions/${draft.id}/dry-runs`)).body;
    const b = (await post(`/versions/${draft.id}/dry-runs`)).body;
    expect(a.checksum).toBe(b.checksum);
    expect(a.counts).toEqual(b.counts);
    expect(a.counts.accepted + a.counts.rejected).toBe(a.counts.source);
    expect(await targetCount()).toBe(0);

    const rejected = (await get(`/runs/${a.id}/records?status=rejected&limit=200`)).body;
    expect(rejected.total).toBe(a.counts.rejected);
    const bad = rejected.items.find((r: { rowNumber: number }) => r.rowNumber === 8);
    expect(bad.source.signup_dt).toBe("2022-02-30");
    expect(bad.errors[0]).toMatchObject({ field: "signup_date", code: "INVALID_DATE", rule: "parse_date", input: "2022-02-30" });

    const byField = (await get(`/runs/${a.id}/records?status=rejected&field=email`)).body;
    expect(byField.items.every((r: { errors: { field: string }[] }) => r.errors.some((e) => e.field === "email"))).toBe(true);
  });
});

describe("execution, retry and rollback", () => {
  it("retries after a mid-load crash without inserting duplicates", async () => {
    const v = await approvedVersion();
    const crashed = (await post(`/versions/${v}/executions`, { faultInjection: { failAfterRows: 50 } })).body;
    expect(crashed).toMatchObject({ status: "failed", inserted: 50, attempt: 1 });
    expect(await targetCount()).toBe(50);
    expect((await get(`/versions/${v}/reconciliation`)).body.status).toBe("incomplete");

    const retry = (await post(`/versions/${v}/executions`)).body;
    expect(retry).toMatchObject({ status: "succeeded", attempt: 2, inserted: 87, skippedExisting: 50, retryOfRunId: crashed.id });
    expect(await targetCount()).toBe(137);

    const again = (await post(`/versions/${v}/executions`)).body;
    expect(again).toMatchObject({ status: "succeeded", inserted: 0, skippedExisting: 137 });
    expect(await targetCount()).toBe(137);

    const distinct = await db.execute(sql`select count(distinct customer_id)::int as n from target_customers_v2`);
    expect(distinct.rows[0]).toEqual({ n: 137 });
  });

  it("reconciles source and target totals and field values", async () => {
    const v = await approvedVersion();
    await post(`/versions/${v}/executions`);
    const rec = (await get(`/versions/${v}/reconciliation`)).body;
    expect(rec.status).toBe("matched");
    expect(rec.totals).toEqual({ source: 153, accepted: 137, rejected: 16, targetRowsForVersion: 137, targetRowsTotal: 137 });
    expect(rec.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);

    // Tamper with a loaded row: reconciliation must notice.
    await db.update(targetCustomers).set({ email: "tampered@example.com" }).where(eq(targetCustomers.customerId, "C-1001"));
    const after = (await get(`/versions/${v}/reconciliation`)).body;
    expect(after.status).toBe("mismatched");
    expect(after.mismatched[0]).toMatchObject({ key: "C-1001", fields: [{ field: "email", actual: "tampered@example.com" }] });
  });

  it("rolls back every row the version loaded and records it", async () => {
    const v = await approvedVersion();
    await post(`/versions/${v}/executions`, { faultInjection: { failAfterRows: 25 } });
    await post(`/versions/${v}/executions`);
    const rb = (await post(`/versions/${v}/rollback`, { reason: "Wrong tier mapping" })).body;
    expect(rb.rowsDeleted).toBe(137);
    expect(rb.runsRolledBack).toHaveLength(2);
    expect(await targetCount()).toBe(0);

    const runs = (await get(`/runs?versionId=${v}`)).body.filter((r: { kind: string }) => r.kind === "execute");
    expect(runs.map((r: { status: string }) => r.status)).toEqual(["rolled_back", "rolled_back"]);
    expect(runs.map((r: { rowsDeletedOnRollback: number }) => r.rowsDeletedOnRollback).sort((a: number, b: number) => a - b)).toEqual([25, 112]);
    expect((await get(`/versions/${v}/reconciliation`)).body.status).toBe("rolled_back");
    expect((await post(`/versions/${v}/rollback`, { reason: "again" })).body.error.code).toBe("NOTHING_TO_ROLL_BACK");

    // A fresh load after rollback starts a new chain rather than continuing the old one.
    const fresh = (await post(`/versions/${v}/executions`)).body;
    expect(fresh).toMatchObject({ status: "succeeded", inserted: 137, retryOfRunId: null, attempt: 3 });
  });

  it("refuses to load a new version over another version's data", async () => {
    const pid = await planId();
    const v1 = await approvedVersion(pid);
    await post(`/versions/${v1}/executions`);
    const v2 = await approvedVersion(pid);
    const res = await post(`/versions/${v2}/executions`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TARGET_HAS_OTHER_LOAD");
    await post(`/versions/${v1}/rollback`, { reason: "switching to v2" });
    expect((await post(`/versions/${v2}/executions`)).body.status).toBe("succeeded");
  });

  it("refuses to execute when the source changed since the reviewed dry run", async () => {
    const v = await approvedVersion();
    await db
      .update(sourceRecords)
      .set({ payload: sql`jsonb_set(payload, '{tier}', '"diamond"')` })
      .where(eq(sourceRecords.rowNumber, 1));
    const res = await post(`/versions/${v}/executions`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SOURCE_CHANGED_SINCE_DRY_RUN");
    expect(await targetCount()).toBe(0);
  });

  it("never runs two executions against the target at once", async () => {
    const v = await approvedVersion();
    let release!: () => void;
    const held = withTargetLock("test-holder", () => new Promise<void>((r) => (release = r)));
    const blocked = await post(`/versions/${v}/executions`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("MIGRATION_IN_PROGRESS");
    expect((await post(`/versions/${v}/rollback`, { reason: "blocked by lock" })).body.error.code).toBe("MIGRATION_IN_PROGRESS");
    release();
    await held;
    expect((await post(`/versions/${v}/executions`)).body.status).toBe("succeeded");
  });
});

describe("history", () => {
  it("records approval, execution, retry and rollback events with actors", async () => {
    const pid = await planId();
    const v = await approvedVersion(pid);
    await post(`/versions/${v}/executions`, { faultInjection: { failAfterRows: 50 } }, "Ravi");
    await post(`/versions/${v}/executions`, {}, "Ravi");
    await post(`/versions/${v}/rollback`, { reason: "demo" }, "Meera");
    const events = (await get(`/audit-events?planId=${pid}`)).body.reverse();
    const actions = events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["version.approved", "execute.started", "execute.failed", "execute.retried", "execute.succeeded", "rollback.completed"]));
    expect(events.find((e: { action: string }) => e.action === "rollback.completed")).toMatchObject({ actor: "Meera", details: { reason: "demo", rowsDeleted: 137 } });
    expect(events.find((e: { action: string }) => e.action === "version.approved").details.highRiskAcknowledged.length).toBeGreaterThan(0);
  });
});
