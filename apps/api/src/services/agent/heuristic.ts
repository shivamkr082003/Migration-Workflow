import {
  PlanContent,
  profileField,
  type ClarificationQuestion,
  type DateFormat,
  type FieldMapping,
  type FieldProfile,
  type RiskLevel,
  type TargetField,
} from "@mw/core";
import type { AgentTraceStep } from "../../db/schema.js";
import { callTool, type AgentContext } from "./tools.js";

/**
 * Deterministic offline planner used when no model is configured. It follows the same
 * steps the LLM agent is asked to take (inspect, profile, validate) through the same tools,
 * and it prefers asking a clarification question over guessing a business decision.
 */

const ABBREVIATIONS: Record<string, string[]> = {
  cust: ["customer"],
  addr: ["address"],
  dt: ["date"],
  ltv: ["lifetime", "value"],
  mkt: ["marketing"],
  tel: ["phone"],
  e164: [],
  cents: [],
  code: [],
  flag: [],
  is: [],
  v2: [],
};

const tokens = (name: string) =>
  name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((t) => ABBREVIATIONS[t] ?? [t]);

function similarity(a: string, b: string) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / new Set([...ta, ...tb]).size;
}

const COUNTRY_NAMES: Record<string, string> = {
  india: "IN", "united states": "US", usa: "US", america: "US", "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB",
  germany: "DE", deutschland: "DE", singapore: "SG", uae: "AE", "united arab emirates": "AE", canada: "CA", australia: "AU",
};
const CALLING_CODES: Record<string, string> = { IN: "91", US: "1", CA: "1", GB: "44", DE: "49", SG: "65", AE: "971", AU: "61" };
const TRUTHY = ["y", "yes", "true", "t", "1", "active", "on"];
const FALSY = ["n", "no", "false", "f", "0", "inactive", "off"];

interface Draft {
  mappings: FieldMapping[];
  questions: ClarificationQuestion[];
  ignored: { field: string; reason: string }[];
  observations: string[];
}

function addQuestion(d: Draft, question: string, related: string[], blocking: boolean) {
  d.questions.push({ id: `q${d.questions.length + 1}`, question, related_fields: related, blocking, answer: null });
}

function mapping(target: string, sources: string[], steps: FieldMapping["steps"], rationale: string, risk: RiskLevel, risk_notes: string[], confidence: number): FieldMapping {
  return { target, sources, steps, rationale, risk, risk_notes, confidence };
}

function enumLookup(profile: FieldProfile, allowed: string[]) {
  const table: Record<string, string> = {};
  const unmapped: string[] = [];
  const seen = new Set<string>();
  for (const { value } of profile.topValues) {
    const key = value.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hit =
      allowed.find((a) => a.toLowerCase() === key) ??
      (COUNTRY_NAMES[key] && allowed.includes(COUNTRY_NAMES[key]!) ? COUNTRY_NAMES[key] : undefined) ??
      (key.length >= 3 ? allowed.find((a) => a.toLowerCase().startsWith(key)) : undefined);
    if (hit) table[value.trim()] = hit;
    else unmapped.push(value);
  }
  return { table, unmapped };
}

function detectDateFormats(p: FieldProfile, sourceName: string, d: Draft) {
  const formats: DateFormat[] = [];
  const notes: string[] = [];
  let risk: RiskLevel = "medium";
  const shapes = new Set(p.patterns.map((x) => x.pattern));
  if (shapes.has("9999-99-99")) formats.push("YYYY-MM-DD");
  if (shapes.has("9999/99/99")) formats.push("YYYY/MM/DD");
  if ([...shapes].some((s) => /^99?\/99?\/9999$/.test(s))) {
    const slashValues = p.topValues.map((v) => v.value).filter((v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v));
    const firstOver12 = slashValues.some((v) => Number(v.split("/")[0]) > 12);
    const secondOver12 = slashValues.some((v) => Number(v.split("/")[1]) > 12);
    if (firstOver12 && !secondOver12) {
      formats.push("DD/MM/YYYY");
      notes.push("Slash dates are read day-first because some values have a first component above 12; values like 04/03/2021 are assumed to follow the same convention.");
    } else if (secondOver12 && !firstOver12) {
      formats.push("MM/DD/YYYY");
      notes.push("Slash dates are read month-first because some values have a second component above 12.");
    } else {
      formats.push("DD/MM/YYYY");
      risk = "high";
      notes.push("Slash-date order cannot be inferred from the data; day-first is assumed.");
      addQuestion(d, `Are slash-formatted values in ${sourceName} day-first (DD/MM/YYYY) or month-first (MM/DD/YYYY)?`, [sourceName], true);
    }
  }
  if ([...shapes].some((s) => /^a 99? 9999$/.test(s))) formats.push("MMM D YYYY");
  if ([...shapes].some((s) => /^99? a 9999$/.test(s))) formats.push("D MMM YYYY");
  if (!formats.length) {
    formats.push("YYYY-MM-DD");
    risk = "high";
    notes.push("No known date shape was detected in the profile.");
  }
  return { formats, notes, risk };
}

