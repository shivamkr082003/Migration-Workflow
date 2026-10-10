import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, ChevronDown, ChevronRight, KeyRound, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import type { FieldProfile } from "../api/types";
import { Badge, Button, Card, CardHeader, ErrorBanner, Mono, PageHeader, Pager, Spinner, Stat, Td, Th } from "../components/ui";
import { useWorkbench } from "../lib/workbench";

export function OverviewPage() {
  const { meta, plan } = useWorkbench();
  const location = useLocation();
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.sourceProfile });
  const dupes = profile.data?.find((p) => p.field === meta.source.primaryKey);
  const duplicateKeys = dupes ? dupes.total - dupes.blank - dupes.distinct : 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Migrate ${meta.source.entity} into ${meta.target.entity}. Review the inputs here, then let the agent propose a mapping plan.`}
        actions={
          <Link to={{ pathname: "/plan", search: location.search }}>
            <Button variant="primary" icon={<Sparkles className="size-4" />}>
              {plan.versions.length ? "Open mapping plan" : "Generate a plan"}
            </Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Source records" value={meta.sampleSize} hint={`Documented maximum: ${meta.maxSampleSize}`} />
        <Stat label="Source fields" value={meta.source.fields.length} hint="All arrive as free text" />
        <Stat label="Target fields" value={meta.target.fields.length} hint={`${meta.target.fields.filter((f) => f.required).length} required`} />
        <Stat label="Duplicate keys" value={profile.data ? duplicateKeys : "…"} tone={duplicateKeys ? "amber" : undefined} hint={`Repeated ${meta.source.primaryKey} values`} />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[1fr_auto_1fr]">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2">Source · <Mono>{meta.source.entity}</Mono></span>} description={meta.source.description} />
          <table className="w-full">
            <thead className="bg-zinc-50/70">
              <tr>
                <Th>Field</Th>
                <Th>Type</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {meta.source.fields.map((f) => (
                <tr key={f.name}>
                  <Td>
                    <span className="flex items-center gap-1.5 font-mono text-[13px]">
                      {f.name === meta.source.primaryKey && <KeyRound className="size-3.5 text-amber-500" />}
                      {f.name}
                    </span>
                  </Td>
                  <Td className="text-zinc-500">{f.type}</Td>
                  <Td className="text-zinc-600">{f.description}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="hidden items-center xl:flex">
          <div className="flex size-9 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-zinc-200">
            <ArrowRight className="size-4 text-zinc-400" />
          </div>
        </div>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2">Target · <Mono>{meta.target.entity}</Mono></span>} description={meta.target.description} />
          <table className="w-full">
            <thead className="bg-zinc-50/70">
              <tr>
                <Th>Field</Th>
                <Th>Type</Th>
                <Th>Constraints</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {meta.target.fields.map((f) => (
                <tr key={f.name}>
                  <Td>
                    <span className="flex items-center gap-1.5 font-mono text-[13px]">
                      {f.name === meta.target.primaryKey && <KeyRound className="size-3.5 text-amber-500" />}
                      {f.name}
                    </span>
                  </Td>
                  <Td className="text-zinc-500">{f.type}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {f.required ? <Badge tone="brand">required</Badge> : <Badge>nullable</Badge>}
                      {f.format && <Badge>{f.format}</Badge>}
                      {f.enum && <Badge title={f.enum.join(", ")}>enum({f.enum.length})</Badge>}
                      {f.pattern && <Badge>pattern</Badge>}
                      {f.min !== undefined && <Badge>≥ {f.min}</Badge>}
                      {f.maxLength && <Badge>≤ {f.maxLength} chars</Badge>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Source field profiles" description="Distribution of values across every record. The agent uses the same profiles to choose formats and lookup tables." />
        {profile.isLoading ? <Spinner /> : profile.error ? <div className="p-4"><ErrorBanner error={profile.error} /></div> : <ProfileList profiles={profile.data!} />}
      </Card>

      <SampleRecords />
    </>
  );
}

function ProfileList({ profiles }: { profiles: FieldProfile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-zinc-100">
      {profiles.map((p) => {
        const isOpen = open === p.field;
        return (
          <div key={p.field}>
            <button onClick={() => setOpen(isOpen ? null : p.field)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-zinc-50">
              {isOpen ? <ChevronDown className="size-4 text-zinc-400" /> : <ChevronRight className="size-4 text-zinc-400" />}
              <span className="w-36 shrink-0 font-mono text-[13px]">{p.field}</span>
              <span className="flex flex-wrap gap-1.5 text-xs text-zinc-500">
                <Badge>{p.distinct} distinct</Badge>
                {p.blank > 0 && <Badge tone="amber">{p.blank} blank</Badge>}
                <Badge>{p.patterns.length} shape{p.patterns.length === 1 ? "" : "s"}</Badge>
              </span>
              <span className="ml-auto hidden truncate text-xs text-zinc-400 md:block">e.g. {p.topValues.slice(0, 3).map((v) => v.value).join(" · ")}</span>
            </button>
            {isOpen && (
              <div className="grid gap-6 bg-zinc-50/60 px-5 py-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Most frequent values</div>
                  <Bars items={p.topValues.map((v) => ({ label: v.value, count: v.count }))} total={p.total} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Value shapes (9 = digit, a = letters)</div>
                  <Bars items={p.patterns.map((v) => ({ label: v.pattern, count: v.count, note: v.example }))} total={p.total - p.blank} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Bars({ items, total }: { items: { label: string; count: number; note?: string }[]; total: number }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,1fr)_120px_36px] items-center gap-2 text-xs">
          <span className="truncate font-mono text-zinc-700" title={i.note ? `example: ${i.note}` : i.label}>
            {i.label}
          </span>
          <span className="h-1.5 rounded-full bg-zinc-200">
            <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${(i.count / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-zinc-500" title={`${((i.count / Math.max(total, 1)) * 100).toFixed(1)}%`}>
            {i.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SampleRecords() {
  const { meta } = useWorkbench();
  const [offset, setOffset] = useState(0);
  const limit = 15;
  const q = useQuery({ queryKey: ["sourceRecords", offset], queryFn: () => api.sourceRecords(limit, offset), placeholderData: (p) => p });
  return (
    <Card>
      <CardHeader title="Sample source records" description="Raw rows exactly as provided. Nothing here is modified by the workbench." />
      {q.error && <div className="p-4"><ErrorBanner error={q.error} /></div>}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px]">
          <thead className="bg-zinc-50/70">
            <tr>
              <Th>#</Th>
              {meta.source.fields.map((f) => (
                <Th key={f.name} className="font-mono normal-case">
                  {f.name}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {q.data?.items.map(({ row, record }) => (
              <tr key={row} className="hover:bg-zinc-50/60">
                <Td className="text-zinc-400 tabular-nums">{row}</Td>
                {meta.source.fields.map((f) => {
                  const v = record[f.name];
                  const blank = v === null || v === "";
                  return (
                    <Td key={f.name} className={clsx("max-w-[220px] truncate font-mono text-[12px]", blank ? "text-zinc-300" : "text-zinc-700")}>
                      <span title={String(v ?? "")}>{blank ? "∅" : String(v)}</span>
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data && <Pager total={q.data.total} limit={limit} offset={offset} onChange={setOffset} />}
    </Card>
  );
}
