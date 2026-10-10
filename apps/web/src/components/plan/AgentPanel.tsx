import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Loader2, MessageSquareText, Sparkles, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { AgentRun, AgentTraceStep } from "../../api/types";
import { fmtTime } from "../../lib/format";
import { keys, useWorkbench } from "../../lib/workbench";
import { Badge, Button, Card, CardHeader, Callout, errorToast, inputCls, Label, StatusBadge, useToast } from "../ui";

export function AgentPanel({ compact }: { compact?: boolean }) {
  const { meta, plan, selected, selectVersion } = useWorkbench();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"claude" | "heuristic">(meta.agent.default);
  const [guidance, setGuidance] = useState("");
  const [revise, setRevise] = useState(Boolean(selected));
  const [activeId, setActiveId] = useState<string | null>(null);
  const announced = useRef<string | null>(null);

  useEffect(() => setRevise(Boolean(selected)), [selected?.id]);

  const runs = useQuery({ queryKey: keys.agentRuns(plan.id), queryFn: () => api.agentRuns(plan.id) });
  const latestId = activeId ?? runs.data?.[0]?.id ?? null;
  const active = useQuery({
    queryKey: ["agentRun", latestId],
    queryFn: () => api.agentRun(latestId!),
    enabled: !!latestId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });

  useEffect(() => {
    const run = active.data;
    if (!run || run.status === "running" || announced.current === run.id || run.id !== activeId) return;
    announced.current = run.id;
    void qc.invalidateQueries({ queryKey: keys.plan(plan.id) });
    void qc.invalidateQueries({ queryKey: keys.agentRuns(plan.id) });
    void qc.invalidateQueries({ queryKey: keys.audit(plan.id) });
    if (run.status === "succeeded" && run.outputVersionId) {
      toast({ tone: "success", title: "Agent proposed a new draft", body: "Review the mappings, answer questions, then dry run." });
      selectVersion(run.outputVersionId);
    } else if (run.status === "failed") {
      toast({ tone: "error", title: "Agent run failed", body: run.error ?? undefined });
    }
  }, [active.data, activeId, plan.id, qc, selectVersion, toast]);

  const start = useMutation({
    mutationFn: () => api.startAgent(plan.id, { mode, guidance: guidance.trim() || undefined, baseVersionId: revise && selected ? selected.id : null }),
    onSuccess: (run) => {
      setActiveId(run.id);
      setGuidance("");
      void qc.invalidateQueries({ queryKey: keys.agentRuns(plan.id) });
    },
    onError: (e) => toast(errorToast(e)),
  });

  const running = active.data?.status === "running";

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand-600" /> AI planning agent
          </span>
        }
        description={compact ? undefined : "Proposes mappings, transformations, risks and clarification questions using read-only inspection tools. It cannot approve or execute anything."}
      />
      <div className="space-y-3 p-5">
        <div className={clsx("grid gap-3", !compact && "sm:grid-cols-2")}>
          <label>
            <Label>Agent</Label>
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="claude" disabled={!meta.agent.claude}>
                Claude ({meta.agent.model}){meta.agent.claude ? "" : " — no API key"}
              </option>
              <option value="heuristic">Offline heuristic (deterministic)</option>
            </select>
          </label>
          {selected && (
            <label className={clsx("flex gap-2 text-sm text-zinc-700", compact ? "items-center" : "items-end pb-2")}>
              <input type="checkbox" className="size-4 rounded border-zinc-300 text-brand-600" checked={revise} onChange={(e) => setRevise(e.target.checked)} />
              Revise v{selected.version} (uses its answers)
            </label>
          )}
        </div>
        <label className="block">
          <Label hint="optional">Guidance for the agent</Label>
          <textarea
            className={clsx(inputCls, "min-h-[64px]")}
            value={guidance}
            maxLength={2000}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="e.g. Treat 'Plat' as platinum. Phone numbers for US customers should use +1."
          />
        </label>
        {!meta.agent.claude && mode === "heuristic" && (
          <p className="text-xs text-zinc-500">No ANTHROPIC_API_KEY is configured on the server, so the deterministic offline planner is used. It follows the same tools and review flow. Guidance is recorded but only the Claude agent reads it.</p>
        )}
        <Button variant="primary" icon={<Bot className="size-4" />} loading={start.isPending || running} onClick={() => start.mutate()}>
          {running ? "Agent is working…" : selected && revise ? `Revise v${selected.version} with agent` : "Generate plan with agent"}
        </Button>
      </div>
      {active.data && <AgentRunView run={active.data} />}
    </Card>
  );
}

