import { and, desc, eq, max } from "drizzle-orm";
import { hasErrors, planHash, PlanContent, stableStringify, validatePlan, type PlanContentInput } from "@mw/core";
import { db, type Tx } from "../db/client.js";
import { isUniqueViolation } from "../db/errors.js";
import { planVersions, plans, runs } from "../db/schema.js";
import { AppError, conflict, notFound, unprocessable } from "../errors.js";
import { audit } from "./audit.js";
import { inputs } from "./inputs.js";

export type PlanVersionRow = typeof planVersions.$inferSelect;

export async function listPlans() {
  return db.select().from(plans).orderBy(plans.createdAt);
}

export async function getPlan(planId: string) {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw notFound("Plan");
  const versions = await db
    .select({
      id: planVersions.id,
      version: planVersions.version,
      status: planVersions.status,
      origin: planVersions.origin,
      contentHash: planVersions.contentHash,
      note: planVersions.note,
      parentVersionId: planVersions.parentVersionId,
      agentRunId: planVersions.agentRunId,
      createdBy: planVersions.createdBy,
      createdAt: planVersions.createdAt,
      decidedBy: planVersions.decidedBy,
      decidedAt: planVersions.decidedAt,
    })
    .from(planVersions)
    .where(eq(planVersions.planId, planId))
    .orderBy(desc(planVersions.version));
  return { ...plan, versions };
}

export async function getVersionRow(versionId: string, exec: typeof db | Tx = db): Promise<PlanVersionRow> {
  const [v] = await exec.select().from(planVersions).where(eq(planVersions.id, versionId));
  if (!v) throw notFound("Plan version");
  return v;
}

export async function latestDryRun(versionId: string, exec: typeof db | Tx = db) {
  const [run] = await exec
    .select()
    .from(runs)
    .where(and(eq(runs.planVersionId, versionId), eq(runs.kind, "dry_run"), eq(runs.status, "succeeded")))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  return run ?? null;
}

/** Version with live validation results, so the UI always shows what approval would require. */
export async function getVersion(versionId: string) {
  const v = await getVersionRow(versionId);
  const { source, target } = inputs();
  const approvalIssues = validatePlan(v.content, source, target, { forApproval: true });
  const dryRun = await latestDryRun(versionId);
  return {
    ...v,
    issues: approvalIssues,
    integrityOk: planHash(v.content) === v.contentHash,
    latestDryRun: dryRun && { id: dryRun.id, counts: dryRun.counts, checksum: dryRun.checksum, planHash: dryRun.planHash, startedAt: dryRun.startedAt },
    approvalBlockers: approvalBlockers(v, approvalIssues, !!dryRun && dryRun.planHash === v.contentHash),
  };
}

function approvalBlockers(v: PlanVersionRow, issues: ReturnType<typeof validatePlan>, hasDryRun: boolean): string[] {
  const blockers: string[] = [];
  if (v.status !== "draft") blockers.push(`Version is ${v.status}; only drafts can be approved.`);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) blockers.push(`${errors.length} validation error(s) must be fixed.`);
  if (!hasDryRun) blockers.push("Run a dry run of this version and review the results first.");
  return blockers;
}

export interface CreateVersionInput {
  planId: string;
  content: PlanContentInput;
  origin: "agent" | "user";
  actor: string;
  parentVersionId?: string | null;
  agentRunId?: string | null;
  note?: string | null;
}

