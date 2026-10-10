import { sha256 } from "./hash.js";
import { planHash, type PlanContent } from "./plan.js";
import { getRule, type RuleOutcome, type RuleValue } from "./rules.js";
import type { Scalar, SourceRecord, SourceSchema, TargetField, TargetSchema } from "./schema.js";

export type Stage = "transform" | "validate" | "duplicate";

/** Field-level evidence for why a record was quarantined. */
export interface FieldError {
  stage: Stage;
  field: string;
  sources: string[];
  step: number | null;
  rule: string | null;
  code: string;
  message: string;
  input: RuleValue | null;
}

export type TargetRow = Record<string, Scalar>;

export interface RecordOutcome {
  row: number;
  sourceKey: string | null;
  targetKey: string | null;
  status: "accepted" | "rejected";
  output: TargetRow | null;
  errors: FieldError[];
}

export interface RunCounts {
  source: number;
  transformed: number;
  accepted: number;
  rejected: number;
  rejectedAtTransform: number;
  rejectedAtValidation: number;
  rejectedAsDuplicate: number;
}

export interface MigrationReport {
  planHash: string;
  checksum: string;
  counts: RunCounts;
  errorsByCode: Record<string, number>;
  errorsByField: Record<string, number>;
  outcomes: RecordOutcome[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Applies every mapping to one record. Errors are collected per target field rather than stopping at the first. */
export function transformRecord(record: SourceRecord, plan: PlanContent, target: TargetSchema) {
  const output: TargetRow = Object.fromEntries(target.fields.map((f) => [f.name, null]));
  const errors: FieldError[] = [];

  for (const m of plan.mappings) {
    const input: RuleValue =
      m.sources.length === 0 ? null : m.sources.length === 1 ? (record[m.sources[0]!] ?? null) : m.sources.map((s) => record[s] ?? null);
    let value: RuleValue = input;
    let failed = false;

    for (const [i, step] of m.steps.entries()) {
      const rule = getRule(step.rule);
      const params = rule?.params.safeParse(step.params);
      if (!rule || !params?.success) {
        errors.push({ stage: "transform", field: m.target, sources: m.sources, step: i, rule: step.rule, code: "INVALID_STEP", message: `Step ${i} (${step.rule}) is not executable`, input: value });
        failed = true;
        break;
      }
      const res = (rule.apply as (v: RuleValue, p: unknown) => RuleOutcome)(value, params.data);
      if (!res.ok) {
        errors.push({ stage: "transform", field: m.target, sources: m.sources, step: i, rule: rule.id, code: res.code, message: res.message, input: value });
        failed = true;
        break;
      }
      value = res.value;
    }
    if (!failed) output[m.target] = Array.isArray(value) ? value.join(" ") : value;
  }
  return { output, errors };
}

function checkField(f: TargetField, v: Scalar): { code: string; message: string } | null {
  if (v === null || v === "") {
    return f.required ? { code: "MISSING_REQUIRED", message: `${f.name} is required` } : null;
  }
  switch (f.type) {
    case "string":
    case "enum":
      if (typeof v !== "string") return { code: "TYPE_MISMATCH", message: `${f.name} must be text, got ${typeof v}` };
      break;
    case "integer":
      if (typeof v !== "number" || !Number.isInteger(v)) return { code: "TYPE_MISMATCH", message: `${f.name} must be an integer` };
      break;
    case "decimal":
      if (typeof v !== "number" || !Number.isFinite(v)) return { code: "TYPE_MISMATCH", message: `${f.name} must be a number` };
      break;
    case "boolean":
      if (typeof v !== "boolean") return { code: "TYPE_MISMATCH", message: `${f.name} must be true/false` };
      break;
    case "date":
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { code: "TYPE_MISMATCH", message: `${f.name} must be a YYYY-MM-DD date` };
      break;
  }
  if (f.enum && !f.enum.includes(String(v))) return { code: "NOT_IN_ENUM", message: `"${v}" is not one of ${f.enum.join(", ")}` };
  if (f.pattern && !new RegExp(f.pattern).test(String(v))) return { code: "PATTERN_MISMATCH", message: `"${v}" does not match ${f.pattern}` };
  if (f.format === "email" && !EMAIL_RE.test(String(v))) return { code: "INVALID_EMAIL", message: `"${v}" is not a valid email address` };
  if (f.maxLength && String(v).length > f.maxLength) return { code: "TOO_LONG", message: `${f.name} exceeds ${f.maxLength} characters` };
  if (typeof v === "number" && f.min !== undefined && v < f.min) return { code: "BELOW_MIN", message: `${v} is below the minimum ${f.min}` };
  if (typeof v === "number" && f.max !== undefined && v > f.max) return { code: "ABOVE_MAX", message: `${v} is above the maximum ${f.max}` };
  return null;
}

/** Checks a transformed row against the target schema's constraints. */
export function validateRow(row: TargetRow, plan: PlanContent, target: TargetSchema, skip: Set<string>): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of target.fields) {
    if (skip.has(f.name)) continue; // already failed during transformation
    const problem = checkField(f, row[f.name] ?? null);
    if (problem) {
      const m = plan.mappings.find((x) => x.target === f.name);
      errors.push({ stage: "validate", field: f.name, sources: m?.sources ?? [], step: null, rule: null, ...problem, input: row[f.name] ?? null });
    }
  }
  return errors;
}

