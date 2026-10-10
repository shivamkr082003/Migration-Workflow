import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronRight, FlaskConical } from "lucide-react";
import { Fragment, useState } from "react";
import { api } from "../api/client";
import type { RecordResult, Run } from "../api/types";
import { Badge, Button, Callout, Card, CardHeader, EmptyState, ErrorBanner, errorToast, Mono, PageHeader, Pager, Spinner, Stat, Td, Th, useToast } from "../components/ui";
import { display, fmtTime, pct, short } from "../lib/format";
import { keys, useWorkbench } from "../lib/workbench";

export function DryRunPage() {
  const { selected, plan } = useWorkbench();
  const qc = useQueryClient();
  const toast = useToast();
  const runs = useQuery({ queryKey: keys.runs(selected?.id), queryFn: () => api.runs(selected!.id), enabled: !!selected });
  const dryRuns = runs.data?.filter((r) => r.kind === "dry_run") ?? [];
  const [runId, setRunId] = useState<string | null>(null);
  const current = dryRuns.find((r) => r.id === runId) ?? dryRuns[0] ?? null;

  const start = useMutation({
    mutationFn: () => api.dryRun(selected!.id),
    onSuccess: async (run) => {
      setRunId(run.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.runs(selected!.id) }),
        qc.invalidateQueries({ queryKey: keys.version(selected!.id) }),
        qc.invalidateQueries({ queryKey: keys.audit(plan.id) }),
      ]);
      toast({ tone: "success", title: "Dry run complete" });
    },
    onError: (e) => toast(errorToast(e)),
  });

  if (!selected) return <PageHeader title="Dry run" description="Create a plan version first." />;
  const canRun = selected.status === "draft" || selected.status === "approved";

  return (
    <>
      <PageHeader
        title="Dry run"
        description={`Deterministic simulation of v${selected.version} over every source record. Nothing is written to the target; invalid records are quarantined with field-level evidence.`}
        actions={
          <>
            {dryRuns.length > 1 && (
              <select className="h-9 rounded-lg border-0 py-0 pr-8 pl-3 text-sm ring-1 ring-zinc-300" value={current?.id} onChange={(e) => setRunId(e.target.value)}>
                {dryRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {fmtTime(r.startedAt)} · {short(r.checksum, 8)}
                  </option>
                ))}
              </select>
            )}
            <Button variant="primary" icon={<FlaskConical className="size-4" />} disabled={!canRun} loading={start.isPending} onClick={() => start.mutate()}>
              Run dry run of v{selected.version}
            </Button>
          </>
        }
      />
      {runs.error && <ErrorBanner error={runs.error} />}
      {runs.isLoading ? (
        <Spinner />
      ) : !current ? (
        <Card>
          <EmptyState icon={<FlaskConical className="size-8" />} title="No dry run for this version yet">
            {canRun ? "Run one to see how many records would be accepted and why the rest would be quarantined." : `v${selected.version} is ${selected.status}; dry runs are only available for drafts and the approved version.`}
          </EmptyState>
        </Card>
      ) : (
        <DryRunResult run={current} sameChecksum={dryRuns.filter((r) => r.checksum === current.checksum).length} />
      )}
    </>
  );
}

function DryRunResult({ run, sameChecksum }: { run: Run; sameChecksum: number }) {
  const c = run.counts!;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Source" value={c.source} hint="records read" />
        <Stat label="Transformed" value={c.transformed} hint={`${c.source - c.transformed} failed a transformation step`} tone="brand" />
        <Stat label="Accepted" value={c.accepted} hint={`${pct(c.accepted, c.source)} of source`} tone="green" />
        <Stat label="Quarantined" value={c.rejected} hint={`${c.rejectedAtTransform} transform · ${c.rejectedAtValidation} validation · ${c.rejectedAsDuplicate} duplicate`} tone={c.rejected ? "red" : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          Run {fmtTime(run.startedAt)} by {run.triggeredBy}
        </span>
        <span>
          Checksum <Mono>{short(run.checksum, 16)}</Mono>
        </span>
        <span>
          Plan hash <Mono>{short(run.planHash, 12)}</Mono>
        </span>
        {sameChecksum > 1 && <Badge tone="green">Reproduced identically {sameChecksum}×</Badge>}
        <span className="text-zinc-400">source = accepted + quarantined: {c.source === c.accepted + c.rejected ? "✓" : "✗"}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rejections by reason" />
          <BarList data={run.errorsByCode ?? {}} mono />
        </Card>
        <Card>
          <CardHeader title="Rejections by target field" />
          <BarList data={run.errorsByField ?? {}} mono />
        </Card>
      </div>

      <RecordsTable run={run} />
    </div>
  );
}

function BarList({ data, mono }: { data: Record<string, number>; mono?: boolean }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return <div className="px-5 py-6 text-sm text-zinc-500">No rejections.</div>;
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <ul className="space-y-2 px-5 py-4">
      {entries.map(([k, n]) => (
        <li key={k} className="grid grid-cols-[minmax(0,180px)_1fr_32px] items-center gap-3 text-xs">
          <span className={clsx("truncate text-zinc-700", mono && "font-mono")}>{k}</span>
          <span className="h-2 rounded-full bg-zinc-100">
            <span className="block h-2 rounded-full bg-red-400" style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-zinc-600">{n}</span>
        </li>
      ))}
    </ul>
  );
}

