import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronRight, KeyRound, Plus, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import type { FieldMapping, PlanContent, RuleStep, TargetSchema } from "../../api/types";
import { useWorkbench } from "../../lib/workbench";
import { Badge, Button, inputCls, Mono, riskTone, Td, Th } from "../ui";

export function stepSummary(step: RuleStep): string {
  const p = step.params as Record<string, unknown>;
  switch (step.rule) {
    case "parse_date":
      return `${(p.formats as string[] | undefined)?.join(" | ") ?? ""}${p.on_ambiguous === "first_match" ? " (first match)" : ""}`;
    case "enum_map":
      return `${Object.keys((p.mapping as object) ?? {}).length} entries${p.fallback ? `, fallback ${p.fallback}` : ""}`;
    case "to_boolean":
      return `true: ${(p.true_values as string[] | undefined)?.join(",")} / false: ${(p.false_values as string[] | undefined)?.join(",")}`;
    case "normalize_phone":
      return `+${p.default_country_code}`;
    case "default_value":
      return JSON.stringify(p.value);
    case "split_name":
      return String(p.part);
    default:
      return Object.keys(p ?? {}).length ? JSON.stringify(p) : "";
  }
}

function StepChips({ steps }: { steps: RuleStep[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((s, i) => {
        const summary = stepSummary(s);
        return (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3 text-zinc-300" />}
            <span className="inline-flex max-w-[260px] items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs" title={JSON.stringify(s.params)}>
              <span className="font-mono font-medium text-zinc-800">{s.rule}</span>
              {summary && <span className="truncate text-zinc-500">{summary}</span>}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Read-only view: one row per target field, in target-schema order, including unmapped fields. */
export function MappingTable({ content, target }: { content: PlanContent; target: TargetSchema }) {
  const [open, setOpen] = useState<string | null>(null);
  const byTarget = new Map(content.mappings.map((m) => [m.target, m]));
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[640px]">
        <thead className="bg-zinc-50/70">
          <tr>
            <Th className="w-8" />
            <Th>Target field</Th>
            <Th>Source</Th>
            <Th>Transformation</Th>
            <Th>Risk</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {target.fields.map((tf) => {
            const m = byTarget.get(tf.name);
            const isOpen = open === tf.name;
            return (
              <Fragment key={tf.name}>
                <tr className={clsx("cursor-pointer hover:bg-zinc-50/70", !m && tf.required && "bg-red-50/40")} onClick={() => setOpen(isOpen ? null : tf.name)}>
                  <Td>
                    <ChevronRight className={clsx("size-4 text-zinc-300 transition-transform", isOpen && "rotate-90")} />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5 font-mono text-[13px] font-medium">
                      {tf.name === target.primaryKey && <KeyRound className="size-3.5 text-amber-500" />}
                      {tf.name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {tf.type}
                      {tf.required ? " · required" : ""}
                    </div>
                  </Td>
                  <Td>
                    {m ? (
                      m.sources.length ? (
                        <div className="flex flex-wrap gap-1">{m.sources.map((s) => <Mono key={s}>{s}</Mono>)}</div>
                      ) : (
                        <span className="text-xs italic text-zinc-500">no source (constant)</span>
                      )
                    ) : (
                      <Badge tone={tf.required ? "red" : "zinc"}>unmapped</Badge>
                    )}
                  </Td>
                  <Td>{m && <StepChips steps={m.steps} />}</Td>
                  <Td>
                    {m && (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={riskTone(m.risk)}>{m.risk}</Badge>
                        <span className="text-xs tabular-nums text-zinc-500">{Math.round(m.confidence * 100)}% conf.</span>
                        {m.risk_notes.length > 0 && <span className="text-xs whitespace-nowrap text-amber-700">{m.risk_notes.length} note{m.risk_notes.length > 1 ? "s" : ""}</span>}
                      </div>
                    )}
                  </Td>
                </tr>
                {isOpen && (
                  <tr className="bg-zinc-50/60">
                    <Td />
                    <Td colSpan={4}>
                      <div className="grid gap-4 py-1 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Target definition</div>
                          <p className="text-sm text-zinc-600">{tf.description}</p>
                          {tf.enum && <p className="mt-1 text-xs text-zinc-500">Allowed: {tf.enum.join(", ")}</p>}
                          {tf.pattern && <p className="mt-1 text-xs text-zinc-500">Pattern: <Mono>{tf.pattern}</Mono></p>}
                          {m && m.risk_notes.length > 0 && (
                            <>
                              <div className="mt-3 mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Risk notes</div>
                              <ul className="list-disc space-y-0.5 pl-4 text-sm text-amber-800">
                                {m.risk_notes.map((n, i) => <li key={i}>{n}</li>)}
                              </ul>
                            </>
                          )}
                          {m?.rationale && (
                            <>
                              <div className="mt-3 mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Rationale</div>
                              <p className="text-sm text-zinc-700">{m.rationale}</p>
                            </>
                          )}
                        </div>
                        {m && (
                          <div className="min-w-0">
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Steps (executed in order)</div>
                            <pre className="max-h-64 overflow-auto rounded-md bg-white p-2 font-mono text-[11px] text-zinc-700 ring-1 ring-zinc-200 scrollbar-thin">
                              {JSON.stringify(m.steps, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </Td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {content.ignored_source_fields.length > 0 && (
        <div className="border-t border-zinc-100 px-5 py-3 text-sm text-zinc-600">
          <span className="font-medium text-zinc-700">Ignored source fields: </span>
          {content.ignored_source_fields.map((f, i) => (
            <span key={f.field}>
              {i > 0 && " · "}
              <Mono>{f.field}</Mono> <span className="text-zinc-500">({f.reason})</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- editor ---------------- */

const emptyMapping = (target: string): FieldMapping => ({ target, sources: [], steps: [{ rule: "copy", params: {} }], rationale: "", risk: "medium", risk_notes: [], confidence: 1 });

export function MappingEditor({ content, onChange }: { content: PlanContent; onChange: (c: PlanContent) => void }) {
  const { meta } = useWorkbench();
  const byTarget = new Map(content.mappings.map((m) => [m.target, m]));
  const setMapping = (target: string, m: FieldMapping | null) => {
    const others = content.mappings.filter((x) => x.target !== target);
    const next = m ? [...others, m] : others;
    const order = meta.target.fields.map((f) => f.name);
    next.sort((a, b) => order.indexOf(a.target) - order.indexOf(b.target));
    onChange({ ...content, mappings: next });
  };
  const used = new Set(content.mappings.flatMap((m) => m.sources));

  return (
    <div className="divide-y divide-zinc-100">
      {meta.target.fields.map((tf) => {
        const m = byTarget.get(tf.name);
        return (
          <div key={tf.name} className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium">{tf.name}</span>
              <span className="text-xs text-zinc-500">
                {tf.type}
                {tf.required ? " · required" : ""}
              </span>
              <span className="ml-auto">
                {m ? (
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setMapping(tf.name, null)}>
                    Remove mapping
                  </Button>
                ) : (
                  <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setMapping(tf.name, emptyMapping(tf.name))}>
                    Add mapping
                  </Button>
                )}
              </span>
            </div>
            {m && <MappingFields mapping={m} onChange={(next) => setMapping(tf.name, next)} />}
          </div>
        );
      })}
      <div className="px-5 py-4">
        <div className="mb-2 text-sm font-medium">Ignored source fields</div>
        <div className="flex flex-wrap gap-3">
          {meta.source.fields.map((f) => {
            const ignored = content.ignored_source_fields.find((x) => x.field === f.name);
            return (
              <label key={f.name} className={clsx("flex items-center gap-1.5 text-sm", used.has(f.name) && "opacity-40")}>
                <input
                  type="checkbox"
                  disabled={used.has(f.name)}
                  checked={!!ignored}
                  className="size-4 rounded border-zinc-300 text-brand-600"
                  onChange={(e) =>
                    onChange({
                      ...content,
                      ignored_source_fields: e.target.checked
                        ? [...content.ignored_source_fields, { field: f.name, reason: "Not needed in the target" }]
                        : content.ignored_source_fields.filter((x) => x.field !== f.name),
                    })
                  }
                />
                <span className="font-mono text-[13px]">{f.name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MappingFields({ mapping, onChange }: { mapping: FieldMapping; onChange: (m: FieldMapping) => void }) {
  const { meta } = useWorkbench();
  const set = (patch: Partial<FieldMapping>) => onChange({ ...mapping, ...patch });
  const setStep = (i: number, s: RuleStep | null) => {
    const steps = [...mapping.steps];
    if (s) steps[i] = s;
    else steps.splice(i, 1);
    set({ steps });
  };
  const move = (i: number, d: -1 | 1) => {
    const steps = [...mapping.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + d, 0, s!);
    set({ steps });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_220px]">
      <div>
        <div className="mb-1.5 text-xs font-medium text-zinc-500">Source fields</div>
        <div className="space-y-1">
          {meta.source.fields.map((f) => (
            <label key={f.name} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-zinc-300 text-brand-600"
                checked={mapping.sources.includes(f.name)}
                onChange={(e) => set({ sources: e.target.checked ? [...mapping.sources, f.name] : mapping.sources.filter((s) => s !== f.name) })}
              />
              <span className="font-mono text-[13px]">{f.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-1.5 text-xs font-medium text-zinc-500">Steps</div>
        <div className="space-y-2">
          {mapping.steps.map((s, i) => (
            <StepEditor
              key={`${i}-${s.rule}`}
              step={s}
              index={i}
              count={mapping.steps.length}
              onChange={(next) => setStep(i, next)}
              onMove={(d) => move(i, d)}
            />
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => set({ steps: [...mapping.steps, { rule: "trim", params: {} }] })}>
            Add step
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Risk</span>
          <select className={inputCls} value={mapping.risk} onChange={(e) => set({ risk: e.target.value as FieldMapping["risk"] })}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Rationale</span>
          <textarea className={clsx(inputCls, "min-h-[72px] text-xs")} value={mapping.rationale} onChange={(e) => set({ rationale: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

function StepEditor({ step, index, count, onChange, onMove }: { step: RuleStep; index: number; count: number; onChange: (s: RuleStep | null) => void; onMove: (d: -1 | 1) => void }) {
  const { meta } = useWorkbench();
  const [text, setText] = useState(JSON.stringify(step.params ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const rule = meta.rules.find((r) => r.id === step.rule);
  return (
    <div className="rounded-lg ring-1 ring-zinc-200">
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/70 px-2.5 py-1.5">
        <span className="text-xs tabular-nums text-zinc-400">{index + 1}</span>
        <select
          className="h-7 rounded-md border-0 bg-white py-0 pr-7 pl-2 font-mono text-xs ring-1 ring-zinc-300"
          value={step.rule}
          onChange={(e) => {
            setText("{}");
            setJsonError(null);
            onChange({ rule: e.target.value as RuleStep["rule"], params: {} });
          }}
        >
          {meta.rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        <span className="hidden truncate text-xs text-zinc-500 md:block">{rule?.label}</span>
        <span className="ml-auto flex gap-0.5">
          <button className="rounded p-1 text-zinc-400 hover:bg-zinc-200 disabled:opacity-30" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="size-3.5" />
          </button>
          <button className="rounded p-1 text-zinc-400 hover:bg-zinc-200 disabled:opacity-30" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="size-3.5" />
          </button>
          <button className="rounded p-1 text-zinc-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-30" disabled={count === 1} onClick={() => onChange(null)} aria-label="Remove step">
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </div>
      <div className="p-2">
        <textarea
          spellCheck={false}
          className={clsx("block w-full resize-y rounded-md border-0 bg-white px-2 py-1.5 font-mono text-[11px] ring-1 ring-inset focus:ring-2", jsonError ? "ring-red-300 focus:ring-red-500" : "ring-zinc-200 focus:ring-brand-500")}
          rows={Math.min(8, Math.max(1, text.split("\n").length))}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            try {
              const params = JSON.parse(e.target.value || "{}");
              setJsonError(null);
              onChange({ ...step, params });
            } catch (err) {
              setJsonError((err as Error).message);
            }
          }}
        />
        {jsonError ? <div className="mt-1 text-[11px] text-red-600">Invalid JSON: {jsonError}</div> : <div className="mt-1 text-[11px] text-zinc-400">{rule?.description}</div>}
      </div>
    </div>
  );
}
