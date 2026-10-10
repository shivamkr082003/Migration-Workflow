import { describe, expect, it } from "vitest";
import { parseDate, RULES, ruleCatalog } from "../src/index.js";

const run = <K extends keyof typeof RULES>(id: K, value: unknown, params: unknown = {}) => {
  const rule = RULES[id];
  return (rule.apply as (v: unknown, p: unknown) => unknown)(value, rule.params.parse(params));
};

describe("parseDate", () => {
  it("parses each supported format to ISO", () => {
    expect(parseDate("2021-03-04", ["YYYY-MM-DD"])).toMatchObject({ kind: "ok", value: "2021-03-04" });
    expect(parseDate("17/02/2024", ["DD/MM/YYYY"])).toMatchObject({ kind: "ok", value: "2024-02-17" });
    expect(parseDate("Mar 4 2021", ["MMM D YYYY"])).toMatchObject({ kind: "ok", value: "2021-03-04" });
    expect(parseDate("4 March 2021", ["D MMM YYYY"])).toMatchObject({ kind: "ok", value: "2021-03-04" });
  });

  it("refuses to guess between day-first and month-first", () => {
    const r = parseDate("04/03/2021", ["DD/MM/YYYY", "MM/DD/YYYY"]);
    expect(r.kind).toBe("ambiguous");
  });

  it("is unambiguous when only one interpretation is a real date", () => {
    expect(parseDate("17/02/2024", ["DD/MM/YYYY", "MM/DD/YYYY"])).toMatchObject({ kind: "ok", value: "2024-02-17" });
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDate("2022-02-30", ["YYYY-MM-DD"]).kind).toBe("invalid_calendar_date");
    expect(parseDate("yesterday", ["YYYY-MM-DD"]).kind).toBe("no_match");
  });
});

describe("rules", () => {
  it("trim collapses whitespace and keeps null", () => {
    expect(run("trim", "  a   b ")).toEqual({ ok: true, value: "a b" });
    expect(run("trim", null)).toEqual({ ok: true, value: null });
  });

  it("split_name handles 'First Last', 'Last, First' and mononyms", () => {
    expect(run("split_name", "Priya Patel", { part: "first" })).toEqual({ ok: true, value: "Priya" });
    expect(run("split_name", "Patel, Priya", { part: "first" })).toEqual({ ok: true, value: "Priya" });
    expect(run("split_name", "Patel, Priya", { part: "last" })).toEqual({ ok: true, value: "Patel" });
    expect(run("split_name", "Madonna", { part: "last" })).toEqual({ ok: true, value: null });
    expect(run("split_name", "", { part: "first" })).toEqual({ ok: true, value: null });
  });

  it("title_case normalises casing", () => {
    expect(run("title_case", "aarav o'neil-sharma")).toEqual({ ok: true, value: "Aarav O'Neil-Sharma" });
  });

  it("parse_date rejects ambiguity by default and can opt into first_match", () => {
    const formats = ["DD/MM/YYYY", "MM/DD/YYYY"];
    expect(run("parse_date", "04/03/2021", { formats })).toMatchObject({ ok: false, code: "AMBIGUOUS_DATE" });
    expect(run("parse_date", "04/03/2021", { formats, on_ambiguous: "first_match" })).toEqual({ ok: true, value: "2021-03-04" });
  });

  it("to_boolean is case-insensitive and strict about unknown tokens", () => {
    const p = { true_values: ["y", "yes"], false_values: ["n"] };
    expect(run("to_boolean", "YES", p)).toEqual({ ok: true, value: true });
    expect(run("to_boolean", "maybe", p)).toMatchObject({ ok: false, code: "UNRECOGNISED_BOOLEAN" });
  });

  it("enum_map uses the table, then the fallback, else fails", () => {
    const mapping = { plat: "platinum", gold: "gold" };
    expect(run("enum_map", "PLAT", { mapping })).toEqual({ ok: true, value: "platinum" });
    expect(run("enum_map", "diamond", { mapping })).toMatchObject({ ok: false, code: "UNMAPPED_ENUM_VALUE" });
    expect(run("enum_map", "diamond", { mapping, fallback: "gold" })).toEqual({ ok: true, value: "gold" });
  });

  it("to_cents avoids floating point drift", () => {
    expect(run("to_cents", "$1,234.50")).toEqual({ ok: true, value: 123450 });
    expect(run("to_cents", "0.29")).toEqual({ ok: true, value: 29 });
    expect(run("to_cents", "4766")).toEqual({ ok: true, value: 476600 });
    expect(run("to_cents", "-20.00")).toEqual({ ok: true, value: -2000 });
    expect(run("to_cents", "N/A")).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
    expect(run("to_cents", "1.234,5", { decimal_separator: "," })).toEqual({ ok: true, value: 123450 });
  });

  it("normalize_phone handles +, 00 and national formats", () => {
    const p = { default_country_code: "91" };
    expect(run("normalize_phone", "+91 98765 43210", p)).toEqual({ ok: true, value: "+919876543210" });
    expect(run("normalize_phone", "9876543210", p)).toEqual({ ok: true, value: "+919876543210" });
    expect(run("normalize_phone", "0091-9876543210", p)).toEqual({ ok: true, value: "+919876543210" });
    expect(run("normalize_phone", "12345", p)).toMatchObject({ ok: false, code: "INVALID_PHONE" });
  });

  it("default_value only fills blanks", () => {
    expect(run("default_value", null, { value: false })).toEqual({ ok: true, value: false });
    expect(run("default_value", "x", { value: "y" })).toEqual({ ok: true, value: "x" });
  });

  it("concat joins non-blank parts", () => {
    expect(run("concat", ["a", "", null, "b"], { separator: "-" })).toEqual({ ok: true, value: "a-b" });
  });

  it("rule params reject unknown keys (no smuggled behaviour)", () => {
    expect(RULES.trim.params.safeParse({ code: "process.exit()" }).success).toBe(false);
  });

  it("publishes a JSON-schema catalogue for every rule", () => {
    const cat = ruleCatalog();
    expect(cat.map((r) => r.id)).toContain("parse_date");
    expect(cat.every((r) => typeof r.paramsSchema === "object")).toBe(true);
  });
});
