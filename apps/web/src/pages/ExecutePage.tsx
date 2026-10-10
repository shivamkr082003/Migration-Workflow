import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, CircleDashed, Database, PlayCircle, RefreshCw, RotateCcw, Scale, ShieldAlert, XCircle, Zap } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import type { Run, TargetDbRow, VersionSummary } from "../api/types";
import { Badge, Button, Callout, Card, CardHeader, Dialog, EmptyState, ErrorBanner, errorToast, inputCls, Label, Mono, PageHeader, Pager, Spinner, StatusBadge, Td, Th, useToast } from "../components/ui";
import { fmtTime, short } from "../lib/format";
import { keys, useWorkbench } from "../lib/workbench";

export function ExecutePage() {
  const { approved, plan } = useWorkbench();
  const location = useLocation();
  const summary = useQuery({ queryKey: [...keys.target, "summary"], queryFn: api.targetSummary });

  return (
    <>
      <PageHeader title="Execute & reconcile" description="Load the approved plan into the mock target, verify it, and roll it back if needed. Only the approved version can run." />
      <div className="space-y-6">
        <TargetOccupancy summary={summary.data} />
        {!approved ? (
          <Card>
            <EmptyState icon={<ShieldAlert className="size-8" />} title="No approved plan">
              Execution is locked until a reviewer approves a plan version.{" "}
              <Link className="text-brand-600 hover:underline" to={{ pathname: "/plan", search: location.search }}>
                Go to the mapping plan
              </Link>
              .
            </EmptyState>
          </Card>
        ) : (
          <ApprovedExecution key={approved.id} version={approved} planId={plan.id} />
        )}
        <TargetPreview />
      </div>
    </>
  );
}

function useRefreshAll(versionId?: string) {
  const qc = useQueryClient();
  const { plan } = useWorkbench();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["runs"] }),
      qc.invalidateQueries({ queryKey: ["reconciliation"] }),
      qc.invalidateQueries({ queryKey: keys.target }),
      qc.invalidateQueries({ queryKey: keys.audit(plan.id) }),
      versionId ? qc.invalidateQueries({ queryKey: keys.version(versionId) }) : Promise.resolve(),
    ]);
}

function TargetOccupancy({ summary }: { summary?: { total: number; byVersion: { planVersionId: string; version: number; status: string; rows: number }[] } }) {
  const { approved } = useWorkbench();
  const [rollbackFor, setRollbackFor] = useState<{ id: string; version: number } | null>(null);
  if (!summary) return null;
  const others = summary.byVersion.filter((v) => v.planVersionId !== approved?.id);
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <Database className="size-4 text-zinc-400" />
          <span className="text-sm font-medium">Mock target · customers_v2</span>
          <Badge>{summary.total} rows</Badge>
          {summary.byVersion.map((v) => (
            <Badge key={v.planVersionId} tone={v.planVersionId === approved?.id ? "green" : "amber"}>
              v{v.version} ({v.status}): {v.rows}
            </Badge>
          ))}
        </div>
        {others.length > 0 && (
          <div className="border-t border-zinc-100 px-5 py-3">
            <Callout tone="warn" title="The target holds rows from a version that is not the approved one">
              Roll those rows back before executing {approved ? `v${approved.version}` : "a new version"}, so two plans never mix in the target.
              <div className="mt-2 flex flex-wrap gap-2">
                {others.map((o) => (
                  <Button key={o.planVersionId} size="sm" variant="danger" icon={<RotateCcw className="size-3.5" />} onClick={() => setRollbackFor({ id: o.planVersionId, version: o.version })}>
                    Roll back v{o.version}
                  </Button>
                ))}
              </div>
            </Callout>
          </div>
        )}
      </Card>
      {rollbackFor && <RollbackDialog versionId={rollbackFor.id} versionNumber={rollbackFor.version} onClose={() => setRollbackFor(null)} />}
    </>
  );
}

