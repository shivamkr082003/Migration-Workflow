import { Router } from "express";
import { z } from "zod";
import { MAX_SAMPLE_SIZE, profileField, ruleCatalog } from "@mw/core";
import { desc, eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { auditEvents } from "../db/schema.js";
import { AppError } from "../errors.js";
import { availableModes, getAgentRun, listAgentRuns, startAgentRun } from "../services/agent/index.js";
import { inputs, loadSourceRecords } from "../services/inputs.js";
import { approveVersion, createVersion, diffVersions, getPlan, getVersion, listPlans, rejectVersion } from "../services/plans.js";
import { dryRun, execute, getRun, getRunRecords, listRuns, listTargetRows, parseFaultInjection, reconcile, rollback } from "../services/runs.js";
import { resetDemo } from "../services/system.js";
import { actor, parse } from "./middleware.js";

const uuid = z.string().uuid();
const page = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });

export const api = Router();

api.get("/health", async (_req, res) => {
  await db.execute("select 1");
  res.json({ status: "ok" });
});

api.get("/meta", (_req, res) => {
  const { source, target, records } = inputs();
  res.json({
    source,
    target,
    rules: ruleCatalog(),
    sampleSize: records.length,
    maxSampleSize: MAX_SAMPLE_SIZE,
    agent: availableModes(),
    features: { faultInjection: config.ALLOW_FAULT_INJECTION, reset: config.ALLOW_RESET },
  });
});

/* ---------- source data ---------- */

api.get("/source/records", async (req, res) => {
  const q = parse(page, req.query);
  const records = await loadSourceRecords();
  res.json({ total: records.length, items: records.slice(q.offset, q.offset + q.limit).map((record, i) => ({ row: q.offset + i + 1, record })) });
});

api.get("/source/profile", async (_req, res) => {
  const records = await loadSourceRecords();
  res.json(inputs().source.fields.map((f) => profileField(records, f.name, 15)));
});

/* ---------- plans & versions ---------- */

api.get("/plans", async (_req, res) => res.json(await listPlans()));
api.get("/plans/:planId", async (req, res) => res.json(await getPlan(parse(uuid, req.params.planId))));

api.post("/plans/:planId/versions", async (req, res) => {
  const body = parse(z.object({ content: z.unknown(), parentVersionId: uuid.nullish(), note: z.string().max(500).nullish() }), req.body);
  const v = await createVersion({ planId: parse(uuid, req.params.planId), content: body.content as never, origin: "user", actor: actor(req), parentVersionId: body.parentVersionId, note: body.note });
  res.status(201).json(await getVersion(v.id));
});

api.get("/versions/:id", async (req, res) => res.json(await getVersion(parse(uuid, req.params.id))));

api.get("/versions/:id/diff", async (req, res) => {
  const against = parse(z.object({ against: uuid }), req.query).against;
  res.json(await diffVersions(against, parse(uuid, req.params.id)));
});

api.post("/versions/:id/approve", async (req, res) => {
  const body = parse(z.object({ note: z.string().max(500).optional(), acknowledgeHighRisk: z.boolean().default(false) }), req.body ?? {});
  await approveVersion(parse(uuid, req.params.id), { actor: actor(req), ...body });
  res.json(await getVersion(req.params.id));
});

api.post("/versions/:id/reject", async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  await rejectVersion(parse(uuid, req.params.id), actor(req), body.reason);
  res.json(await getVersion(req.params.id));
});

/* ---------- agent ---------- */

api.post("/plans/:planId/agent-runs", async (req, res) => {
  const body = parse(
    z.object({ mode: z.enum(["claude", "heuristic"]).optional(), guidance: z.string().max(2000).nullish(), baseVersionId: uuid.nullish() }),
    req.body ?? {},
  );
  const { run } = await startAgentRun({ planId: parse(uuid, req.params.planId), actor: actor(req), ...body });
  res.status(202).json(run);
});
api.get("/plans/:planId/agent-runs", async (req, res) => res.json(await listAgentRuns(parse(uuid, req.params.planId))));
api.get("/agent-runs/:id", async (req, res) => res.json(await getAgentRun(parse(uuid, req.params.id))));

/* ---------- runs ---------- */

api.post("/versions/:id/dry-runs", async (req, res) => {
  res.status(201).json(await dryRun(parse(uuid, req.params.id), actor(req)));
});

api.post("/versions/:id/executions", async (req, res) => {
  const body = parse(z.object({ faultInjection: z.unknown().optional() }), req.body ?? {});
  const run = await execute(parse(uuid, req.params.id), actor(req), { faultInjection: parseFaultInjection(body.faultInjection) });
  res.status(201).json(run);
});

api.post("/versions/:id/rollback", async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  res.json(await rollback(parse(uuid, req.params.id), actor(req), body.reason));
});

api.get("/versions/:id/reconciliation", async (req, res) => res.json(await reconcile(parse(uuid, req.params.id))));

api.get("/runs", async (req, res) => {
  const q = parse(z.object({ versionId: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
  res.json(await listRuns(q));
});
api.get("/runs/:id", async (req, res) => res.json(await getRun(parse(uuid, req.params.id))));
api.get("/runs/:id/records", async (req, res) => {
  const q = parse(page.extend({ status: z.enum(["accepted", "rejected"]).optional(), field: z.string().max(100).optional() }), req.query);
  res.json(await getRunRecords(parse(uuid, req.params.id), q));
});

/* ---------- target & history ---------- */

api.get("/target/rows", async (req, res) => {
  const q = parse(page, req.query);
  res.json(await listTargetRows(q.limit, q.offset));
});

api.get("/audit-events", async (req, res) => {
  const q = parse(z.object({ planId: uuid.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
  const rows = await db
    .select()
    .from(auditEvents)
    .where(q.planId ? eq(auditEvents.planId, q.planId) : undefined)
    .orderBy(desc(auditEvents.id))
    .limit(q.limit);
  res.json(rows);
});

api.post("/admin/reset", async (req, res) => {
  if (!config.ALLOW_RESET) throw new AppError(403, "RESET_DISABLED", "Resetting is disabled on this deployment.");
  await resetDemo(actor(req));
  res.json({ status: "reset" });
});
