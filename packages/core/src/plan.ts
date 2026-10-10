import { z } from "zod";
import { sha256 } from "./hash.js";
import { getRule, RULE_IDS } from "./rules.js";
import type { FieldType, SourceSchema, TargetSchema } from "./schema.js";

export const RuleStep = z.object({
  rule: z.enum(RULE_IDS),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type RuleStep = z.infer<typeof RuleStep>;

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const FieldMapping = z.object({
  target: z.string().min(1),
  sources: z.array(z.string().min(1)).max(5),
  steps: z.array(RuleStep).min(1).max(8),
  rationale: z.string().default(""),
  risk: RiskLevel.default("low"),
  risk_notes: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1),
});
export type FieldMapping = z.infer<typeof FieldMapping>;

export const ClarificationQuestion = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  related_fields: z.array(z.string()).default([]),
  blocking: z.boolean().default(false),
  answer: z.string().nullable().default(null),
});
export type ClarificationQuestion = z.infer<typeof ClarificationQuestion>;

export const PlanContent = z.object({
  summary: z.string().default(""),
  mappings: z.array(FieldMapping),
  ignored_source_fields: z.array(z.object({ field: z.string(), reason: z.string() })).default([]),
  questions: z.array(ClarificationQuestion).default([]),
});
export type PlanContent = z.infer<typeof PlanContent>;
export type PlanContentInput = z.input<typeof PlanContent>;

export function planHash(plan: PlanContent): string {
  return sha256(plan);
}

export type IssueSeverity = "error" | "warning";
export interface PlanIssue {
  severity: IssueSeverity;
  code: string;
  path: string;
  message: string;
}

/** Can a value of type `from` be stored in a target column of type `to` without further conversion? */
function compatible(from: FieldType, to: FieldType): boolean {
  if (from === to) return true;
  if (to === "decimal" && from === "integer") return true;
  if (to === "string" && from === "enum") return true;
  return false;
}

/** Statically walks a mapping's steps and returns the output type plus any type problems. */
export function inferMappingType(
  mapping: FieldMapping,
  source: SourceSchema,
): { type: FieldType | null; problems: { step: number; message: string }[] } {
  const problems: { step: number; message: string }[] = [];
  const srcTypes = mapping.sources.map((s) => source.fields.find((f) => f.name === s)?.type).filter(Boolean) as FieldType[];
  let current: FieldType | null = srcTypes.length === 1 ? srcTypes[0]! : srcTypes.length > 1 ? "string" : null;

  mapping.steps.forEach((step, i) => {
    const rule = getRule(step.rule);
    if (!rule) return;
    if (current && rule.accepts !== "any" && !rule.accepts.includes(current)) {
      problems.push({ step: i, message: `${rule.id} expects ${rule.accepts.join("/")} but receives ${current}` });
    }
    if (typeof rule.output === "function") {
      const parsed = rule.params.safeParse(step.params);
      current = parsed.success ? (rule.output as (p: unknown) => FieldType)(parsed.data) : current;
    } else if (rule.output !== "same") {
      current = rule.output;
    }
  });
  return { type: current, problems };
}

export interface ValidateOptions {
  /** Approval additionally requires every blocking clarification to be answered. */
  forApproval?: boolean;
}

