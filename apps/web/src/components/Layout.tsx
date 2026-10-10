import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRightLeft, Database, FileCheck2, FlaskConical, History, Menu, PlayCircle, RotateCcw, UserRound, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { getReviewer, setReviewer } from "../lib/reviewer";
import { useWorkbench } from "../lib/workbench";
import { Badge, Button, Dialog, errorToast, inputCls, Label, StatusBadge, useToast } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: Database, hint: "Schemas & source data" },
  { to: "/plan", label: "Mapping plan", icon: FileCheck2, hint: "AI proposal, review, approval" },
  { to: "/dry-run", label: "Dry run", icon: FlaskConical, hint: "Counts & quarantine" },
  { to: "/execute", label: "Execute", icon: PlayCircle, hint: "Load, reconcile, rollback" },
  { to: "/history", label: "History", icon: History, hint: "Audit trail" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { plan, selected, approved, selectVersion, meta } = useWorkbench();
  const [reviewer, setReviewerState] = useState(getReviewer());
  const [askName, setAskName] = useState(!getReviewer());
  const [navOpen, setNavOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => setNavOpen(false), [location.pathname]);

  const reset = useMutation({
    mutationFn: api.reset,
    onSuccess: async () => {
      setConfirmReset(false);
      await qc.invalidateQueries();
      toast({ tone: "success", title: "Workbench reset", body: "All plans, runs and target rows were cleared." });
    },
    onError: (e) => toast(errorToast(e)),
  });

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, hint }, i) => (
        <NavLink
          key={to}
          to={{ pathname: to, search: location.search }}
          end={to === "/"}
          className={({ isActive }) =>
            clsx("group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors", isActive ? "bg-white shadow-sm ring-1 ring-zinc-200" : "hover:bg-zinc-200/50")
          }
        >
          {({ isActive }) => (
            <>
              <span className={clsx("flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold", isActive ? "bg-brand-600 text-white" : "bg-zinc-200 text-zinc-600")}>
                {i < 4 ? i + 1 : <Icon className="size-3.5" />}
              </span>
              <span className="min-w-0">
                <span className={clsx("block text-sm font-medium", isActive ? "text-zinc-900" : "text-zinc-700")}>{label}</span>
                <span className="block truncate text-xs text-zinc-500">{hint}</span>
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className={clsx("fixed inset-y-0 left-0 z-40 w-[260px] border-r border-zinc-200 bg-zinc-100/80 backdrop-blur lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", navOpen ? "translate-x-0" : "-translate-x-full", "transition-transform")}>
        <div className="flex h-full flex-col p-4">
          <div className="mb-6 flex items-center gap-2.5 px-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ArrowRightLeft className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Migration Workbench</div>
              <div className="text-xs text-zinc-500">Plan · Validate · Reconcile</div>
            </div>
            <button className="ml-auto rounded p-1 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
              <X className="size-4" />
            </button>
          </div>
          {nav}
          <div className="mt-auto space-y-3 border-t border-zinc-200 pt-4 text-xs text-zinc-500">
            <div className="px-1">
              <div className="font-medium text-zinc-700">{plan.name}</div>
              <div>
                {meta.sampleSize} records · max {meta.maxSampleSize}
              </div>
              <div className="mt-1">Agent: {meta.agent.claude ? <Badge tone="brand">Claude · {meta.agent.model}</Badge> : <Badge>Offline heuristic</Badge>}</div>
            </div>
            {meta.features.reset && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirmReset(true)}>
                Reset demo data
              </Button>
            )}
          </div>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-zinc-900/30 lg:hidden" onClick={() => setNavOpen(false)} />}

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-1.5 hover:bg-zinc-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          {plan.versions.length > 0 ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden text-sm text-zinc-500 sm:inline">Version</span>
              <select
                value={selected?.id ?? ""}
                onChange={(e) => selectVersion(e.target.value)}
                className="h-8 max-w-[220px] rounded-lg border-0 bg-white py-0 pr-8 pl-2.5 text-sm font-medium shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-brand-500"
              >
                {plan.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {v.status}
                    {v.origin === "agent" ? " · AI" : ""}
                  </option>
                ))}
              </select>
              {selected && <StatusBadge status={selected.status} />}
              {approved && approved.id !== selected?.id && (
                <button className="hidden text-xs text-brand-600 hover:underline md:inline" onClick={() => selectVersion(approved.id)}>
                  Go to approved v{approved.version}
                </button>
              )}
            </div>
          ) : (
            <span className="text-sm text-zinc-500">No plan versions yet</span>
          )}
          <button onClick={() => setAskName(true)} className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100" title="Change reviewer name">
            <UserRound className="size-4" />
            <span className="max-w-[140px] truncate">{reviewer || "Set reviewer"}</span>
          </button>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>

      <ReviewerDialog
        open={askName}
        initial={reviewer}
        onSave={(n) => {
          setReviewer(n);
          setReviewerState(n);
          setAskName(false);
        }}
        onClose={() => reviewer && setAskName(false)}
      />

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset demo data?"
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
              Reset everything
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600">This deletes every plan version, run, agent run, audit event and target row, then reloads the provided sample data. Use it to start a fresh review.</p>
      </Dialog>
    </div>
  );
}

function ReviewerDialog({ open, initial, onSave, onClose }: { open: boolean; initial: string; onSave: (n: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const valid = name.trim().length >= 2;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Who is reviewing?"
      footer={
        <Button variant="primary" disabled={!valid} onClick={() => onSave(name.trim())}>
          Continue
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(name.trim());
        }}
      >
        <p className="mb-4 text-sm text-zinc-600">Your name is recorded on approvals, executions and rollbacks in the audit history. (This demo has no login.)</p>
        <label>
          <Label>Reviewer name</Label>
          <input autoFocus className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" />
        </label>
      </form>
    </Dialog>
  );
}
