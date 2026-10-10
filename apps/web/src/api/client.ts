import type {
  AgentRun,
  AuditEvent,
  FieldProfile,
  Meta,
  Page,
  Plan,
  PlanContent,
  RecordResult,
  Reconciliation,
  Run,
  TargetDbRow,
  Version,
  VersionDiff,
} from "./types";
import { getReviewer } from "../lib/reviewer";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "content-type": "application/json", "x-actor": getReviewer() || "anonymous" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Check that the API is running.", null, null);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? "HTTP_ERROR", e.message ?? res.statusText, e.details ?? null, e.requestId ?? res.headers.get("x-request-id"));
  }
  return data as T;
}

const get = <T,>(p: string) => request<T>("GET", p);
const post = <T,>(p: string, b: unknown = {}) => request<T>("POST", p, b);
const qs = (o: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();
  return s ? `?${s}` : "";
};

export const api = {
  meta: () => get<Meta>("/meta"),
  sourceRecords: (limit: number, offset: number) => get<Page<{ row: number; record: Record<string, unknown> }>>(`/source/records${qs({ limit, offset })}`),
  sourceProfile: () => get<FieldProfile[]>("/source/profile"),

  plans: () => get<{ id: string; name: string }[]>("/plans"),
  plan: (id: string) => get<Plan>(`/plans/${id}`),
  version: (id: string) => get<Version>(`/versions/${id}`),
  diff: (id: string, against: string) => get<VersionDiff>(`/versions/${id}/diff${qs({ against })}`),
  createVersion: (planId: string, content: PlanContent, parentVersionId: string | null, note: string) =>
    post<Version>(`/plans/${planId}/versions`, { content, parentVersionId, note }),
  approve: (id: string, acknowledgeHighRisk: boolean, note: string) => post<Version>(`/versions/${id}/approve`, { acknowledgeHighRisk, note: note || undefined }),
  reject: (id: string, reason: string) => post<Version>(`/versions/${id}/reject`, { reason }),

  startAgent: (planId: string, body: { mode?: "claude" | "heuristic"; guidance?: string; baseVersionId?: string | null }) => post<AgentRun>(`/plans/${planId}/agent-runs`, body),
  agentRuns: (planId: string) => get<AgentRun[]>(`/plans/${planId}/agent-runs`),
  agentRun: (id: string) => get<AgentRun>(`/agent-runs/${id}`),

  dryRun: (versionId: string) => post<Run>(`/versions/${versionId}/dry-runs`),
  execute: (versionId: string, failAfterRows?: number) => post<Run>(`/versions/${versionId}/executions`, failAfterRows ? { faultInjection: { failAfterRows } } : {}),
  rollback: (versionId: string, reason: string) => post<{ rowsDeleted: number; runsRolledBack: string[] }>(`/versions/${versionId}/rollback`, { reason }),
  reconciliation: (versionId: string) => get<Reconciliation>(`/versions/${versionId}/reconciliation`),
  runs: (versionId?: string) => get<Run[]>(`/runs${qs({ versionId })}`),
  run: (id: string) => get<Run>(`/runs/${id}`),
  runRecords: (id: string, q: { status?: "accepted" | "rejected"; field?: string; limit: number; offset: number }) =>
    get<Page<RecordResult>>(`/runs/${id}/records${qs(q)}`),

  targetSummary: () => get<{ total: number; byVersion: { planVersionId: string; version: number; status: string; rows: number }[] }>("/target/summary"),
  targetRows: (limit: number, offset: number) => get<Page<TargetDbRow>>(`/target/rows${qs({ limit, offset })}`),
  audit: (planId?: string) => get<AuditEvent[]>(`/audit-events${qs({ planId })}`),
  reset: () => post<{ status: string }>("/admin/reset"),
};