export function validatePlan(
  plan: PlanContent,
  source: SourceSchema,
  target: TargetSchema,
  opts: ValidateOptions = {},
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (severity: IssueSeverity, code: string, path: string, message: string) =>
    issues.push({ severity, code, path, message });
  const sourceNames = new Set(source.fields.map((f) => f.name));
  const seenTargets = new Map<string, number>();
  const usedSources = new Set<string>();

  plan.mappings.forEach((m, i) => {
    const path = `mappings[${i}](${m.target})`;
    const tf = target.fields.find((f) => f.name === m.target);
    if (!tf) add("error", "UNKNOWN_TARGET_FIELD", path, `Target field "${m.target}" does not exist in ${target.entity}`);
    if (seenTargets.has(m.target)) {
      add("error", "DUPLICATE_TARGET_MAPPING", path, `"${m.target}" is mapped more than once`);
    }
    seenTargets.set(m.target, i);

    for (const s of m.sources) {
      if (!sourceNames.has(s)) add("error", "UNKNOWN_SOURCE_FIELD", path, `Source field "${s}" does not exist in ${source.entity}`);
      usedSources.add(s);
    }

    m.steps.forEach((step, si) => {
      const rule = getRule(step.rule);
      if (!rule) {
        add("error", "UNKNOWN_RULE", `${path}.steps[${si}]`, `Rule "${step.rule}" is not supported`);
        return;
      }
      const parsed = rule.params.safeParse(step.params);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((x) => `${x.path.join(".") || "params"}: ${x.message}`).join("; ");
        add("error", "INVALID_RULE_PARAMS", `${path}.steps[${si}]`, `${rule.id}: ${detail}`);
      }
      if (si > 0 && rule.input === "multi") {
        add("error", "CONCAT_MUST_BE_FIRST", `${path}.steps[${si}]`, "concat can only be the first step");
      }
    });

    const first = getRule(m.steps[0]?.rule ?? "");
    if (first) {
      if (m.sources.length > 1 && first.input !== "multi") {
        add("error", "MULTI_SOURCE_REQUIRES_CONCAT", path, "Mappings with several source fields must start with concat");
      }
      if (m.sources.length === 0 && first.input !== "optional") {
        add("error", "NO_SOURCE_REQUIRES_DEFAULT", path, "A mapping without source fields must start with default_value");
      }
    }

    if (tf) {
      const { type, problems } = inferMappingType(m, source);
      for (const p of problems) add("warning", "STEP_TYPE_MISMATCH", `${path}.steps[${p.step}]`, p.message);
      if (type && !compatible(type, tf.type) && !(tf.type === "enum" && type === "string")) {
        add("error", "INCOMPATIBLE_TYPE", path, `Pipeline produces ${type} but ${m.target} is ${tf.type}`);
      }
      if (tf.type === "enum" && type === "string") {
        add("warning", "ENUM_NOT_NORMALISED", path, `${m.target} is an enum; consider enum_map so unexpected labels are caught explicitly`);
      }
      if (m.sources.length === 0 && tf.required) {
        add("warning", "CONSTANT_FOR_REQUIRED_FIELD", path, `${m.target} is filled with a constant for every record`);
      }
    }
  });

  for (const tf of target.fields) {
    if (seenTargets.has(tf.name)) continue;
    if (tf.required) add("error", "UNMAPPED_REQUIRED_TARGET", tf.name, `Required target field "${tf.name}" has no mapping`);
    else add("warning", "UNMAPPED_OPTIONAL_TARGET", tf.name, `Optional target field "${tf.name}" will always be null`);
  }

  if (!seenTargets.has(target.primaryKey)) {
    add("error", "KEY_NOT_MAPPED", target.primaryKey, "The target primary key must be mapped for idempotent loads");
  }

  const ignored = new Set(plan.ignored_source_fields.map((x) => x.field));
  for (const f of ignored) {
    if (!sourceNames.has(f)) add("warning", "UNKNOWN_IGNORED_FIELD", `ignored(${f})`, `"${f}" is not a source field`);
  }
  for (const f of source.fields) {
    if (!usedSources.has(f.name) && !ignored.has(f.name)) {
      add("warning", "SOURCE_FIELD_UNACCOUNTED", f.name, `Source field "${f.name}" is neither mapped nor explicitly ignored`);
    }
  }

  const qIds = new Set<string>();
  plan.questions.forEach((q, i) => {
    if (qIds.has(q.id)) add("error", "DUPLICATE_QUESTION_ID", `questions[${i}]`, `Question id "${q.id}" is repeated`);
    qIds.add(q.id);
    if (opts.forApproval && q.blocking && !q.answer?.trim()) {
      add("error", "UNANSWERED_BLOCKING_QUESTION", `questions[${i}]`, `Blocking question must be answered: ${q.question}`);
    }
  });

  return issues;
}

export const hasErrors = (issues: PlanIssue[]) => issues.some((i) => i.severity === "error");
