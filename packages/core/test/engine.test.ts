import { describe, expect, it } from "vitest";
import { runPlan } from "../src/index.js";
import { records, referencePlan, source, target } from "./fixtures.js";

const report = runPlan(records, referencePlan, source, target);
const byKey = (key: string) => report.outcomes.filter((o) => o.sourceKey === key);
const codesFor = (row: number) => report.outcomes[row - 1]!.errors.map((e) => e.code);

describe("runPlan on the sample dataset", () => {
  it("is deterministic: same inputs, same checksum and outcomes", () => {
    const again = runPlan(structuredClone(records), structuredClone(referencePlan), source, target);
    expect(again.checksum).toBe(report.checksum);
    expect(again.outcomes).toEqual(report.outcomes);
  });

  it("counts reconcile: every source record is either accepted or rejected", () => {
    const c = report.counts;
    expect(c.source).toBe(records.length);
    expect(c.accepted + c.rejected).toBe(c.source);
    expect(c.rejectedAtTransform + c.rejectedAtValidation + c.rejectedAsDuplicate).toBe(c.rejected);
    expect(c.accepted).toBeGreaterThan(c.rejected);
  });

  it("produces typed, normalised output for clean records", () => {
    const first = report.outcomes[0]!;
    expect(first.status).toBe("accepted");
    expect(first.output).toMatchObject({
      customer_id: "C-1001",
      first_name: "Chloe",
      last_name: "Haddad",
      email: "chloe.haddad0@example.com",
      phone_e164: "+919455002191",
      signup_date: "2021-04-01",
      is_active: false,
      country_code: "IN",
      lifetime_value_cents: 352113,
      loyalty_tier: "bronze",
      marketing_opt_in: false,
    });
  });

  it.each([
    [4, "INVALID_EMAIL"],
    [8, "INVALID_DATE"],
    [12, "UNRECOGNISED_BOOLEAN"],
    [16, "UNMAPPED_ENUM_VALUE"],
    [20, "BELOW_MIN"],
    [24, "INVALID_AMOUNT"],
    [28, "UNMAPPED_ENUM_VALUE"],
    [32, "MISSING_REQUIRED"],
    [36, "MISSING_REQUIRED"],
    [40, "INVALID_PHONE"],
    [68, "PATTERN_MISMATCH"],
  ])("row %i is quarantined with %s", (row, code) => {
    expect(report.outcomes[row - 1]!.status).toBe("rejected");
    expect(codesFor(row)).toContain(code);
  });

  it("keeps field-level evidence for each error", () => {
    const err = report.outcomes[7]!.errors[0]!;
    expect(err).toMatchObject({ stage: "transform", field: "signup_date", sources: ["signup_dt"], rule: "parse_date", step: 0, input: "2022-02-30" });
  });

  it("accepts a mononym with a null last name", () => {
    expect(report.outcomes[63]!).toMatchObject({ status: "accepted", output: { first_name: "Madonna", last_name: null } });
  });

  it("treats instruction-like text in the data as plain data", () => {
    const row = report.outcomes[55]!;
    expect(row.errors.map((e) => e.field)).not.toContain("notes");
  });

  it("quarantines repeated legacy ids after the first occurrence", () => {
    for (const key of ["C-1011", "C-1041", "C-1091"]) {
      const rows = byKey(key);
      expect(rows).toHaveLength(2);
      expect(rows[1]!.errors.map((e) => e.code)).toContain("DUPLICATE_KEY");
    }
    expect(report.counts.rejectedAsDuplicate).toBeGreaterThan(0);
  });
});
