import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { FieldError, PlanContent, PlanIssue, RunCounts, SourceRecord, TargetRow } from "@mw/core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** The provided sample dataset, loaded once from data/source-records.json. Read-only to the app. */
export const sourceRecords = pgTable("source_records", {
  rowNumber: integer("row_number").primaryKey(),
  sourceKey: text("source_key"),
  payload: jsonb("payload").$type<SourceRecord>().notNull(),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sourceEntity: text("source_entity").notNull(),
  targetEntity: text("target_entity").notNull(),
  createdAt: createdAt(),
});

export const versionStatus = pgEnum("plan_version_status", ["draft", "approved", "superseded", "rejected"]);
export const versionOrigin = pgEnum("plan_version_origin", ["agent", "user"]);

export const planVersions = pgTable(
  "plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    version: integer("version").notNull(),
    status: versionStatus("status").notNull().default("draft"),
    origin: versionOrigin("origin").notNull(),
    content: jsonb("content").$type<PlanContent>().notNull(),
    contentHash: text("content_hash").notNull(),
    issues: jsonb("issues").$type<PlanIssue[]>().notNull(),
    note: text("note"),
    parentVersionId: uuid("parent_version_id"),
    agentRunId: uuid("agent_run_id"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (t) => [
    uniqueIndex("plan_versions_plan_version_uq").on(t.planId, t.version),
    // At most one approved version per plan, enforced by the database.
    uniqueIndex("plan_versions_one_approved_uq").on(t.planId).where(sql`${t.status} = 'approved'`),
  ],
);

export const agentRunStatus = pgEnum("agent_run_status", ["running", "succeeded", "failed"]);

export interface AgentTraceStep {
  at: string;
  kind: "tool_call" | "model_text" | "error" | "info";
  tool?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
  text?: string;
}

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  mode: text("mode").$type<"claude" | "heuristic">().notNull(),
  model: text("model"),
  status: agentRunStatus("status").notNull().default("running"),
  guidance: text("guidance"),
  baseVersionId: uuid("base_version_id"),
  trace: jsonb("trace").$type<AgentTraceStep[]>().notNull().default([]),
  usage: jsonb("usage").$type<{ inputTokens: number; outputTokens: number; turns: number }>(),
  error: text("error"),
  outputVersionId: uuid("output_version_id"),
  requestedBy: text("requested_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const runKind = pgEnum("run_kind", ["dry_run", "execute"]);
export const runStatus = pgEnum("run_status", ["running", "succeeded", "failed", "rolled_back"]);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planVersionId: uuid("plan_version_id").notNull().references(() => planVersions.id),
    kind: runKind("kind").notNull(),
    status: runStatus("status").notNull().default("running"),
    attempt: integer("attempt").notNull().default(1),
    retryOfRunId: uuid("retry_of_run_id"),
    planHash: text("plan_hash").notNull(),
    checksum: text("checksum"),
    counts: jsonb("counts").$type<RunCounts>(),
    errorsByCode: jsonb("errors_by_code").$type<Record<string, number>>(),
    errorsByField: jsonb("errors_by_field").$type<Record<string, number>>(),
    inserted: integer("inserted").notNull().default(0),
    skippedExisting: integer("skipped_existing").notNull().default(0),
    faultInjection: jsonb("fault_injection").$type<{ failAfterRows: number } | null>(),
    error: text("error"),
    triggeredBy: text("triggered_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rolledBackBy: text("rolled_back_by"),
    rowsDeletedOnRollback: integer("rows_deleted_on_rollback"),
  },
  (t) => [index("runs_version_idx").on(t.planVersionId, t.kind)],
);

/** Per-record outcome of a run, including the field-level evidence for quarantined rows. */
export const recordResults = pgTable(
  "record_results",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    sourceKey: text("source_key"),
    targetKey: text("target_key"),
    status: text("status").$type<"accepted" | "rejected">().notNull(),
    output: jsonb("output").$type<TargetRow | null>(),
    errors: jsonb("errors").$type<FieldError[]>().notNull(),
  },
  (t) => [uniqueIndex("record_results_run_row_uq").on(t.runId, t.rowNumber), index("record_results_status_idx").on(t.runId, t.status)],
);

/**
 * The mock target store. Columns mirror data/target-schema.json; the primary key on
 * customer_id is what makes retried loads idempotent (INSERT ... ON CONFLICT DO NOTHING).
 */
export const targetCustomers = pgTable(
  "target_customers_v2",
  {
    customerId: text("customer_id").primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email").notNull(),
    phoneE164: text("phone_e164"),
    signupDate: date("signup_date", { mode: "string" }).notNull(),
    isActive: boolean("is_active").notNull(),
    countryCode: text("country_code").notNull(),
    lifetimeValueCents: integer("lifetime_value_cents").notNull(),
    loyaltyTier: text("loyalty_tier").notNull(),
    marketingOptIn: boolean("marketing_opt_in").notNull(),
    loadedByPlanVersionId: uuid("_plan_version_id").notNull(),
    loadedByRunId: uuid("_run_id").notNull(),
    loadedAt: timestamp("_loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("target_version_idx").on(t.loadedByPlanVersionId)],
);

/** Single-row-per-resource mutex so two executions/rollbacks can never interleave. */
export const executionLocks = pgTable("execution_locks", {
  resource: text("resource").primaryKey(),
  holder: text("holder").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only history of everything that happened. Never updated or deleted by the app. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    planId: uuid("plan_id"),
    planVersionId: uuid("plan_version_id"),
    runId: uuid("run_id"),
    agentRunId: uuid("agent_run_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("audit_plan_idx").on(t.planId, t.at)],
);
