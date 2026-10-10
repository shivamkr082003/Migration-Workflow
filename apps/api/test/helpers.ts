import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/http/app.js";
import { startAgentRun } from "../src/services/agent/index.js";

export const app = createApp();
export const api = () => request(app);

export const post = (path: string, body: unknown = {}, actor = "Reviewer") =>
  request(app).post(`/api${path}`).set("x-actor", actor).send(body as object);
export const get = (path: string) => request(app).get(`/api${path}`);

export async function planId(): Promise<string> {
  const res = await get("/plans");
  return res.body[0].id;
}

/** Runs the offline agent to completion and returns the draft version it produced. */
export async function agentDraft(pid: string) {
  const { run, done } = await startAgentRun({ planId: pid, actor: "Reviewer", mode: "heuristic" });
  await done;
  const finished = (await get(`/agent-runs/${run.id}`)).body;
  expect(finished.status).toBe("succeeded");
  return (await get(`/versions/${finished.outputVersionId}`)).body;
}

/** Answers blocking questions on a draft and saves it as a new version. */
export async function answeredVersion(pid: string, draft: { id: string; content: { questions: { blocking: boolean; answer: string | null }[] } }) {
  const content = structuredClone(draft.content);
  for (const q of content.questions) if (q.blocking) q.answer = "Confirmed";
  const res = await post(`/plans/${pid}/versions`, { content, parentVersionId: draft.id, note: "answers" });
  expect(res.status).toBe(201);
  return res.body;
}

/** draft → answered → dry run → approved. Returns the approved version id. */
export async function approvedVersion(pid?: string) {
  const p = pid ?? (await planId());
  const v = await answeredVersion(p, await agentDraft(p));
  expect((await post(`/versions/${v.id}/dry-runs`)).status).toBe(201);
  const approved = await post(`/versions/${v.id}/approve`, { acknowledgeHighRisk: true });
  expect(approved.status).toBe(200);
  return v.id as string;
}
