import type { FieldError, FieldProfile, PlanContent, PlanIssue, RuleCatalogEntry, RunCounts, SourceSchema, TargetRow, TargetSchema } from "@mw/core";

export type { FieldError, FieldProfile, PlanContent, PlanIssue, RuleCatalogEntry, RunCounts, SourceSchema, TargetRow, TargetSchema };
export type { FieldMapping, RuleStep, ClarificationQuestion, RiskLevel } from "@mw/core";

export interface Meta {
  source: SourceSchema;
  target: TargetSchema;
  rules: RuleCatalogEntry[];
  sampleSize: number;
  maxSampleSize: number;
  agent: { default: "claude" | "heuristic"; claude: boolean; model: string };
  features: { faultInjection: boolean; reset: boolean };
}

export type VersionStatus = "draft" | "approved" | "superseded" | "rejected";

export interface VersionSummary {
  id: string;
  version: number;
  status: VersionStatus;
  origin: "agent" | "user";
  contentHash: string;
  note: string | null;
  parentVersionId: string | null;
  agentRunId: string | null;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface Plan {
  id: string;
  name: string;
  sourceEntity: string;
  targetEntity: string;
  createdAt: string;
  versions: VersionSummary[];
}

export interface Version extends VersionSummary {
  planId: string;
  content: PlanContent;
  issues: PlanIssue[];
  decisionNote: string | null;
  integrityOk: boolean;
  approvalBlockers: string[];
  latestDryRun: { id: string; counts: RunCounts; checksum: string; planHash: string; startedAt: string } | null;
}

export interface Run {
  id: string;
  planVersionId: string;
  kind: "dry_run" | "execute";
  status: "running" | "succeeded" | "failed" | "rolled_back";
  attempt: number;
  retryOfRunId: string | null;
  planHash: string;
  checksum: string | null;
  counts: RunCounts | null;
  errorsByCode: Record<string, number> | null;
  errorsByField: Record<string, number> | null;
  inserted: number;
  skippedExisting: number;
  faultInjection: { failAfterRows: number } | null;
  error: string | null;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rowsDeletedOnRollback: number | null;
}

export interface RecordResult {
  id: number;
  runId: string;
  rowNumber: number;
  sourceKey: string | null;
  targetKey: string | null;
  status: "accepted" | "rejected";
  output: TargetRow | null;
  errors: FieldError[];
  source: Record<string, unknown> | null;
}

export interface Page<T> {
  total: number;
  items: T[];
}

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

export interface AgentRun {
  id: string;
  planId: string;
  mode: "claude" | "heuristic";
  model: string | null;
  status: "running" | "succeeded" | "failed";
  guidance: string | null;
  baseVersionId?: string | null;
  trace?: AgentTraceStep[];
  usage: { inputTokens: number; outputTokens: number; turns: number } | null;
  error: string | null;
  outputVersionId: string | null;
  requestedBy: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface Reconciliation {
  versionId: string;
  version: number;
  status: "matched" | "mismatched" | "incomplete" | "not_loaded" | "rolled_back";
  latestExecution: { id: string; status: Run["status"]; attempt: number; inserted: number; skippedExisting: number } | null;
  totals: { source: number; accepted: number; rejected: number; targetRowsForVersion: number; targetRowsTotal: number };
  checks: { name: string; expected: number; actual: number; pass: boolean }[];
  missingKeys: string[];
  unexpectedKeys: string[];
  mismatched: { key: string; fields: { field: string; expected: unknown; actual: unknown }[] }[];
  checkedAt: string;
}

export interface AuditEvent {
  id: number;
  at: string;
  actor: string;
  action: string;
  planId: string | null;
  planVersionId: string | null;
  runId: string | null;
  agentRunId: string | null;
  details: Record<string, unknown>;
}

export interface VersionDiff {
  from: { id: string; version: number };
  to: { id: string; version: number };
  mappings: { target: string; change: "added" | "removed" | "changed"; before?: unknown; after?: unknown }[];
  questions: { id: string; before: unknown; after: unknown }[];
}

export interface TargetDbRow {
  customerId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phoneE164: string | null;
  signupDate: string;
  isActive: boolean;
  countryCode: string;
  lifetimeValueCents: number;
  loyaltyTier: string;
  marketingOptIn: boolean;
  loadedByPlanVersionId: string;
  loadedByRunId: string;
  loadedAt: string;
}