const ICONS: Record<AgentTraceStep["kind"], typeof Wrench> = { tool_call: Wrench, model_text: MessageSquareText, error: AlertCircle, info: Bot };

export function AgentRunView({ run }: { run: AgentRun }) {
  const [openStep, setOpenStep] = useState<number | null>(null);
  const steps = run.trace ?? [];
  return (
    <div className="border-t border-zinc-100">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 text-xs text-zinc-500">
        <span className="font-medium text-zinc-700">Latest run</span>
        <StatusBadge status={run.status} />
        <Badge tone={run.mode === "claude" ? "brand" : "zinc"}>{run.mode === "claude" ? run.model : "heuristic"}</Badge>
        <span>{fmtTime(run.startedAt)}</span>
        <span>by {run.requestedBy}</span>
        {run.usage && (
          <span>
            · {run.usage.turns} turns · {run.usage.inputTokens.toLocaleString()} in / {run.usage.outputTokens.toLocaleString()} out tokens
          </span>
        )}
      </div>
      {run.guidance && (
        <div className="px-5 pb-2 text-xs text-zinc-600">
          <span className="font-medium">Guidance:</span> {run.guidance}
        </div>
      )}
      {run.status === "failed" && (
        <div className="px-5 pb-3">
          <Callout tone="error" title="The agent did not produce a plan">
            {run.error}
          </Callout>
        </div>
      )}
      <ol className="max-h-80 overflow-y-auto border-t border-zinc-100 scrollbar-thin">
        {steps.map((s, i) => {
          const Icon = ICONS[s.kind];
          const open = openStep === i;
          return (
            <li key={i} className="border-b border-zinc-50 last:border-0">
              <button className="flex w-full items-start gap-2.5 px-5 py-2 text-left text-xs hover:bg-zinc-50" onClick={() => setOpenStep(open ? null : i)}>
                <Icon className={clsx("mt-0.5 size-3.5 shrink-0", s.isError || s.kind === "error" ? "text-red-500" : s.kind === "model_text" ? "text-brand-500" : "text-zinc-400")} />
                <span className="min-w-0 flex-1">
                  {s.kind === "tool_call" ? (
                    <>
                      <span className="font-mono font-medium text-zinc-800">{s.tool}</span>
                      {s.isError && <Badge tone="red" className="ml-1.5">error</Badge>}
                      <span className="ml-1.5 text-zinc-400">{s.durationMs}ms</span>
                    </>
                  ) : (
                    <span className={clsx("line-clamp-2", s.kind === "error" ? "text-red-700" : "text-zinc-600")}>{s.text}</span>
                  )}
                </span>
                {s.kind === "tool_call" && <ChevronRight className={clsx("size-3.5 text-zinc-300 transition-transform", open && "rotate-90")} />}
              </button>
              {open && s.kind === "tool_call" && (
                <div className="grid gap-2 bg-zinc-50 px-5 py-3 md:grid-cols-2">
                  <JsonBlock label="Input" value={s.input} />
                  <JsonBlock label="Output" value={s.output} />
                </div>
              )}
            </li>
          );
        })}
        {run.status === "running" && (
          <li className="flex items-center gap-2 px-5 py-2.5 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Working…
          </li>
        )}
        {run.status === "succeeded" && (
          <li className="flex items-center gap-2 px-5 py-2.5 text-xs text-emerald-700">
            <CheckCircle2 className="size-3.5" /> Plan saved as a draft version for review.
          </li>
        )}
      </ol>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <pre className="max-h-60 overflow-auto rounded-md bg-white p-2 font-mono text-[11px] leading-relaxed text-zinc-700 ring-1 ring-zinc-200 scrollbar-thin">
        {text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text}
      </pre>
    </div>
  );
}
