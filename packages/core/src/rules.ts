import { z } from "zod";
import { DATE_FORMATS, parseDate } from "./dates.js";
import type { FieldType, Scalar } from "./schema.js";

/**
 * The closed set of transformations a plan may use. Plans reference rules by id with
 * JSON params; there is no way to supply executable code.
 */

export type RuleValue = Scalar | Scalar[];
export type RuleOutcome = { ok: true; value: Scalar } | { ok: false; code: string; message: string };

/** How a rule consumes the mapping's source fields when it is the first step. */
type InputMode = "single" | "multi" | "optional";

interface RuleDefinition<P extends z.ZodType> {
  id: string;
  label: string;
  description: string;
  params: P;
  input: InputMode;
  /** Value types this rule accepts; `any` skips the static check. */
  accepts: readonly FieldType[] | "any";
  /** Static output type, or a function of params (e.g. default_value). `same` keeps the input type. */
  output: FieldType | "same" | ((params: z.infer<P>) => FieldType);
  apply: (value: RuleValue, params: z.infer<P>) => RuleOutcome;
}

const ok = (value: Scalar): RuleOutcome => ({ ok: true, value });
const fail = (code: string, message: string): RuleOutcome => ({ ok: false, code, message });
const isBlank = (v: unknown) => v === null || (typeof v === "string" && v.trim() === "");
const asText = (v: RuleValue): string => (Array.isArray(v) ? v.join(" ") : String(v));

/** Runs `fn` on non-blank input; blank input becomes null so required-checks catch it later. */
function onText(value: RuleValue, fn: (s: string) => RuleOutcome): RuleOutcome {
  if (isBlank(value as Scalar)) return ok(null);
  return fn(asText(value).trim());
}

const noParams = z.object({}).strict();
const STRINGY: readonly FieldType[] = ["string", "enum"];

function define<P extends z.ZodType>(def: RuleDefinition<P>) {
  return def;
}

