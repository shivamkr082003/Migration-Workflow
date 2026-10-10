import { describe, expect, it } from "vitest";
import { display, pct, short } from "./format";

describe("format helpers", () => {
  it("renders values so blanks and nulls are distinguishable", () => {
    expect(display(null)).toBe("null");
    expect(display("")).toBe('""');
    expect(display("x")).toBe("x");
    expect(display(12)).toBe("12");
    expect(display(false)).toBe("false");
  });

  it("formats percentages and short hashes safely", () => {
    expect(pct(137, 153)).toBe("89.5%");
    expect(pct(1, 0)).toBe("0%");
    expect(short("abcdef1234567", 6)).toBe("abcdef");
    expect(short(null)).toBe("—");
  });
});
