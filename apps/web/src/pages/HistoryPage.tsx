import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, CheckCircle2, ChevronRight, FilePlus2, FlaskConical, PlayCircle, RefreshCw, RotateCcw, ServerCog, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import type { AuditEvent } from "../api/types";
import { AgentRunView } from "../components/plan/AgentPanel";
import { Badge, Card, CardHeader, Dialog, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge, Td, Th } from "../components/ui";
import { fmtTime, relTime } from "../lib/format";
import { keys, useWorkbench } from "../lib/workbench";

const FILTERS = {
  all: () => true,
  approvals: (a: string) => a.startsWith("version."),
  executions: (a: string) => a.startsWith("execute.") || a.startsWith("rollback.") || a.startsWith("dry_run."),
  agent: (a: string) => a.startsWith("agent."),
  system: (a: string) => a.startsWith("system.") || a.startsWith("plan."),
} as const;

function describe(e: AuditEvent): { icon: typeof Bot; tone: string; text: string } {
  const d = e.details as Record<string, unknown>;
  const v = d.version !== undefined ? `v${d.version}` : "";
  switch (e.action) {
    case "plan.created":
      return { icon: FilePlus2, tone: "text-zinc-500", text: `Plan created: ${d.name}` };
    case "version.created":
      return { icon: FilePlus2, tone: "text-sky-600", text: `${v} created (${d.origin === "agent" ? "AI proposal" : "reviewer edit"})${Number(d.errors) ? ` with ${d.errors} validation error(s)` : ""}` };
    case "version.approved":
      return { icon: CheckCircle2, tone: "text-emerald-600", text: `${v} approved${(d.highRiskAcknowledged as string[] | undefined)?.length ? `, acknowledging high-risk: ${(d.highRiskAcknowledged as string[]).join(", ")}` : ""}${d.note ? ` · “${d.note}”` : ""}` };
    case "version.superseded":
      return { icon: RefreshCw, tone: "text-zinc-500", text: `${v} superseded by v${d.supersededBy}` };
    case "version.rejected":
      return { icon: XCircle, tone: "text-red-600", text: `${v} rejected: ${d.reason}` };
    case "agent.started":
      return { icon: Bot, tone: "text-brand-600", text: `Agent (${d.mode}) started${d.guidance ? ` with guidance “${d.guidance}”` : ""}` };
    case "agent.succeeded":
      return { icon: Bot, tone: "text-brand-600", text: `Agent proposed ${v}` };
    case "agent.failed":
      return { icon: Bot, tone: "text-red-600", text: `Agent failed: ${d.error}` };
    case "dry_run.completed": {
      const c = d.counts as { accepted: number; rejected: number } | undefined;
      return { icon: FlaskConical, tone: "text-sky-600", text: `Dry run of ${v}: ${c?.accepted} accepted, ${c?.rejected} quarantined` };
    }
    case "execute.started":
      return { icon: PlayCircle, tone: "text-brand-600", text: `Execution of ${v} started (attempt ${d.attempt}, ${d.toLoad} rows to load)` };
    case "execute.retried":
      return { icon: RefreshCw, tone: "text-amber-600", text: `Retry of ${v} started (attempt ${d.attempt})` };
    case "execute.succeeded":
      return { icon: CheckCircle2, tone: "text-emerald-600", text: `Attempt ${d.attempt} succeeded: ${d.inserted} inserted, ${d.skippedExisting} already present` };
    case "execute.failed":
      return { icon: XCircle, tone: "text-red-600", text: `Attempt ${d.attempt} failed after ${d.inserted} rows: ${d.error}` };
    case "rollback.completed":
      return { icon: RotateCcw, tone: "text-violet-600", text: `${v} rolled back: ${d.rowsDeleted} row(s) removed · “${d.reason}”` };
    case "system.recovered":
      return { icon: ServerCog, tone: "text-amber-600", text: "Recovered interrupted work after a restart" };
    case "system.reset":
      return { icon: ServerCog, tone: "text-zinc-500", text: "Demo data reset" };
    default:
      return { icon: ServerCog, tone: "text-zinc-500", text: e.action };
  }
}

