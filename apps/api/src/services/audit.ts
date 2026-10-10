import { auditEvents } from "../db/schema.js";
import type { Db, Tx } from "../db/client.js";

export type AuditAction =
  | "plan.created"
  | "version.created"
  | "version.approved"
  | "version.rejected"
  | "version.superseded"
  | "agent.started"
  | "agent.succeeded"
  | "agent.failed"
  | "dry_run.completed"
  | "execute.started"
  | "execute.succeeded"
  | "execute.failed"
  | "execute.retried"
  | "rollback.completed"
  | "system.recovered"
  | "system.reset";

export interface AuditInput {
  actor: string;
  action: AuditAction;
  planId?: string | null;
  planVersionId?: string | null;
  runId?: string | null;
  agentRunId?: string | null;
  details?: Record<string, unknown>;
}

/** Append-only: the app only ever inserts audit events. */
export async function audit(exec: Db | Tx, e: AuditInput) {
  await exec.insert(auditEvents).values({ ...e, details: e.details ?? {} });
}
