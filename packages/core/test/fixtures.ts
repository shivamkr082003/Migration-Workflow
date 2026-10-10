import { readFileSync } from "node:fs";
import { PlanContent, SourceSchema, TargetSchema, parseSourceRecords } from "../src/index.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../data/${name}`, import.meta.url), "utf8"));

export const source = SourceSchema.parse(read("source-schema.json"));
export const target = TargetSchema.parse(read("target-schema.json"));
export const records = parseSourceRecords(source, read("source-records.json"));

/** A plan a careful reviewer would approve for the sample dataset. */
export const referencePlan = PlanContent.parse({
  summary: "Reference plan used by tests",
  mappings: [
    { target: "customer_id", sources: ["cust_id"], steps: [{ rule: "trim" }, { rule: "uppercase" }] },
    { target: "first_name", sources: ["full_name"], steps: [{ rule: "split_name", params: { part: "first" } }, { rule: "title_case" }] },
    { target: "last_name", sources: ["full_name"], steps: [{ rule: "split_name", params: { part: "last" } }, { rule: "title_case" }] },
    { target: "email", sources: ["email_addr"], steps: [{ rule: "trim" }, { rule: "lowercase" }] },
    { target: "phone_e164", sources: ["phone"], steps: [{ rule: "normalize_phone", params: { default_country_code: "91" } }] },
    { target: "signup_date", sources: ["signup_dt"], steps: [{ rule: "parse_date", params: { formats: ["YYYY-MM-DD", "DD/MM/YYYY", "MMM D YYYY"] } }] },
    { target: "is_active", sources: ["active_flag"], steps: [{ rule: "to_boolean", params: { true_values: ["y", "yes", "1", "true"], false_values: ["n", "no", "0", "false"] } }] },
    {
      target: "country_code",
      sources: ["country"],
      steps: [
        {
          rule: "enum_map",
          params: {
            mapping: { IN: "IN", India: "IN", US: "US", USA: "US", "United States": "US", UK: "GB", GB: "GB", Germany: "DE", DE: "DE", Singapore: "SG", UAE: "AE", Canada: "CA", AU: "AU" },
          },
        },
      ],
    },
    { target: "lifetime_value_cents", sources: ["ltv"], steps: [{ rule: "to_cents" }] },
    {
      target: "loyalty_tier",
      sources: ["tier"],
      steps: [{ rule: "enum_map", params: { mapping: { bronze: "bronze", silver: "silver", gold: "gold", platinum: "platinum", plat: "platinum" } } }],
    },
    { target: "marketing_opt_in", sources: [], steps: [{ rule: "default_value", params: { value: false } }] },
  ],
  ignored_source_fields: [
    { field: "notes", reason: "Free text with no target column" },
    { field: "legacy_score", reason: "Deprecated" },
  ],
  questions: [{ id: "q1", question: "Is defaulting marketing consent to false acceptable?", blocking: true, answer: "Yes, legal confirmed." }],
});