/** Every edit creates a new immutable version; nothing is ever updated in place. */
export async function createVersion(input: CreateVersionInput, exec: typeof db | Tx = db): Promise<PlanVersionRow> {
  const parsed = PlanContent.safeParse(input.content);
  if (!parsed.success) {
    throw new AppError(400, "INVALID_PLAN_SHAPE", "Plan content does not match the plan format", parsed.error.issues);
  }
  const content = parsed.data;
  const { source, target } = inputs();
  const issues = validatePlan(content, source, target);

  const [plan] = await exec.select().from(plans).where(eq(plans.id, input.planId));
  if (!plan) throw notFound("Plan");
  if (input.parentVersionId) {
    const parent = await getVersionRow(input.parentVersionId, exec);
    if (parent.planId !== input.planId) throw unprocessable("PARENT_MISMATCH", "Parent version belongs to another plan");
  }

  // Retry once if two writers race for the same version number (unique index guards it).
  for (let attempt = 0; ; attempt++) {
    const [{ current }] = (await exec.select({ current: max(planVersions.version) }).from(planVersions).where(eq(planVersions.planId, input.planId))) as [
      { current: number | null },
    ];
    try {
      const [row] = await exec
        .insert(planVersions)
        .values({
          planId: input.planId,
          version: (current ?? 0) + 1,
          origin: input.origin,
          content,
          contentHash: planHash(content),
          issues,
          note: input.note ?? null,
          parentVersionId: input.parentVersionId ?? null,
          agentRunId: input.agentRunId ?? null,
          createdBy: input.actor,
        })
        .returning();
      await audit(exec, {
        actor: input.actor,
        action: "version.created",
        planId: input.planId,
        planVersionId: row!.id,
        agentRunId: input.agentRunId ?? null,
        details: { version: row!.version, origin: input.origin, parentVersionId: input.parentVersionId ?? null, errors: issues.filter((i) => i.severity === "error").length },
      });
      return row!;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
}

export interface ApproveInput {
  actor: string;
  note?: string;
  acknowledgeHighRisk: boolean;
}

export async function approveVersion(versionId: string, input: ApproveInput) {
  const { source, target } = inputs();
  return db.transaction(async (tx) => {
    const v = await getVersionRow(versionId, tx);
    if (v.status !== "draft") throw conflict("VERSION_NOT_DRAFT", `Version ${v.version} is ${v.status}; only drafts can be approved`);
    if (planHash(v.content) !== v.contentHash) throw conflict("PLAN_HASH_MISMATCH", "Stored plan content no longer matches its hash");

    const issues = validatePlan(v.content, source, target, { forApproval: true });
    if (hasErrors(issues)) {
      throw unprocessable("PLAN_INVALID", "The plan has validation errors that block approval", issues.filter((i) => i.severity === "error"));
    }
    const highRisk = v.content.mappings.filter((m) => m.risk === "high").map((m) => m.target);
    if (highRisk.length && !input.acknowledgeHighRisk) {
      throw unprocessable("HIGH_RISK_NOT_ACKNOWLEDGED", `Confirm you reviewed the high-risk mappings: ${highRisk.join(", ")}`, { highRisk });
    }
    const dryRun = await latestDryRun(versionId, tx);
    if (!dryRun || dryRun.planHash !== v.contentHash) {
      throw unprocessable("DRY_RUN_REQUIRED", "Run and review a dry run of this exact version before approving it");
    }

    const superseded = await tx
      .update(planVersions)
      .set({ status: "superseded" })
      .where(and(eq(planVersions.planId, v.planId), eq(planVersions.status, "approved")))
      .returning({ id: planVersions.id, version: planVersions.version });
    for (const s of superseded) {
      await audit(tx, { actor: input.actor, action: "version.superseded", planId: v.planId, planVersionId: s.id, details: { version: s.version, supersededBy: v.version } });
    }

    const [approved] = await tx
      .update(planVersions)
      .set({ status: "approved", decidedBy: input.actor, decidedAt: new Date(), decisionNote: input.note ?? null })
      .where(and(eq(planVersions.id, versionId), eq(planVersions.status, "draft")))
      .returning();
    if (!approved) throw conflict("VERSION_NOT_DRAFT", "Version changed status while approving");

    await audit(tx, {
      actor: input.actor,
      action: "version.approved",
      planId: v.planId,
      planVersionId: v.id,
      details: { version: v.version, contentHash: v.contentHash, highRiskAcknowledged: highRisk, dryRunId: dryRun.id, note: input.note ?? null },
    });
    return approved;
  });
}

export async function rejectVersion(versionId: string, actor: string, reason: string) {
  return db.transaction(async (tx) => {
    const v = await getVersionRow(versionId, tx);
    if (v.status !== "draft") throw conflict("VERSION_NOT_DRAFT", `Version ${v.version} is ${v.status}; only drafts can be rejected`);
    const [row] = await tx
      .update(planVersions)
      .set({ status: "rejected", decidedBy: actor, decidedAt: new Date(), decisionNote: reason })
      .where(eq(planVersions.id, versionId))
      .returning();
    await audit(tx, { actor, action: "version.rejected", planId: v.planId, planVersionId: v.id, details: { version: v.version, reason } });
    return row!;
  });
}

export type FieldChange = { target: string; change: "added" | "removed" | "changed"; before?: unknown; after?: unknown };

/** Field-by-field comparison of two versions' mappings, ignored fields and questions. */
export async function diffVersions(fromId: string, toId: string) {
  const [a, b] = await Promise.all([getVersionRow(fromId), getVersionRow(toId)]);
  if (a.planId !== b.planId) throw unprocessable("DIFFERENT_PLANS", "Versions belong to different plans");
  const index = (v: PlanVersionRow) => new Map(v.content.mappings.map((m) => [m.target, m]));
  const [ma, mb] = [index(a), index(b)];
  const mappings: FieldChange[] = [];
  for (const [t, m] of mb) {
    const before = ma.get(t);
    if (!before) mappings.push({ target: t, change: "added", after: m });
    else if (stableStringify(before) !== stableStringify(m)) mappings.push({ target: t, change: "changed", before, after: m });
  }
  for (const [t, m] of ma) if (!mb.has(t)) mappings.push({ target: t, change: "removed", before: m });

  const qa = new Map(a.content.questions.map((q) => [q.id, q]));
  const questions = b.content.questions
    .filter((q) => stableStringify(qa.get(q.id) ?? null) !== stableStringify(q))
    .map((q) => ({ id: q.id, before: qa.get(q.id) ?? null, after: q }));

  return {
    from: { id: a.id, version: a.version },
    to: { id: b.id, version: b.version },
    mappings,
    ignoredBefore: a.content.ignored_source_fields,
    ignoredAfter: b.content.ignored_source_fields,
    questions,
  };
}
