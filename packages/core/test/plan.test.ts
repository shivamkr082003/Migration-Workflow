import { describe, expect, it } from "vitest";
import { hasErrors, planHash, PlanContent, validatePlan } from "../src/index.js";
import { referencePlan, source, target } from "./fixtures.js";

const codes = (plan: PlanContent, forApproval = false) => validatePlan(plan, source, target, { forApproval }).map((i) => i.code);
const withMappings = (mutate: (m: PlanContent["mappings"]) => PlanContent["mappings"]) =>
  PlanContent.parse({ ...referencePlan, mappings: mutate(structuredClone(referencePlan.mappings)) });

describe("validatePlan", () => {
  it("accepts the reference plan, including for approval", () => {
    expect(hasErrors(validatePlan(referencePlan, source, target, { forApproval: true }))).toBe(false);
  });

  it("flags unknown fields and unmapped required targets", () => {
    const plan = withMappings((m) => [
      ...m.filter((x) => x.target !== "email"),
      { target: "nickname", sources: ["nick"], steps: [{ rule: "copy", params: {} }], rationale: "", risk: "low", risk_notes: [], confidence: 1 },
    ]);
    const c = codes(plan);
    expect(c).toContain("UNKNOWN_TARGET_FIELD");
    expect(c).toContain("UNKNOWN_SOURCE_FIELD");
    expect(c).toContain("UNMAPPED_REQUIRED_TARGET");
  });

  it("catches invalid rule params", () => {
    const plan = withMappings((m) => m.map((x) => (x.target === "signup_date" ? { ...x, steps: [{ rule: "parse_date", params: { formats: ["DD.MM.YY"] } }] } : x)));
    expect(codes(plan)).toContain("INVALID_RULE_PARAMS");
  });

  it("detects a pipeline whose output type cannot be stored in the target", () => {
    const plan = withMappings((m) => m.map((x) => (x.target === "is_active" ? { ...x, steps: [{ rule: "trim", params: {} }] } : x)));
    expect(codes(plan)).toContain("INCOMPATIBLE_TYPE");
  });

  it("requires default_value when a mapping has no source", () => {
    const plan = withMappings((m) => m.map((x) => (x.target === "marketing_opt_in" ? { ...x, steps: [{ rule: "copy", params: {} }] } : x)));
    expect(codes(plan)).toContain("NO_SOURCE_REQUIRES_DEFAULT");
  });

  it("requires concat first for multi-source mappings", () => {
    const plan = withMappings((m) => m.map((x) => (x.target === "last_name" ? { ...x, sources: ["full_name", "notes"], steps: [{ rule: "trim", params: {} }] } : x)));
    expect(codes(plan)).toContain("MULTI_SOURCE_REQUIRES_CONCAT");
  });

  it("blocks approval while a blocking question is unanswered", () => {
    const plan = PlanContent.parse({ ...referencePlan, questions: [{ id: "q1", question: "Consent?", blocking: true, answer: null }] });
    expect(codes(plan, false)).not.toContain("UNANSWERED_BLOCKING_QUESTION");
    expect(codes(plan, true)).toContain("UNANSWERED_BLOCKING_QUESTION");
  });

  it("warns about source fields that are neither mapped nor ignored", () => {
    const plan = PlanContent.parse({ ...referencePlan, ignored_source_fields: [] });
    expect(codes(plan)).toContain("SOURCE_FIELD_UNACCOUNTED");
  });

  it("hash is stable across key order and changes with content", () => {
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
    const reordered = reverseKeys(referencePlan);
    expect(planHash(PlanContent.parse(reordered))).toBe(planHash(referencePlan));
    const changed = withMappings((m) => m.slice(1));
    expect(planHash(changed)).not.toBe(planHash(referencePlan));
  });
});