export function HistoryPage() {
  const { plan } = useWorkbench();
  const [filter, setFilter] = useState<keyof typeof FILTERS>("all");
  const [open, setOpen] = useState<number | null>(null);
  const events = useQuery({ queryKey: keys.audit(plan.id), queryFn: () => api.audit(plan.id), refetchInterval: 10_000 });
  const shown = events.data?.filter((e) => FILTERS[filter](e.action)) ?? [];

  return (
    <>
      <PageHeader title="History" description="Append-only record of every proposal, approval, dry run, execution, retry and rollback, with who did it and when." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader
            title="Audit trail"
            actions={
              <div className="inline-flex flex-wrap rounded-lg bg-zinc-100 p-0.5 text-xs">
                {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={clsx("rounded-md px-2.5 py-1 capitalize", filter === f ? "bg-white font-medium shadow-sm" : "text-zinc-600")}>
                    {f}
                  </button>
                ))}
              </div>
            }
          />
          {events.error && (
            <div className="p-4">
              <ErrorBanner error={events.error} />
            </div>
          )}
          {events.isLoading ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <EmptyState title="No events yet" />
          ) : (
            <ol className="relative px-5 py-4">
              <span className="absolute top-6 bottom-6 left-[31px] w-px bg-zinc-200" aria-hidden />
              {shown.map((e) => {
                const { icon: Icon, tone, text } = describe(e);
                const isOpen = open === e.id;
                return (
                  <li key={e.id} className="relative pb-4 pl-10 last:pb-0">
                    <span className="absolute left-0 top-0.5 flex size-6 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200">
                      <Icon className={clsx("size-3.5", tone)} />
                    </span>
                    <button className="w-full text-left" onClick={() => setOpen(isOpen ? null : e.id)}>
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="text-zinc-800">{text}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        <span className="font-medium text-zinc-600">{e.actor}</span>
                        <span title={fmtTime(e.at)}>{relTime(e.at)}</span>
                        <span className="font-mono text-zinc-400">{e.action}</span>
                        <ChevronRight className={clsx("size-3 transition-transform", isOpen && "rotate-90")} />
                      </div>
                    </button>
                    {isOpen && (
                      <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700 ring-1 ring-zinc-200 scrollbar-thin">
                        {JSON.stringify({ at: e.at, planVersionId: e.planVersionId, runId: e.runId, agentRunId: e.agentRunId, details: e.details }, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <AgentRuns />
      </div>
    </>
  );
}

function AgentRuns() {
  const { plan } = useWorkbench();
  const runs = useQuery({ queryKey: keys.agentRuns(plan.id), queryFn: () => api.agentRuns(plan.id) });
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["agentRun", openId], queryFn: () => api.agentRun(openId!), enabled: !!openId });
  return (
    <Card className="self-start">
      <CardHeader title="Agent runs" description="Each run's full tool-call trace is preserved." />
      {runs.isLoading ? (
        <Spinner />
      ) : !runs.data?.length ? (
        <div className="px-5 py-6 text-sm text-zinc-500">No agent runs yet.</div>
      ) : (
        <table className="w-full">
          <thead className="bg-zinc-50/70">
            <tr>
              <Th>When</Th>
              <Th>Agent</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {runs.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => setOpenId(r.id)}>
                <Td className="text-xs text-zinc-600">
                  {relTime(r.startedAt)}
                  <div className="text-zinc-400">{r.requestedBy}</div>
                </Td>
                <Td>
                  <Badge tone={r.mode === "claude" ? "brand" : "zinc"}>{r.mode === "claude" ? r.model : "heuristic"}</Badge>
                </Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog open={!!openId} onClose={() => setOpenId(null)} title="Agent run trace" wide>
        {detail.isLoading ? <Spinner /> : detail.data ? <AgentRunView run={detail.data} /> : <ErrorBanner error={detail.error} />}
      </Dialog>
    </Card>
  );
}