function ApprovedExecution({ version }: { version: VersionSummary; planId: string }) {
  const { meta } = useWorkbench();
  const toast = useToast();
  const refresh = useRefreshAll(version.id);
  const [simulate, setSimulate] = useState(false);
  const [failAfter, setFailAfter] = useState(50);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const detail = useQuery({ queryKey: keys.version(version.id), queryFn: () => api.version(version.id) });
  const runs = useQuery({ queryKey: keys.runs(version.id), queryFn: () => api.runs(version.id) });
  const rec = useQuery({ queryKey: keys.reconciliation(version.id), queryFn: () => api.reconciliation(version.id) });
  const executions = runs.data?.filter((r) => r.kind === "execute") ?? [];
  const latest = executions[0];
  const loaded = executions.some((r) => r.status === "succeeded" || r.status === "failed");
  const isRetry = latest && latest.status !== "rolled_back";

  const exec = useMutation({
    mutationFn: () => api.execute(version.id, simulate ? failAfter : undefined),
    onSuccess: async (run) => {
      await refresh();
      if (run.status === "failed") toast({ tone: "error", title: `Attempt ${run.attempt} failed after ${run.inserted} rows`, body: "Retry safely: rows already loaded are skipped, never duplicated." });
      else toast({ tone: "success", title: `Attempt ${run.attempt} succeeded`, body: `${run.inserted} inserted · ${run.skippedExisting} already present (skipped)` });
    },
    onError: (e) => toast(errorToast(e)),
  });

  const d = detail.data;
  const hasDry = !!d?.latestDryRun && d.latestDryRun.planHash === d.contentHash;
  const pre = [
    { ok: true, label: `v${version.version} approved by ${version.decidedBy}`, sub: fmtTime(version.decidedAt) },
    { ok: !!d?.integrityOk, label: "Plan content matches its approved hash", sub: <Mono>{short(version.contentHash, 12)}</Mono> },
    { ok: hasDry, label: hasDry ? "Reviewed dry run on record" : "Dry run required", sub: d?.latestDryRun ? <>checksum <Mono>{short(d.latestDryRun.checksum, 12)}</Mono> — execution re-checks it</> : null },
  ];

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <PlayCircle className="size-4 text-brand-600" /> Execute approved v{version.version}
              </span>
            }
            description="Loads accepted records in chunks of 25. Each row is keyed by customer_id, so retries skip rows that are already present."
          />
          <div className="space-y-4 p-5">
            <ul className="space-y-2">
              {pre.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {p.ok ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <CircleDashed className="mt-0.5 size-4 text-zinc-400" />}
                  <span>
                    <span className="text-zinc-800">{p.label}</span>
                    {p.sub && <span className="block text-xs text-zinc-500">{p.sub}</span>}
                  </span>
                </li>
              ))}
            </ul>

            {meta.features.faultInjection && (
              <div className={clsx("rounded-lg px-3.5 py-3 ring-1", simulate ? "bg-amber-50 ring-amber-200" : "ring-zinc-200")}>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="size-4 rounded border-zinc-300 text-amber-600" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
                  <Zap className="size-4 text-amber-500" /> Simulate a crash during the load (demo)
                </label>
                {simulate && (
                  <div className="mt-2 flex items-center gap-2 pl-6 text-sm text-zinc-700">
                    Fail after
                    <input type="number" min={1} className={`${inputCls} w-24`} value={failAfter} onChange={(e) => setFailAfter(Math.max(1, Number(e.target.value) || 1))} />
                    rows, then retry to see idempotency.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={isRetry ? <RefreshCw className="size-4" /> : <PlayCircle className="size-4" />} disabled={!hasDry} loading={exec.isPending} onClick={() => exec.mutate()}>
                {latest?.status === "failed" ? "Retry execution" : isRetry ? "Re-run (idempotent)" : "Execute migration"}
              </Button>
              <Button variant="danger" icon={<RotateCcw className="size-4" />} disabled={!loaded} onClick={() => setRollbackOpen(true)}>
                Roll back v{version.version}
              </Button>
            </div>
            {exec.error && <ErrorBanner error={exec.error} />}
          </div>
        </Card>
        <ReconciliationCard query={rec} />
      </div>

      <Card>
        <CardHeader title="Execution attempts" description="Every attempt is kept, including failed and rolled-back ones." />
        {runs.isLoading ? <Spinner /> : executions.length === 0 ? <div className="px-5 py-6 text-sm text-zinc-500">No executions yet.</div> : <ExecutionTable runs={executions} />}
      </Card>
      {rollbackOpen && <RollbackDialog versionId={version.id} versionNumber={version.version} onClose={() => setRollbackOpen(false)} />}
    </>
  );
}

function ExecutionTable({ runs }: { runs: Run[] }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[760px]">
        <thead className="bg-zinc-50/70">
          <tr>
            <Th>Attempt</Th>
            <Th>Status</Th>
            <Th>Inserted</Th>
            <Th>Skipped (already present)</Th>
            <Th>Triggered</Th>
            <Th>Notes</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {runs.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium tabular-nums">#{r.attempt}</Td>
              <Td>
                <StatusBadge status={r.status} />
              </Td>
              <Td className="tabular-nums">{r.inserted}</Td>
              <Td className="tabular-nums">{r.skippedExisting}</Td>
              <Td className="text-xs text-zinc-500">
                {r.triggeredBy}
                <br />
                {fmtTime(r.startedAt)}
              </Td>
              <Td className="text-xs text-zinc-600">
                {r.retryOfRunId && <div>Retry of an earlier attempt</div>}
                {r.faultInjection && <div className="text-amber-700">Fault injection after {r.faultInjection.failAfterRows} rows</div>}
                {r.error && <div className="text-red-700">{r.error}</div>}
                {r.status === "rolled_back" && (
                  <div className="text-violet-700">
                    Rolled back by {r.rolledBackBy} · {r.rowsDeletedOnRollback} row(s) removed
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReconciliationCard({ query }: { query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.reconciliation>>>> }) {
  const r = query.data;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Scale className="size-4 text-brand-600" /> Reconciliation
          </span>
        }
        actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={query.isFetching} onClick={() => query.refetch()}>
            Re-check
          </Button>
        }
      />
      {query.error && (
        <div className="p-4">
          <ErrorBanner error={query.error} />
        </div>
      )}
      {!r ? (
        <Spinner />
      ) : (
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <StatusBadge status={r.status} />
            <span className="text-xs text-zinc-500">checked {fmtTime(r.checkedAt)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Source", r.totals.source],
              ["Expected", r.totals.accepted],
              ["In target", r.totals.targetRowsForVersion],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-zinc-50 px-2 py-2 ring-1 ring-zinc-200">
                <div className="text-lg font-semibold tabular-nums">{v}</div>
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">{l}</div>
              </div>
            ))}
          </div>
          <ul className="space-y-1.5">
            {r.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2 text-sm">
                {c.pass ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
                <span className="min-w-0">
                  <span className="text-zinc-800">{c.name}</span>
                  <span className="block text-xs text-zinc-500">
                    expected {c.expected}, actual {c.actual}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {r.status === "incomplete" && <Callout tone="warn" title="The last attempt stopped part-way">Retry the execution; rows already loaded will be skipped.</Callout>}
          {r.missingKeys.length > 0 && (
            <div className="text-xs text-zinc-600">
              <span className="font-medium">Missing keys:</span> {r.missingKeys.slice(0, 12).join(", ")}
              {r.missingKeys.length > 12 && "…"}
            </div>
          )}
          {r.mismatched.length > 0 && (
            <div className="space-y-1 text-xs">
              <div className="font-medium text-red-700">Value mismatches</div>
              {r.mismatched.map((m) => (
                <div key={m.key} className="font-mono text-zinc-700">
                  {m.key}: {m.fields.map((f) => `${f.field} expected ${JSON.stringify(f.expected)} got ${JSON.stringify(f.actual)}`).join("; ")}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RollbackDialog({ versionId, versionNumber, onClose }: { versionId: string; versionNumber: number; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshAll(versionId);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.rollback(versionId, reason),
    onSuccess: async (res) => {
      await refresh();
      onClose();
      toast({ tone: "success", title: `Rolled back v${versionNumber}`, body: `${res.rowsDeleted} row(s) removed from the target.` });
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Roll back v${versionNumber}?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>
            Roll back
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-zinc-600">
        Deletes every target row loaded by v{versionNumber}, across all attempts. Runs are kept and marked rolled back; source data is untouched.
      </p>
      <label className="block">
        <Label>Reason (recorded in history)</Label>
        <textarea className={`${inputCls} min-h-[72px]`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tier mapping needs another review" />
      </label>
      <div className="mt-3">
        <ErrorBanner error={m.error} />
      </div>
    </Dialog>
  );
}

function TargetPreview() {
  const [offset, setOffset] = useState(0);
  const limit = 15;
  const q = useQuery({ queryKey: [...keys.target, "rows", offset], queryFn: () => api.targetRows(limit, offset), placeholderData: (p) => p });
  const { meta } = useWorkbench();
  // API rows use camelCase properties; show the schema's column names as headers.
  const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()) as keyof TargetDbRow;
  const cols = meta.target.fields.map((f) => ({ name: f.name, key: camel(f.name) }));
  return (
    <Card>
      <CardHeader title="Target rows" description="Current contents of the mock target table." />
      {q.data?.total === 0 ? (
        <div className="px-5 py-6 text-sm text-zinc-500">The target is empty.</div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px]">
            <thead className="bg-zinc-50/70">
              <tr>
                {cols.map((c) => (
                  <Th key={c.name} className="font-mono normal-case">
                    {c.name}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {q.data?.items.map((r) => (
                <tr key={r.customerId}>
                  {cols.map((c) => (
                    <Td key={c.name} className={clsx("max-w-[180px] truncate font-mono text-xs", r[c.key] === null ? "text-zinc-300" : "text-zinc-700")}>
                      {r[c.key] === null ? "null" : String(r[c.key])}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && <Pager total={q.data.total} limit={limit} offset={offset} onChange={setOffset} />}
    </Card>
  );
}
