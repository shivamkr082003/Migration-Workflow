import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { agentDeps, startAgentRun } from "../src/services/agent/index.js";
import { callTool, toolDefinitions } from "../src/services/agent/tools.js";
import { inputs } from "../src/services/inputs.js";
import { agentDraft, answeredVersion, get, planId, post } from "./helpers.js";

type Block = Record<string, unknown>;
type Scripted = { stop_reason: string; content: Block[]; stop_details?: unknown };

/** A fake Anthropic client that replays scripted assistant turns and records each request. */
function scriptedClient(turns: Scripted[]) {
  const requests: { messages: Anthropic.Beta.BetaMessageParam[]; tools: { name: string }[] }[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: { messages: Anthropic.Beta.BetaMessageParam[]; tools: { name: string }[] }) => {
          requests.push(structuredClone(params));
          const turn = turns.shift();
          if (!turn) throw new Error("script exhausted");
          return { finalMessage: async () => ({ ...turn, usage: { input_tokens: 100, output_tokens: 50 }, stop_details: turn.stop_details ?? null }) };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });

async function runClaude(turns: Scripted[], guidance?: string) {
  const { client, requests } = scriptedClient(turns);
  vi.spyOn(agentDeps, "createClient").mockReturnValue(client);
  const pid = await planId();
  const { run, done } = await startAgentRun({ planId: pid, actor: "Reviewer", mode: "claude", guidance });
  await done;
  return { run: (await get(`/agent-runs/${run.id}`)).body, requests, pid };
}

describe("agent tools", () => {
  const ctx = { ...inputs() };

  it("exposes only read-only inspection/validation tools plus submit_plan", () => {
    expect(toolDefinitions().map((t) => t.name)).toEqual([
      "inspect_source_schema",
      "inspect_target_schema",
      "list_transformation_rules",
      "sample_source_records",
      "profile_source_field",
      "validate_mapping",
      "submit_plan",
    ]);
  });

  it("returns errors to the model instead of throwing", () => {
    expect(callTool(ctx, "drop_table", {})).toMatchObject({ isError: true });
    expect(callTool(ctx, "profile_source_field", { fields: ["nope"] })).toMatchObject({ isError: true });
    expect(callTool(ctx, "sample_source_records", { limit: 500 })).toMatchObject({ isError: true });
  });

  it("labels record contents as untrusted data", () => {
    const res = callTool(ctx, "sample_source_records", { offset: 55, limit: 1 }) as { output: { note: string; rows: { record: { notes: string } }[] } };
    expect(res.output.note).toMatch(/untrusted/);
    expect(res.output.rows[0]!.record.notes).toMatch(/IGNORE ALL PREVIOUS INSTRUCTIONS/);
  });
});

describe("heuristic agent", () => {
  it("proposes a complete draft with risks and a blocking consent question, and never approves anything", async () => {
    const pid = await planId();
    const draft = await agentDraft(pid);
    expect(draft.status).toBe("draft");
    expect(draft.origin).toBe("agent");
    expect(draft.content.mappings).toHaveLength(inputs().target.fields.length);
    const consent = draft.content.mappings.find((m: { target: string }) => m.target === "marketing_opt_in");
    expect(consent.risk).toBe("high");
    expect(draft.content.questions.some((q: { blocking: boolean; related_fields: string[] }) => q.blocking && q.related_fields.includes("marketing_opt_in"))).toBe(true);
    expect(draft.content.summary).toMatch(/instruction-like text/);
    const run = (await get(`/plans/${pid}/agent-runs`)).body[0];
    const full = (await get(`/agent-runs/${run.id}`)).body;
    expect(full.trace.map((s: { tool: string }) => s.tool)).toContain("profile_source_field");
  });
});

describe("agent revisions", () => {
  it("carries the reviewer's answers into a heuristic revision", async () => {
    const pid = await planId();
    const v1 = await agentDraft(pid);
    const v2 = await answeredVersion(pid, v1);
    const { run, done } = await startAgentRun({ planId: pid, actor: "Reviewer", mode: "heuristic", baseVersionId: v2.id });
    await done;
    const out = (await get(`/agent-runs/${run.id}`)).body;
    const v3 = (await get(`/versions/${out.outputVersionId}`)).body;
    expect(v3.parentVersionId).toBe(v2.id);
    expect(v3.content.questions.filter((q: { blocking: boolean }) => q.blocking).every((q: { answer: string }) => q.answer === "Confirmed")).toBe(true);
    expect(v3.issues.filter((i: { severity: string }) => i.severity === "error")).toEqual([]);
  });
});

describe("claude agent loop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    config.ANTHROPIC_API_KEY = "";
  });

  it("is unavailable without an API key", async () => {
    const res = await post(`/plans/${await planId()}/agent-runs`, { mode: "claude" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CLAUDE_NOT_CONFIGURED");
  });

  it("feeds validation errors back, then saves the corrected plan as a draft with a full trace", async () => {
    config.ANTHROPIC_API_KEY = "test-key";
    const good = (await agentDraft(await planId())).content;
    const bad = { ...good, mappings: good.mappings.filter((m: { target: string }) => m.target !== "email") };

    const { run, requests } = await runClaude(
      [
        { stop_reason: "tool_use", content: [{ type: "text", text: "Profiling fields first." }, toolUse("t1", "profile_source_field", { fields: ["tier"] })] },
        { stop_reason: "tool_use", content: [toolUse("t2", "submit_plan", bad)] },
        { stop_reason: "tool_use", content: [toolUse("t3", "submit_plan", good)] },
      ],
      "Prefer day-first dates",
    );

    expect(run.status).toBe("succeeded");
    expect(run.usage).toEqual({ inputTokens: 300, outputTokens: 150, turns: 3 });
    expect(run.trace.filter((s: { kind: string }) => s.kind === "tool_call").map((s: { tool: string }) => s.tool)).toEqual(["profile_source_field", "submit_plan", "submit_plan"]);
    expect(run.trace.find((s: { tool: string; isError: boolean }) => s.tool === "submit_plan").isError).toBe(true);

    // The second request carried the profile result; the third carried the validation errors.
    const firstUser = requests[0]!.messages[0]!.content as string;
    expect(firstUser).toContain("<reviewer_guidance>");
    const errorResult = JSON.stringify(requests[2]!.messages.at(-1));
    expect(errorResult).toContain("UNMAPPED_REQUIRED_TARGET");
    expect(errorResult).toContain('"is_error":true');

    const version = (await get(`/versions/${run.outputVersionId}`)).body;
    expect(version).toMatchObject({ status: "draft", origin: "agent", agentRunId: run.id });
  });

  it("records a refusal as a failed run without creating a version", async () => {
    config.ANTHROPIC_API_KEY = "test-key";
    const { run, pid } = await runClaude([{ stop_reason: "refusal", content: [], stop_details: { type: "refusal", category: null, explanation: "declined" } }]);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/declined/);
    expect((await get(`/plans/${pid}`)).body.versions).toHaveLength(0);
  });

  it("nudges once when the model stops without submitting, then fails cleanly", async () => {
    config.ANTHROPIC_API_KEY = "test-key";
    const { run } = await runClaude([
      { stop_reason: "end_turn", content: [{ type: "text", text: "Here is my plan in prose." }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Still prose." }] },
    ]);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/without submitting/);
  });
});