function planField(ctx: AgentContext, tf: TargetField, profiles: Map<string, FieldProfile>, d: Draft): FieldMapping | null {
  const tTokens = tokens(tf.name);

  // first_name / last_name from a combined name column.
  const namePart = tTokens.includes("first") ? "first" : tTokens.includes("last") ? "last" : null;
  if (namePart && tTokens.includes("name")) {
    const src = ctx.source.fields.find((f) => tokens(f.name).includes("name"));
    if (src) {
      const p = profiles.get(src.name)!;
      const commaStyle = p.topValues.some((v) => v.value.includes(","));
      const notes = [commaStyle ? "Some names use 'Last, First' order; split_name handles the comma form." : "", namePart === "last" ? "Single-word names produce a null last name." : ""].filter(Boolean);
      return mapping(tf.name, [src.name], [{ rule: "split_name", params: { part: namePart } }, { rule: "title_case", params: {} }], `Derived from ${src.name} by splitting on whitespace or comma.`, "medium", notes, 0.8);
    }
  }

  const ranked = ctx.source.fields
    .map((f) => ({ f, score: similarity(f.name, tf.name) }))
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name));
  const best = ranked[0];

  if (!best) {
    if (!tf.required) return null;
    if (tf.type === "boolean") {
      addQuestion(d, `${tf.name} has no source field. Is defaulting it to false acceptable for every migrated record?`, [tf.name], true);
      return mapping(tf.name, [], [{ rule: "default_value", params: { value: false } }], "No legacy equivalent exists; defaults to the conservative value.", "high", ["Assumes a business/compliance decision that must be confirmed."], 0.4);
    }
    addQuestion(d, `Required target field ${tf.name} has no matching source field. Where should its value come from?`, [tf.name], true);
    return null;
  }

  const src = best.f;
  const p = profiles.get(src.name)!;
  const confidence = Math.round(Math.min(0.95, 0.5 + best.score / 2) * 100) / 100;
  const blankNote = p.blank ? [`${p.blank} record(s) have a blank ${src.name}.`] : [];

  if (tf.name === ctx.target.primaryKey) {
    const dupes = p.total - p.blank - p.distinct;
    const notes = [...blankNote];
    if (dupes > 0) {
      notes.push(`${dupes} duplicate ${src.name} value(s): the first occurrence is kept, later ones are quarantined.`);
      addQuestion(d, `${dupes} ${src.name} value(s) appear more than once. Keeping the first occurrence and quarantining the rest: is that the right survivorship rule?`, [src.name], false);
    }
    return mapping(tf.name, [src.name], [{ rule: "trim", params: {} }, { rule: "uppercase", params: {} }], `Primary key carried over from ${src.name}; used as the idempotency key for loads.`, dupes > 0 ? "medium" : "low", notes, confidence);
  }

  switch (tf.type) {
    case "date": {
      const { formats, notes, risk } = detectDateFormats(p, src.name, d);
      return mapping(tf.name, [src.name], [{ rule: "parse_date", params: { formats } }], `Formats chosen from the shapes observed in ${src.name}.`, risk, [...notes, ...blankNote], confidence);
    }
    case "boolean": {
      const values = p.topValues.map((v) => v.value.trim().toLowerCase());
      const t = [...new Set(values.filter((v) => TRUTHY.includes(v)))];
      const f = [...new Set(values.filter((v) => FALSY.includes(v)))];
      const unknown = [...new Set(values.filter((v) => !TRUTHY.includes(v) && !FALSY.includes(v)))];
      const notes = unknown.length ? [`Unrecognised value(s) ${unknown.map((u) => `"${u}"`).join(", ")} will be quarantined.`] : [];
      return mapping(tf.name, [src.name], [{ rule: "to_boolean", params: { true_values: t.length ? t : ["true"], false_values: f.length ? f : ["false"] } }], `Tokens taken from the observed values of ${src.name}.`, unknown.length ? "medium" : "low", [...notes, ...blankNote], confidence);
    }
    case "enum": {
      const { table, unmapped } = enumLookup(p, tf.enum ?? []);
      const notes = unmapped.length ? [`No mapping for ${unmapped.map((u) => `"${u}"`).join(", ")}; those records will be quarantined.`] : [];
      if (unmapped.length) addQuestion(d, `Which ${tf.name} should these ${src.name} values map to: ${unmapped.join(", ")}? (Leave unanswered to quarantine them.)`, [src.name], false);
      return mapping(tf.name, [src.name], [{ rule: "enum_map", params: { mapping: table } }], `Lookup table built from the ${p.distinct} distinct values of ${src.name}.`, unmapped.length ? "medium" : "low", [...notes, ...blankNote], confidence);
    }
    case "integer": {
      const money = tokens(tf.name).includes("value") || /cents/.test(tf.name) || p.topValues.some((v) => /[$,.]/.test(v.value));
      if (money) {
        return mapping(tf.name, [src.name], [{ rule: "to_cents", params: {} }], `${src.name} holds currency amounts; converted to integer minor units.`, "medium", ["Assumes a single currency.", ...(tf.min !== undefined ? [`Values below ${tf.min} are rejected.`] : []), ...blankNote], confidence);
      }
      return mapping(tf.name, [src.name], [{ rule: "cast_integer", params: {} }], `Parsed from ${src.name}.`, "medium", blankNote, confidence);
    }
    case "decimal":
      return mapping(tf.name, [src.name], [{ rule: "cast_decimal", params: {} }], `Parsed from ${src.name}.`, "medium", blankNote, confidence);
    default: {
      if (tf.format === "email") {
        return mapping(tf.name, [src.name], [{ rule: "trim", params: {} }, { rule: "lowercase", params: {} }], `Email normalised to lower case.`, "low", ["Malformed addresses are quarantined by the target's email check.", ...blankNote], confidence);
      }
      if (tf.pattern?.startsWith("^\\+")) {
        const countries = ctx.source.fields.find((f) => tokens(f.name).includes("country"));
        const top = countries ? profiles.get(countries.name)?.topValues[0]?.value : undefined;
        const iso = top ? (COUNTRY_NAMES[top.toLowerCase()] ?? top.toUpperCase()) : "IN";
        const cc = CALLING_CODES[iso] ?? "91";
        addQuestion(d, `National phone numbers without a country prefix will be given +${cc} (the most common country). Should numbers for other countries be handled differently?`, [src.name], false);
        return mapping(tf.name, [src.name], [{ rule: "normalize_phone", params: { default_country_code: cc } }], `Normalised to E.164 with +${cc} for national numbers.`, "high", [`A national number belonging to another country would be silently prefixed with +${cc}.`, ...blankNote], confidence);
      }
      return mapping(tf.name, [src.name], [{ rule: "trim", params: {} }], `Copied from ${src.name} with whitespace trimmed.`, "low", blankNote, confidence);
    }
  }
}