export const RULES = {
  copy: define({
    id: "copy",
    label: "Copy",
    description: "Pass the source value through unchanged.",
    params: noParams,
    input: "single",
    accepts: "any",
    output: "same",
    apply: (v) => ok(Array.isArray(v) ? asText(v) : v),
  }),
  trim: define({
    id: "trim",
    label: "Trim whitespace",
    description: "Remove leading/trailing whitespace and collapse internal runs of spaces.",
    params: noParams,
    input: "single",
    accepts: STRINGY,
    output: "string",
    apply: (v) => (v === null ? ok(null) : ok(asText(v).trim().replace(/\s+/g, " "))),
  }),
  lowercase: define({
    id: "lowercase",
    label: "Lowercase",
    description: "Convert text to lower case.",
    params: noParams,
    input: "single",
    accepts: STRINGY,
    output: "string",
    apply: (v) => (v === null ? ok(null) : ok(asText(v).toLowerCase())),
  }),
  uppercase: define({
    id: "uppercase",
    label: "Uppercase",
    description: "Convert text to upper case.",
    params: noParams,
    input: "single",
    accepts: STRINGY,
    output: "string",
    apply: (v) => (v === null ? ok(null) : ok(asText(v).toUpperCase())),
  }),
  title_case: define({
    id: "title_case",
    label: "Title case",
    description: "Capitalise the first letter of each word, lower-case the rest.",
    params: noParams,
    input: "single",
    accepts: STRINGY,
    output: "string",
    apply: (v) =>
      v === null ? ok(null) : ok(asText(v).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())),
  }),
  null_if_blank: define({
    id: "null_if_blank",
    label: "Blank to null",
    description: "Turn empty or whitespace-only strings into null.",
    params: noParams,
    input: "single",
    accepts: "any",
    output: "same",
    apply: (v) => (isBlank(v as Scalar) ? ok(null) : ok(Array.isArray(v) ? asText(v) : v)),
  }),
  split_name: define({
    id: "split_name",
    label: "Split full name",
    description:
      "Extract the first or last part of a full name. Understands 'First Last' and 'Last, First'. A single word is treated as a first name with no last name.",
    params: z.object({ part: z.enum(["first", "last"]) }).strict(),
    input: "single",
    accepts: STRINGY,
    output: "string",
    apply: (v, { part }) =>
      onText(v, (s) => {
        const clean = s.replace(/\s+/g, " ");
        let first: string;
        let last: string | null;
        if (clean.includes(",")) {
          const [l, ...rest] = clean.split(",");
          last = l!.trim() || null;
          first = rest.join(",").trim();
        } else {
          const tokens = clean.split(" ");
          first = tokens[0]!;
          last = tokens.length > 1 ? tokens.slice(1).join(" ") : null;
        }
        if (!first) return fail("UNPARSEABLE_NAME", `Could not find a first name in "${s}"`);
        return ok(part === "first" ? first : last);
      }),
  }),
  parse_date: define({
    id: "parse_date",
    label: "Parse date",
    description:
      "Parse text into an ISO date (YYYY-MM-DD) trying each listed format. Values that match several formats with different results are rejected as ambiguous unless on_ambiguous is 'first_match'.",
    params: z
      .object({
        formats: z.array(z.enum(DATE_FORMATS)).min(1),
        on_ambiguous: z.enum(["reject", "first_match"]).default("reject"),
      })
      .strict(),
    input: "single",
    accepts: STRINGY,
    output: "date",
    apply: (v, { formats, on_ambiguous }) =>
      onText(v, (s) => {
        const r = parseDate(s, formats);
        switch (r.kind) {
          case "ok":
            return ok(r.value);
          case "ambiguous":
            return on_ambiguous === "first_match"
              ? ok(r.candidates[0]!.value)
              : fail(
                  "AMBIGUOUS_DATE",
                  `"${s}" matches ${r.candidates.map((c) => `${c.format} → ${c.value}`).join(" and ")}`,
                );
          case "invalid_calendar_date":
            return fail("INVALID_DATE", `"${s}" looks like ${r.format} but is not a real calendar date`);
          case "no_match":
            return fail("UNRECOGNISED_DATE_FORMAT", `"${s}" does not match any of: ${formats.join(", ")}`);
        }
      }),
  }),
  to_boolean: define({
    id: "to_boolean",
    label: "To boolean",
    description: "Map text tokens (case-insensitive) to true/false. Unlisted tokens are rejected.",
    params: z
      .object({
        true_values: z.array(z.string()).min(1),
        false_values: z.array(z.string()).min(1),
      })
      .strict(),
    input: "single",
    accepts: STRINGY,
    output: "boolean",
    apply: (v, { true_values, false_values }) =>
      onText(v, (s) => {
        const t = s.toLowerCase();
        if (true_values.some((x) => x.toLowerCase() === t)) return ok(true);
        if (false_values.some((x) => x.toLowerCase() === t)) return ok(false);
        return fail("UNRECOGNISED_BOOLEAN", `"${s}" is not in the configured true/false values`);
      }),
  }),
  enum_map: define({
    id: "enum_map",
    label: "Map to enum",
    description:
      "Translate source labels to target enum values using an explicit lookup table. Unmapped values are rejected unless a fallback is given.",
    params: z
      .object({
        mapping: z.record(z.string(), z.string()),
        case_insensitive: z.boolean().default(true),
        fallback: z.string().optional(),
      })
      .strict(),
    input: "single",
    accepts: STRINGY,
    output: "enum",
    apply: (v, { mapping, case_insensitive, fallback }) =>
      onText(v, (s) => {
        const norm = (x: string) => (case_insensitive ? x.trim().toLowerCase() : x.trim());
        const key = norm(s);
        const hit = Object.entries(mapping).find(([k]) => norm(k) === key);
        if (hit) return ok(hit[1]);
        if (fallback !== undefined) return ok(fallback);
        return fail("UNMAPPED_ENUM_VALUE", `"${s}" has no entry in the enum mapping`);
      }),
  }),
  to_cents: define({
    id: "to_cents",
    label: "Money to cents",
    description:
      "Parse a currency amount such as '$1,234.50' into integer minor units (123450). Currency symbols and thousands separators are stripped.",
    params: z.object({ decimal_separator: z.enum([".", ","]).default(".") }).strict(),
    input: "single",
    accepts: ["string", "integer", "decimal"],
    output: "integer",
    apply: (v, { decimal_separator }) =>
      onText(v, (s) => {
        const thousands = decimal_separator === "." ? "," : ".";
        const cleaned = s.replace(/[$€£₹\s]/g, "").split(thousands).join("").replace(decimal_separator, ".");
        const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
        if (!m) return fail("INVALID_AMOUNT", `"${s}" is not a recognisable amount`);
        const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
        return ok(m[1] ? -cents : cents);
      }),
  }),
  cast_integer: define({
    id: "cast_integer",
    label: "To integer",
    description: "Parse a whole number. Decimals and non-numeric text are rejected.",
    params: noParams,
    input: "single",
    accepts: ["string", "integer"],
    output: "integer",
    apply: (v) =>
      onText(v, (s) => (/^-?\d+$/.test(s) ? ok(Number(s)) : fail("INVALID_INTEGER", `"${s}" is not a whole number`))),
  }),
  cast_decimal: define({
    id: "cast_decimal",
    label: "To decimal",
    description: "Parse a decimal number using '.' as the decimal separator.",
    params: noParams,
    input: "single",
    accepts: ["string", "integer", "decimal"],
    output: "decimal",
    apply: (v) =>
      onText(v, (s) => (/^-?\d+(\.\d+)?$/.test(s) ? ok(Number(s)) : fail("INVALID_DECIMAL", `"${s}" is not a number`))),
  }),
  normalize_phone: define({
    id: "normalize_phone",
    label: "Normalise phone (E.164)",
    description:
      "Convert a phone number to E.164. Numbers with '+' or a '00' prefix keep their country code; bare national numbers of national_length digits get default_country_code prepended.",
    params: z
      .object({
        default_country_code: z.string().regex(/^[1-9]\d{0,2}$/),
        national_length: z.number().int().min(6).max(12).default(10),
      })
      .strict(),
    input: "single",
    accepts: ["string", "integer"],
    output: "string",
    apply: (v, { default_country_code, national_length }) =>
      onText(v, (s) => {
        let digits = s.replace(/\D/g, "");
        let international = s.startsWith("+");
        if (!international && digits.startsWith("00")) {
          digits = digits.slice(2);
          international = true;
        }
        if (!international) {
          if (digits.length === national_length + 1 && digits.startsWith("0")) digits = digits.slice(1);
          if (digits.length !== national_length) {
            return fail("INVALID_PHONE", `"${s}" has ${digits.length} digits; expected ${national_length} for a national number`);
          }
          digits = default_country_code + digits;
        }
        const e164 = `+${digits}`;
        return /^\+[1-9]\d{7,14}$/.test(e164) ? ok(e164) : fail("INVALID_PHONE", `"${s}" cannot be expressed as E.164`);
      }),
  }),
  default_value: define({
    id: "default_value",
    label: "Default value",
    description:
      "Use a constant when the input is blank (or always, when the mapping has no source field). Prefer asking a clarification question over silently defaulting business-critical fields.",
    params: z.object({ value: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
    input: "optional",
    accepts: "any",
    output: ({ value }) =>
      typeof value === "boolean" ? "boolean" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "decimal") : "string",
    apply: (v, { value }) => (isBlank(v as Scalar) || Array.isArray(v) ? ok(value) : ok(v)),
  }),
  concat: define({
    id: "concat",
    label: "Concatenate",
    description: "Join several source fields with a separator, skipping blanks. Must be the first step of a multi-source mapping.",
    params: z.object({ separator: z.string().max(5).default(" ") }).strict(),
    input: "multi",
    accepts: "any",
    output: "string",
    apply: (v, { separator }) => {
      const parts = (Array.isArray(v) ? v : [v]).filter((x) => !isBlank(x)).map((x) => String(x).trim());
      return ok(parts.length ? parts.join(separator) : null);
    },
  }),
} as const;

export type RuleId = keyof typeof RULES;
export const RULE_IDS = Object.keys(RULES) as [RuleId, ...RuleId[]];

export function getRule(id: string): (typeof RULES)[RuleId] | undefined {
  return Object.hasOwn(RULES, id) ? RULES[id as RuleId] : undefined;
}

/** Serializable description of the rule catalogue, used by the UI and the AI agent's tools. */
export function ruleCatalog() {
  return Object.values(RULES).map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    input: r.input,
    accepts: r.accepts,
    output: typeof r.output === "function" ? "depends on params" : r.output,
    paramsSchema: z.toJSONSchema(r.params, { io: "input" }),
  }));
}
export type RuleCatalogEntry = ReturnType<typeof ruleCatalog>[number];
