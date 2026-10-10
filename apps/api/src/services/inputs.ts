import { readFileSync } from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { parseSourceRecords, SourceSchema, TargetSchema, type SourceRecord } from "@mw/core";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { plans, sourceRecords, targetCustomers } from "../db/schema.js";
import { audit } from "./audit.js";

export interface ProvidedInputs {
  source: SourceSchema;
  target: TargetSchema;
  records: SourceRecord[];
}

let cached: ProvidedInputs | null = null;

/** Loads and validates the provided input files. Fails fast on malformed inputs. */
export function inputs(): ProvidedInputs {
  if (cached) return cached;
  const read = (name: string) => JSON.parse(readFileSync(path.join(config.DATA_DIR, name), "utf8"));
  const source = SourceSchema.parse(read("source-schema.json"));
  const target = TargetSchema.parse(read("target-schema.json"));
  const records = parseSourceRecords(source, read("source-records.json"));
  assertTargetTableMatches(target);
  cached = { source, target, records };
  return cached;
}

/** The mock target table is typed; guard against the schema file and the table drifting apart. */
function assertTargetTableMatches(target: TargetSchema) {
  const columns = Object.values(targetCustomers).filter((c) => typeof c === "object" && c && "name" in c) as { name: string }[];
  const names = new Set(columns.map((c) => c.name));
  const missing = target.fields.filter((f) => !names.has(f.name)).map((f) => f.name);
  if (missing.length) throw new Error(`target_customers_v2 is missing columns for: ${missing.join(", ")}`);
}

/** Source records as stored in the staging table, in row order. Runs always read from here. */
export async function loadSourceRecords(): Promise<SourceRecord[]> {
  const rows = await db.select().from(sourceRecords).orderBy(asc(sourceRecords.rowNumber));
  return rows.map((r) => r.payload);
}

export async function seedIfEmpty() {
  const { source, target, records } = inputs();
  if ((await db.$count(sourceRecords)) === 0) {
    await db.insert(sourceRecords).values(
      records.map((payload, i) => ({ rowNumber: i + 1, sourceKey: payload[source.primaryKey] == null ? null : String(payload[source.primaryKey]), payload })),
    );
  }
  const existing = await db.select().from(plans).where(eq(plans.sourceEntity, source.entity)).limit(1);
  if (!existing.length) {
    const [plan] = await db
      .insert(plans)
      .values({ name: `${source.entity} → ${target.entity}`, sourceEntity: source.entity, targetEntity: target.entity })
      .returning();
    await audit(db, { actor: "system", action: "plan.created", planId: plan!.id, details: { name: plan!.name } });
  }
}