function RecordsTable({ run }: { run: Run }) {
  const { meta } = useWorkbench();
  const [status, setStatus] = useState<"rejected" | "accepted">("rejected");
  const [field, setField] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const limit = 25;
  const q = useQuery({
    queryKey: ["runRecords", run.id, status, field, offset],
    queryFn: () => api.runRecords(run.id, { status, field: field || undefined, limit, offset }),
    placeholderData: (p) => p,
  });
  const fieldsWithErrors = Object.keys(run.errorsByField ?? {}).sort();

  return (
    <Card>
      <CardHeader
        title={status === "rejected" ? "Quarantine" : "Accepted records (transformed output)"}
        description={status === "rejected" ? "Every quarantined record with the field, rule, error code and the exact input value that failed." : "What would be written to the target."}
        actions={
          <>
            <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-sm">
              {(["rejected", "accepted"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatus(s);
                    setOffset(0);
                    setOpen(null);
                  }}
                  className={clsx("rounded-md px-3 py-1", status === s ? "bg-white font-medium shadow-sm" : "text-zinc-600")}
                >
                  {s === "rejected" ? `Quarantined (${run.counts!.rejected})` : `Accepted (${run.counts!.accepted})`}
                </button>
              ))}
            </div>
            {status === "rejected" && (
              <select
                className="h-8 rounded-lg border-0 py-0 pr-8 pl-2.5 text-sm ring-1 ring-zinc-300"
                value={field}
                onChange={(e) => {
                  setField(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">All fields</option>
                {fieldsWithErrors.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />
      {q.error && (
        <div className="p-4">
          <ErrorBanner error={q.error} />
        </div>
      )}
      <div className="overflow-x-auto scrollbar-thin">
        {status === "rejected" ? (
          <table className="w-full min-w-[820px]">
            <thead className="bg-zinc-50/70">
              <tr>
                <Th className="w-8" />
                <Th>Row</Th>
                <Th>Source key</Th>
                <Th>Field</Th>
                <Th>Error</Th>
                <Th>Input value</Th>
                <Th>Stage / rule</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {q.data?.items.map((r) => (
                <Fragment key={r.id}>
                  {r.errors.map((e, i) => (
                    <tr key={i} className={clsx("hover:bg-zinc-50/60", i === 0 && "cursor-pointer")} onClick={() => i === 0 && setOpen(open === r.rowNumber ? null : r.rowNumber)}>
                      <Td>{i === 0 && <ChevronRight className={clsx("size-4 text-zinc-300 transition-transform", open === r.rowNumber && "rotate-90")} />}</Td>
                      <Td className="tabular-nums text-zinc-500">{i === 0 ? r.rowNumber : ""}</Td>
                      <Td className="font-mono text-xs">{i === 0 ? (r.sourceKey ?? "∅") : ""}</Td>
                      <Td className="font-mono text-xs">{e.field}</Td>
                      <Td>
                        <Badge tone="red">{e.code}</Badge>
                        <div className="mt-0.5 text-xs text-zinc-600">{e.message}</div>
                      </Td>
                      <Td className="max-w-[200px] truncate font-mono text-xs text-zinc-700">{display(e.input)}</Td>
                      <Td className="text-xs text-zinc-500">
                        {e.stage}
                        {e.rule && (
                          <>
                            {" "}
                            · <span className="font-mono">{e.rule}</span>
                            {e.step !== null && ` (step ${e.step + 1})`}
                          </>
                        )}
                      </Td>
                    </tr>
                  ))}
                  {open === r.rowNumber && (
                    <tr className="bg-zinc-50/60">
                      <Td />
                      <Td colSpan={6}>
                        <SourceRecord record={r} fields={meta.source.fields.map((f) => f.name)} />
                      </Td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[1000px]">
            <thead className="bg-zinc-50/70">
              <tr>
                <Th>Row</Th>
                {meta.target.fields.map((f) => (
                  <Th key={f.name} className="font-mono normal-case">
                    {f.name}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {q.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-50/60">
                  <Td className="tabular-nums text-zinc-500">{r.rowNumber}</Td>
                  {meta.target.fields.map((f) => (
                    <Td key={f.name} className={clsx("max-w-[180px] truncate font-mono text-xs", r.output?.[f.name] === null ? "text-zinc-300" : "text-zinc-700")}>
                      {r.output?.[f.name] === null ? "null" : String(r.output?.[f.name])}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {q.data && q.data.items.length === 0 && <div className="px-5 py-6 text-sm text-zinc-500">No records.</div>}
      {q.data && <Pager total={q.data.total} limit={limit} offset={offset} onChange={setOffset} />}
      {status === "rejected" && run.counts!.rejectedAsDuplicate > 0 && (
        <div className="border-t border-zinc-100 p-4">
          <Callout tone="info" title="Duplicate keys">
            When several source rows produce the same target key, the first row owns it and later rows are quarantined, even if the first row is itself rejected. A later copy is never
            silently promoted.
          </Callout>
        </div>
      )}
    </Card>
  );
}

function SourceRecord({ record, fields }: { record: RecordResult; fields: string[] }) {
  const failing = new Set(record.errors.flatMap((e) => e.sources));
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Original source row {record.rowNumber}</div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f} className={clsx("flex gap-2 rounded px-1.5 py-0.5 text-xs", failing.has(f) && "bg-red-50 ring-1 ring-red-200")}>
            <span className="w-24 shrink-0 font-mono text-zinc-500">{f}</span>
            <span className="min-w-0 break-words font-mono text-zinc-800">{display(record.source?.[f])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