/**
 * Runs a plan over the records without side effects. The same plan and records always
 * produce the same report and checksum, which is what makes the dry run trustworthy.
 */
export function runPlan(records: SourceRecord[], plan: PlanContent, source: SourceSchema, target: TargetSchema): MigrationReport {
  const keyField = target.primaryKey;
  const firstSeen = new Map<string, number>();
  const outcomes: RecordOutcome[] = [];
  const counts: RunCounts = { source: records.length, transformed: 0, accepted: 0, rejected: 0, rejectedAtTransform: 0, rejectedAtValidation: 0, rejectedAsDuplicate: 0 };
  const errorsByCode: Record<string, number> = {};
  const errorsByField: Record<string, number> = {};

  records.forEach((record, idx) => {
    const row = idx + 1;
    const rawKey = record[source.primaryKey];
    const sourceKey = rawKey === null || rawKey === undefined ? null : String(rawKey);
    const { output, errors } = transformRecord(record, plan, target);
    const transformOk = errors.length === 0;
    if (transformOk) counts.transformed++;

    errors.push(...validateRow(output, plan, target, new Set(errors.map((e) => e.field))));

    // The first row to produce a key owns it, even if that row is itself rejected:
    // a later copy is never silently promoted in its place.
    const targetKey = output[keyField] === null ? null : String(output[keyField]);
    if (targetKey !== null) {
      const prior = firstSeen.get(targetKey);
      if (prior !== undefined) {
        errors.push({ stage: "duplicate", field: keyField, sources: [source.primaryKey], step: null, rule: null, code: "DUPLICATE_KEY", message: `${keyField} "${targetKey}" was already produced by row ${prior}`, input: targetKey });
      } else {
        firstSeen.set(targetKey, row);
      }
    }

    const accepted = errors.length === 0;
    if (accepted) counts.accepted++;
    else {
      counts.rejected++;
      if (!transformOk) counts.rejectedAtTransform++;
      else if (errors.some((e) => e.stage === "validate")) counts.rejectedAtValidation++;
      else counts.rejectedAsDuplicate++;
      for (const e of errors) {
        errorsByCode[e.code] = (errorsByCode[e.code] ?? 0) + 1;
        errorsByField[e.field] = (errorsByField[e.field] ?? 0) + 1;
      }
    }
    outcomes.push({ row, sourceKey, targetKey, status: accepted ? "accepted" : "rejected", output: accepted ? output : null, errors });
  });

  const pHash = planHash(plan);
  const checksum = sha256({ planHash: pHash, outcomes: outcomes.map((o) => [o.row, o.status, o.output, o.errors.map((e) => [e.field, e.code])]) });
  return { planHash: pHash, checksum, counts, errorsByCode, errorsByField, outcomes };
}
