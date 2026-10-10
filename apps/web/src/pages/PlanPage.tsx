import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, FileCheck2, Pencil, Save, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PlanContent, Version } from "../api/types";
import { AgentPanel } from "../components/plan/AgentPanel";
import { MappingEditor, MappingTable } from "../components/plan/Mappings";
import { ApprovalCard, DiffButton, IssuesList, QuestionsPanel } from "../components/plan/Review";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, errorToast, inputCls, Mono, PageHeader, Spinner, StatusBadge, useToast } from "../components/ui";
import { fmtTime, relTime, short } from "../lib/format";
import { keys, useWorkbench } from "../lib/workbench";

export function PlanPage() {
  const { plan, selected, meta } = useWorkbench();
  const version = useQuery({ queryKey: keys.version(selected?.id ?? ""), queryFn: () => api.version(selected!.id), enabled: !!selected });

  if (!selected) {
    return (
      <>
        <PageHeader title="Mapping plan" description="No plan exists yet. Ask the agent for a first proposal; you will review every mapping before anything runs." />
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <AgentPanel />
          <Card>
            <EmptyState icon={<FileCheck2 className="size-8" />} title="How this works">
              The agent inspects the {meta.source.entity} and {meta.target.entity} schemas, profiles the data and proposes a versioned plan. You answer its questions, run a dry run, and approve. Only an
              approved plan can be executed, and every step is recorded in History.
            </EmptyState>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Mapping plan" description={`${plan.versions.length} version${plan.versions.length > 1 ? "s" : ""}. Every edit or agent revision creates a new immutable version.`} />
      {version.isLoading ? <Spinner /> : version.error ? <ErrorBanner error={version.error} /> : <VersionView key={version.data!.id} version={version.data!} />}
    </>
  );
}

function VersionView({ version }: { version: Version }) {
  const { plan, meta, selectVersion } = useWorkbench();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<PlanContent | null>(null);
  const [editingMappings, setEditingMappings] = useState(false);
  const [note, setNote] = useState("");
  const content = draft ?? version.content;
  const dirty = draft !== null;
  const nextNumber = Math.max(...plan.versions.map((v) => v.version)) + 1;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api.createVersion(plan.id, content, version.id, note.trim() || (editingMappings ? "Edited mappings" : "Answered clarification questions")),
    onSuccess: async (v) => {
      await Promise.all([qc.invalidateQueries({ queryKey: keys.plan(plan.id) }), qc.invalidateQueries({ queryKey: keys.audit(plan.id) })]);
      setDraft(null);
      setEditingMappings(false);
      setNote("");
      selectVersion(v.id);
      toast({ tone: "success", title: `Saved as v${v.version}`, body: v.issues.some((i) => i.severity === "error") ? "It still has validation errors to fix." : "Run a dry run to review its results." });
    },
    onError: (e) => toast(errorToast(e)),
  });

  const highRisk = content.mappings.filter((m) => m.risk === "high").length;
  const avgConf = content.mappings.length ? content.mappings.reduce((a, m) => a + m.confidence, 0) / content.mappings.length : 0;
  const editable = version.status !== "rejected";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <Card>
          <div className="flex flex-wrap items-start gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">v{version.version}</h2>
                <StatusBadge status={version.status} />
                <Badge tone={version.origin === "agent" ? "brand" : "zinc"}>
                  {version.origin === "agent" ? <Bot className="size-3" /> : <UserRound className="size-3" />}
                  {version.origin === "agent" ? "AI proposal" : "Reviewer edit"}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Created by {version.createdBy} · {fmtTime(version.createdAt)} ({relTime(version.createdAt)}) · hash <Mono>{short(version.contentHash, 12)}</Mono>
                {version.parentVersionId && <> · based on v{plan.versions.find((v) => v.id === version.parentVersionId)?.version ?? "?"}</>}
              </div>
              {version.note && <div className="mt-1 text-xs italic text-zinc-500">“{version.note}”</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <DiffButton version={version} />
              {editable && !editingMappings && (
                <Button
                  size="sm"
                  icon={<Pencil className="size-3.5" />}
                  onClick={() => {
                    setDraft(structuredClone(content));
                    setEditingMappings(true);
                  }}
                >
                  Edit mappings
                </Button>
              )}
            </div>
          </div>
          {content.summary && <div className="border-t border-zinc-100 px-5 py-3 text-sm text-zinc-700">{content.summary}</div>}
          <div className="grid grid-cols-3 divide-x divide-zinc-100 border-t border-zinc-100 text-center">
            <div className="px-3 py-2.5">
              <div className="text-lg font-semibold tabular-nums">
                {content.mappings.length}/{meta.target.fields.length}
              </div>
              <div className="text-xs text-zinc-500">fields mapped</div>
            </div>
            <div className="px-3 py-2.5">
              <div className={`text-lg font-semibold tabular-nums ${highRisk ? "text-red-600" : ""}`}>{highRisk}</div>
              <div className="text-xs text-zinc-500">high-risk mappings</div>
            </div>
            <div className="px-3 py-2.5">
              <div className="text-lg font-semibold tabular-nums">{Math.round(avgConf * 100)}%</div>
              <div className="text-xs text-zinc-500">avg. confidence</div>
            </div>
          </div>
        </Card>

        {!dirty && <IssuesList version={version} />}

        <Card>
          <CardHeader
            title="Field mappings"
            description={editingMappings ? "Edit sources, steps and parameters. The server validates everything when you save." : "Click a row for the target definition, risk notes and step parameters."}
          />
          {editingMappings ? <MappingEditor content={content} onChange={setDraft} /> : <MappingTable content={content} target={meta.target} />}
        </Card>

        <QuestionsPanel questions={content.questions} editable={editable} onChange={(questions) => setDraft({ ...content, questions })} />

        {dirty && (
          <div className="sticky bottom-4 z-10">
            <Card className="flex flex-wrap items-center gap-3 px-4 py-3 shadow-lg ring-brand-200">
              <span className="text-sm font-medium">Unsaved changes</span>
              <span className="text-xs text-zinc-500">Saving creates v{nextNumber}, based on v{version.version}. v{version.version} stays unchanged.</span>
              <input className={`${inputCls} max-w-xs flex-1`} placeholder="Change note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="ml-auto flex gap-2">
                <Button
                  onClick={() => {
                    setDraft(null);
                    setEditingMappings(false);
                  }}
                >
                  Discard
                </Button>
                <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>
                  Save as v{nextNumber}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <ApprovalCard version={version} />
        <AgentPanel compact />
        <VersionList />
      </div>
    </div>
  );
}

function VersionList() {
  const { plan, selected, selectVersion } = useWorkbench();
  return (
    <Card>
      <CardHeader title="Versions" />
      <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto scrollbar-thin">
        {plan.versions.map((v) => (
          <li key={v.id}>
            <button onClick={() => selectVersion(v.id)} className={`flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-zinc-50 ${v.id === selected?.id ? "bg-brand-50/60" : ""}`}>
              <span className="w-8 font-mono text-sm font-semibold">v{v.version}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={v.status} />
                  {v.origin === "agent" && <Bot className="size-3.5 text-brand-500" />}
                </span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {v.createdBy} · {relTime(v.createdAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
