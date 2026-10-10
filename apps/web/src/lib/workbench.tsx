import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Meta, Plan, VersionSummary } from "../api/types";

interface Workbench {
  meta: Meta;
  plan: Plan;
  /** Version the user is looking at (from ?v=, defaulting to the newest). */
  selected: VersionSummary | null;
  /** The single approved version, if any. */
  approved: VersionSummary | null;
  selectVersion: (id: string) => void;
}

const Ctx = createContext<Workbench | null>(null);

export function useWorkbench() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkbench outside provider");
  return v;
}

export const keys = {
  meta: ["meta"],
  plans: ["plans"],
  plan: (id: string) => ["plan", id],
  version: (id: string) => ["version", id],
  runs: (versionId?: string) => ["runs", versionId ?? "all"],
  reconciliation: (versionId: string) => ["reconciliation", versionId],
  audit: (planId: string) => ["audit", planId],
  agentRuns: (planId: string) => ["agentRuns", planId],
  target: ["target"],
};

export function WorkbenchProvider({ children, fallback }: { children: ReactNode; fallback: (state: { error: unknown }) => ReactNode }) {
  const [params, setParams] = useSearchParams();
  const meta = useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: Infinity });
  const plans = useQuery({ queryKey: keys.plans, queryFn: api.plans });
  const planId = plans.data?.[0]?.id;
  const plan = useQuery({ queryKey: keys.plan(planId ?? ""), queryFn: () => api.plan(planId!), enabled: !!planId });

  if (!meta.data || !plan.data) return <>{fallback({ error: meta.error ?? plans.error ?? plan.error })}</>;

  const versions = plan.data.versions;
  const wanted = params.get("v");
  const selected = versions.find((v) => v.id === wanted) ?? versions[0] ?? null;
  const approved = versions.find((v) => v.status === "approved") ?? null;
  const selectVersion = (id: string) =>
    setParams(
      (p) => {
        p.set("v", id);
        return p;
      },
      { replace: true },
    );

  return <Ctx.Provider value={{ meta: meta.data, plan: plan.data, selected, approved, selectVersion }}>{children}</Ctx.Provider>;
}
