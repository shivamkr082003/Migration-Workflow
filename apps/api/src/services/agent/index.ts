import Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { agentRuns, type AgentTraceStep } from "../../db/schema.js";
import { notFound, unprocessable } from "../../errors.js";
import { logger } from "../../logger.js";
import { audit } from "../audit.js";
import { inputs, loadSourceRecords } from "../inputs.js";
import { createVersion, getPlan, getVersionRow } from "../plans.js";
import { AgentFailure, runClaudeAgent } from "./claude.js";
import { runHeuristicAgent } from "./heuristic.js";

export type AgentMode = "claude" | "heuristic";

export function availableModes(): { default: AgentMode; claude: boolean; model: string } {
  const claude = Boolean(config.ANTHROPIC_API_KEY);
  return { default: claude ? "claude" : "heuristic", claude, model: config.AGENT_MODEL };
}

/** Overridable in tests so the Claude loop can run against a scripted client. */
export const agentDeps = {
  createClient: (): Anthropic => new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }),
};

export interface StartAgentInput {
  planId: string;
  actor: string;
  mode?: AgentMode;
  guidance?: string | null;
  baseVersionId?: string | null;
}

/** Creates the run record and returns immediately; the agent works in the background. */
export async function startAgentRun(input: StartAgentInput) {
  await getPlan(input.planId);
  const modes = availableModes();
  const mode = input.mode ?? modes.default;
  if (mode === "claude" && !modes.claude) {
    throw unprocessable("CLAUDE_NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set on the server; use the offline heuristic agent or configure a key.");
  }
  const base = input.baseVersionId ? await getVersionRow(input.baseVersionId) : null;
  if (base && base.planId !== input.planId) throw unprocessable("PARENT_MISMATCH", "Base version belongs to another plan");

  const [run] = await db
    .insert(agentRuns)
    .values({ planId: input.planId, mode, model: mode === "claude" ? config.AGENT_MODEL : null, guidance: input.guidance ?? null, baseVersionId: base?.id ?? null, requestedBy: input.actor })
    .returning();
  await audit(db, { actor: input.actor, action: "agent.started", planId: input.planId, agentRunId: run!.id, details: { mode, baseVersionId: base?.id ?? null, guidance: input.guidance ?? null } });

  const done = executeAgentRun(run!.id, input, mode, base?.content ?? null).catch((err) => logger.error({ err, agentRunId: run!.id }, "agent run crashed"));
  return { run: run!, done };
}

async function executeAgentRun(runId: string, input: StartAgentInput, mode: AgentMode, basePlan: unknown) {
  const { source, target } = inputs();
  const ctx = { source, target, records: await loadSourceRecords() };
  const trace: AgentTraceStep[] = [];
  const onStep = async (s: AgentTraceStep) => {
    trace.push(s);
    await db.update(agentRuns).set({ trace }).where(eq(agentRuns.id, runId));
  };
  const log = logger.child({ agentRunId: runId, mode });
  const started = Date.now();

  try {
    let plan;
    let usage = null;
    if (mode === "claude") {
      const result = await runClaudeAgent({
        client: agentDeps.createClient(),
        model: config.AGENT_MODEL,
        maxTurns: config.AGENT_MAX_TURNS,
        ctx,
        guidance: input.guidance,
        basePlan: basePlan as never,
        onStep,
      });
      plan = result.plan;
      usage = result.usage;
    } else {
      plan = await runHeuristicAgent(ctx, onStep);
    }

    const version = await createVersion({
      planId: input.planId,
      content: plan,
      origin: "agent",
      actor: `agent:${mode}`,
      parentVersionId: input.baseVersionId ?? null,
      agentRunId: runId,
      note: input.guidance ? `Agent revision: ${input.guidance.slice(0, 200)}` : "Proposed by agent",
    });
    await db.update(agentRuns).set({ status: "succeeded", outputVersionId: version.id, usage, finishedAt: new Date(), trace }).where(eq(agentRuns.id, runId));
    await audit(db, { actor: `agent:${mode}`, action: "agent.succeeded", planId: input.planId, planVersionId: version.id, agentRunId: runId, details: { version: version.version, usage, durationMs: Date.now() - started } });
    log.info({ version: version.version, usage, durationMs: Date.now() - started }, "agent produced plan");
  } catch (err) {
    const message = describeAgentError(err);
    log.warn({ err }, "agent run failed");
    await onStep({ at: new Date().toISOString(), kind: "error", text: message }).catch(() => {});
    await db.update(agentRuns).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(agentRuns.id, runId));
    await audit(db, { actor: `agent:${mode}`, action: "agent.failed", planId: input.planId, agentRunId: runId, details: { error: message } });
  }
}

function describeAgentError(err: unknown): string {
  if (err instanceof AgentFailure) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "The model API is rate limiting requests. Try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the model API.";
  if (err instanceof Anthropic.APIError) return `Model API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export async function getAgentRun(id: string) {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
  if (!run) throw notFound("Agent run");
  return run;
}

export async function listAgentRuns(planId: string) {
  return db
    .select({
      id: agentRuns.id,
      mode: agentRuns.mode,
      model: agentRuns.model,
      status: agentRuns.status,
      guidance: agentRuns.guidance,
      error: agentRuns.error,
      outputVersionId: agentRuns.outputVersionId,
      requestedBy: agentRuns.requestedBy,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
      usage: agentRuns.usage,
    })
    .from(agentRuns)
    .where(eq(agentRuns.planId, planId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(30);
}