export async function runHeuristicAgent(ctx: AgentContext, onStep: (s: AgentTraceStep) => Promise<void> | void): Promise<PlanContent> {
  const step = async (tool: string, input: unknown) => {
    const started = Date.now();
    const res = callTool(ctx, tool, input);
    await onStep({ at: new Date().toISOString(), kind: "tool_call", tool, input, output: res.output, isError: res.isError, durationMs: Date.now() - started });
    return res;
  };

  await step("inspect_source_schema", {});
  await step("inspect_target_schema", {});
  await step("list_transformation_rules", {});
  await step("profile_source_field", { fields: ctx.source.fields.map((f) => f.name) });
  const profiles = new Map(ctx.source.fields.map((f) => [f.name, profileField(ctx.records, f.name, 100)]));

  const d: Draft = { mappings: [], questions: [], ignored: [], observations: [] };
  for (const tf of ctx.target.fields) {
    const m = planField(ctx, tf, profiles, d);
    if (m) d.mappings.push(m);
  }
  const used = new Set(d.mappings.flatMap((m) => m.sources));
  for (const f of ctx.source.fields) if (!used.has(f.name)) d.ignored.push({ field: f.name, reason: "No corresponding target field." });

  for (const f of ctx.source.fields) {
    const suspicious = ctx.records.some((r) => /ignore (all )?previous instructions|approve the plan/i.test(String(r[f.name] ?? "")));
    if (suspicious) d.observations.push(`Field ${f.name} contains instruction-like text; it was treated as data and ignored.`);
  }

  const plan = PlanContent.parse({
    summary: [
      `Heuristic plan mapping ${d.mappings.length} of ${ctx.target.fields.length} target fields from ${ctx.source.entity}.`,
      `${d.mappings.filter((m) => m.risk === "high").length} high-risk mapping(s) and ${d.questions.filter((q) => q.blocking).length} blocking question(s) need a reviewer.`,
      ...d.observations,
    ].join(" "),
    mappings: d.mappings,
    ignored_source_fields: d.ignored,
    questions: d.questions,
  });
  await step("validate_mapping", plan);
  return plan;
}
