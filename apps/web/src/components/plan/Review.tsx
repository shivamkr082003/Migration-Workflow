import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, GitCompare, HelpCircle, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../../api/client";
import type { ClarificationQuestion, PlanContent, Version } from "../../api/types";
import { fmtTime, short } from "../../lib/format";
import { keys, useWorkbench } from "../../lib/workbench";
import { Badge, Button, Callout, Card, CardHeader, Dialog, ErrorBanner, errorToast, inputCls, Label, Mono, riskTone, Spinner, useToast } from "../ui";
import { stepSummary } from "./Mappings";

/* ---------- clarification questions ---------- */

export function QuestionsPanel({ questions, editable, onChange }: { questions: ClarificationQuestion[]; editable: boolean; onChange: (q: ClarificationQuestion[]) => void }) {
  if (!questions.length) return null;
  const open = questions.filter((q) => !q.answer?.trim()).length;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <HelpCircle className="size-4 text-brand-600" /> Clarification questions
          </span>
        }
        description={open ? `${open} unanswered. Blocking questions must be answered before approval.` : "All questions answered."}
      />
      <ul className="divide-y divide-zinc-100">
        {questions.map((q, i) => (
          <li key={q.id} className="px-5 py-3.5">
            <div className="mb-2 flex flex-wrap items-start gap-2">
              <span className="font-mono text-xs text-zinc-400">{q.id}</span>
              {q.blocking ? <Badge tone="red">blocking</Badge> : <Badge>advisory</Badge>}
              {q.related_fields.map((f) => <Mono key={f}>{f}</Mono>)}
            </div>
            <p className="mb-2 text-sm text-zinc-800">{q.question}</p>
            {editable ? (
              <textarea
                className={clsx(inputCls, "min-h-[52px] text-sm", q.blocking && !q.answer?.trim() && "ring-red-200")}
                placeholder={q.blocking ? "Required before approval" : "Optional"}
                value={q.answer ?? ""}
                onChange={(e) => onChange(questions.map((x, j) => (j === i ? { ...x, answer: e.target.value || null } : x)))}
              />
            ) : q.answer ? (
              <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-100">{q.answer}</div>
            ) : (
              <div className="text-sm italic text-zinc-400">Unanswered</div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------- validation issues ---------- */

export function IssuesList({ version }: { version: Version }) {
  const errors = version.issues.filter((i) => i.severity === "error");
  const warnings = version.issues.filter((i) => i.severity === "warning");
  if (!errors.length && !warnings.length) {
    return <Callout tone="success" title="Plan passes validation">Every target field is mapped with valid rules and types.</Callout>;
  }
  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <Callout tone="error" title={`${errors.length} error${errors.length > 1 ? "s" : ""} block approval`}>
          <ul className="mt-1 space-y-0.5 text-xs">
            {errors.map((i, k) => (
              <li key={k}>
                <span className="font-mono">{i.code}</span> · {i.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout tone="warn" title={`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}>
          <ul className="mt-1 space-y-0.5 text-xs">
            {warnings.map((i, k) => (
              <li key={k}>
                <span className="font-mono">{i.code}</span> · {i.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}

/* ---------- approval ---------- */

export function ApprovalCard({ version }: { version: Version }) {
  const { plan } = useWorkbench();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.version(version.id) }),
      qc.invalidateQueries({ queryKey: keys.plan(plan.id) }),
      qc.invalidateQueries({ queryKey: keys.runs(version.id) }),
      qc.invalidateQueries({ queryKey: keys.audit(plan.id) }),
    ]);
  };

  const dry = useMutation({
    mutationFn: () => api.dryRun(version.id),
    onSuccess: async (run) => {
      await refresh();
      toast({ tone: "success", title: "Dry run complete", body: `${run.counts?.accepted} accepted · ${run.counts?.rejected} quarantined` });
    },
    onError: (e) => toast(errorToast(e)),
  });

  const hasDry = !!version.latestDryRun && version.latestDryRun.planHash === version.contentHash;
  const errors = version.issues.filter((i) => i.severity === "error").length;
  const checks = [
    { ok: version.status === "draft" || version.status === "approved", label: version.status === "approved" ? "Approved" : version.status === "draft" ? "Draft awaiting review" : `Version is ${version.status}` },
    { ok: errors === 0, label: errors ? `${errors} validation error(s)` : "No validation errors" },
    { ok: hasDry, label: hasDry ? "Dry run reviewed" : "No dry run yet" },
    { ok: version.integrityOk, label: version.integrityOk ? "Content hash verified" : "Content hash mismatch" },
  ];

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand-600" /> Review & approval
          </span>
        }
      />
      <div className="space-y-4 p-5">
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-sm">
              {c.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <CircleDashed className="size-4 text-zinc-400" />}
              <span className={c.ok ? "text-zinc-700" : "text-zinc-500"}>{c.label}</span>
            </li>
          ))}
        </ul>

        {version.latestDryRun && (
          <div className="rounded-lg bg-zinc-50 px-3 py-2.5 text-xs ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-700">Latest dry run</span>
              <Link to={{ pathname: "/dry-run", search: location.search }} className="text-brand-600 hover:underline">
                View results
              </Link>
            </div>
            <div className="mt-1 text-zinc-600">
              <span className="text-emerald-700">{version.latestDryRun.counts.accepted} accepted</span> ·{" "}
              <span className="text-red-700">{version.latestDryRun.counts.rejected} quarantined</span> of {version.latestDryRun.counts.source}
            </div>
            <div className="mt-0.5 text-zinc-400">checksum {short(version.latestDryRun.checksum, 12)}</div>
          </div>
        )}

        {version.status === "approved" && (
          <Callout tone="success" title={`Approved by ${version.decidedBy}`}>
            {fmtTime(version.decidedAt)}
            {version.decisionNote && <div className="mt-1 italic">“{version.decisionNote}”</div>}
          </Callout>
        )}
        {version.status === "rejected" && (
          <Callout tone="error" title={`Rejected by ${version.decidedBy}`}>
            {version.decisionNote}
          </Callout>
        )}
        {version.status === "superseded" && <Callout tone="info" title="Superseded">A newer version was approved after this one.</Callout>}

        {(version.status === "draft" || version.status === "approved") && (
          <div className="flex flex-wrap gap-2">
            <Button icon={<FlaskConical className="size-4" />} loading={dry.isPending} onClick={() => dry.mutate()} variant={hasDry ? "secondary" : "primary"}>
              {hasDry ? "Re-run dry run" : "Run dry run"}
            </Button>
            {version.status === "draft" && (
              <>
                <Button variant="primary" disabled={version.approvalBlockers.length > 0} onClick={() => setApproveOpen(true)} icon={<ShieldCheck className="size-4" />}>
                  Approve…
                </Button>
                <Button variant="ghost" onClick={() => setRejectOpen(true)} icon={<XCircle className="size-4" />}>
                  Reject
                </Button>
              </>
            )}
          </div>
        )}
        {version.status === "draft" && version.approvalBlockers.length > 0 && (
          <ul className="space-y-1 text-xs text-zinc-500">
            {version.approvalBlockers.map((b) => (
              <li key={b} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-500" />
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ApproveDialog open={approveOpen} onClose={() => setApproveOpen(false)} version={version} onDone={refresh} />
      <RejectDialog open={rejectOpen} onClose={() => setRejectOpen(false)} version={version} onDone={refresh} />
    </Card>
  );
}

function ApproveDialog({ open, onClose, version, onDone }: { open: boolean; onClose: () => void; version: Version; onDone: () => Promise<void> }) {
  const toast = useToast();
  const highRisk = version.content.mappings.filter((m) => m.risk === "high");
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const allAcked = highRisk.every((m) => acked.has(m.target));
  const approve = useMutation({
    mutationFn: () => api.approve(version.id, highRisk.length > 0 && allAcked, note),
    onSuccess: async () => {
      await onDone();
      onClose();
      toast({ tone: "success", title: `v${version.version} approved`, body: "It can now be executed against the target." });
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Approve v${version.version}`}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!allAcked} loading={approve.isPending} onClick={() => approve.mutate()}>
            Approve plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-zinc-600">
          Approving locks this exact plan (hash <Mono>{short(version.contentHash, 12)}</Mono>) as the one allowed to run. Any later edit becomes a new version that needs its own approval. This tool
          does not make the business decisions for you: check the high-risk mappings below.
        </p>
        {highRisk.length > 0 && (
          <div>
            <Label>Confirm each high-risk mapping</Label>
            <ul className="space-y-2">
              {highRisk.map((m) => (
                <li key={m.target} className="rounded-lg px-3 py-2.5 ring-1 ring-zinc-200">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 rounded border-zinc-300 text-brand-600"
                      checked={acked.has(m.target)}
                      onChange={(e) => {
                        const next = new Set(acked);
                        if (e.target.checked) next.add(m.target);
                        else next.delete(m.target);
                        setAcked(next);
                      }}
                    />
                    <span className="min-w-0 text-sm">
                      <span className="font-mono font-medium">{m.target}</span> <Badge tone={riskTone(m.risk)}>{m.risk}</Badge>
                      <span className="block text-xs text-zinc-500">
                        {m.steps.map((s) => `${s.rule}(${stepSummary(s)})`).join(" → ")}
                      </span>
                      {m.risk_notes.map((n, i) => (
                        <span key={i} className="mt-0.5 block text-xs text-amber-800">
                          {n}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="block">
          <Label hint="optional, recorded in history">Approval note</Label>
          <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reviewed with data owner" />
        </label>
        <ErrorBanner error={approve.error} />
      </div>
    </Dialog>
  );
}

function RejectDialog({ open, onClose, version, onDone }: { open: boolean; onClose: () => void; version: Version; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const reject = useMutation({
    mutationFn: () => api.reject(version.id, reason),
    onSuccess: async () => {
      await onDone();
      onClose();
      toast({ tone: "info", title: `v${version.version} rejected` });
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Reject v${version.version}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={reject.isPending} onClick={() => reject.mutate()}>
            Reject
          </Button>
        </>
      }
    >
      <label className="block">
        <Label>Reason</Label>
        <textarea className={clsx(inputCls, "min-h-[80px]")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs to change?" />
      </label>
      <div className="mt-3">
        <ErrorBanner error={reject.error} />
      </div>
    </Dialog>
  );
}

/* ---------- diff ---------- */

export function DiffButton({ version }: { version: Version }) {
  const [open, setOpen] = useState(false);
  if (!version.parentVersionId) return null;
  return (
    <>
      <Button size="sm" icon={<GitCompare className="size-3.5" />} onClick={() => setOpen(true)}>
        Compare with parent
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Changes from parent version" wide>
        {open && <DiffBody id={version.id} against={version.parentVersionId} />}
      </Dialog>
    </>
  );
}

function DiffBody({ id, against }: { id: string; against: string }) {
  const q = useQuery({ queryKey: ["diff", id, against], queryFn: () => api.diff(id, against) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const d = q.data!;
  const describe = (m: unknown) => {
    const x = m as PlanContent["mappings"][number] | undefined;
    return x ? `${x.sources.join(", ") || "∅"} → ${x.steps.map((s) => `${s.rule}(${stepSummary(s)})`).join(" → ")} [${x.risk}]` : "—";
  };
  return (
    <div className="space-y-4 text-sm">
      <p className="text-zinc-600">
        v{d.from.version} → v{d.to.version}
      </p>
      {d.mappings.length === 0 && d.questions.length === 0 && <p className="text-zinc-500">No mapping or question changes.</p>}
      {d.mappings.map((c) => (
        <div key={c.target} className="rounded-lg ring-1 ring-zinc-200">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
            <span className="font-mono font-medium">{c.target}</span>
            <Badge tone={c.change === "added" ? "green" : c.change === "removed" ? "red" : "amber"}>{c.change}</Badge>
          </div>
          <div className="space-y-1 px-3 py-2 font-mono text-xs">
            {c.before !== undefined && <div className="text-red-700">− {describe(c.before)}</div>}
            {c.after !== undefined && <div className="text-emerald-700">+ {describe(c.after)}</div>}
          </div>
        </div>
      ))}
      {d.questions.map((q) => {
        const before = q.before as ClarificationQuestion | null;
        const after = q.after as ClarificationQuestion;
        return (
          <div key={q.id} className="rounded-lg px-3 py-2 ring-1 ring-zinc-200">
            <div className="text-xs text-zinc-500">
              Question {q.id}: {after.question}
            </div>
            <div className="mt-1 text-xs">
              <span className="text-red-700">− {before?.answer ?? "unanswered"}</span>
              <br />
              <span className="text-emerald-700">+ {after.answer ?? "unanswered"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
