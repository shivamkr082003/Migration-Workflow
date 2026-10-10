import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { stepSummary } from "./plan/Mappings";
import { ErrorBanner, StatusBadge } from "./ui";

describe("ErrorBanner", () => {
  it("shows the server's message, code, request id and validation details", () => {
    const err = new ApiError(422, "PLAN_INVALID", "The plan has validation errors", [{ message: "Required target field \"email\" has no mapping" }], "abcd1234-ffff");
    render(<ErrorBanner error={err} />);
    expect(screen.getByText("The plan has validation errors")).toBeInTheDocument();
    expect(screen.getByText(/PLAN_INVALID/)).toHaveTextContent("request abcd1234");
    expect(screen.getByText(/has no mapping/)).toBeInTheDocument();
  });

  it("renders nothing without an error", () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("StatusBadge", () => {
  it("humanises status names", () => {
    render(<StatusBadge status="rolled_back" />);
    expect(screen.getByText("rolled back")).toBeInTheDocument();
  });
});

describe("stepSummary", () => {
  it("summarises rule parameters for the mapping table", () => {
    expect(stepSummary({ rule: "parse_date", params: { formats: ["YYYY-MM-DD", "DD/MM/YYYY"], on_ambiguous: "reject" } })).toBe("YYYY-MM-DD | DD/MM/YYYY");
    expect(stepSummary({ rule: "enum_map", params: { mapping: { a: "x", b: "y" } } })).toBe("2 entries");
    expect(stepSummary({ rule: "normalize_phone", params: { default_country_code: "91" } })).toBe("+91");
    expect(stepSummary({ rule: "default_value", params: { value: false } })).toBe("false");
    expect(stepSummary({ rule: "trim", params: {} })).toBe("");
  });
});
