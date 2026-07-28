import { describe, expect, it } from "vitest";
import { visibleCount } from "./RecentResearch";

describe("visibleCount", () => {
  it("shows only the collapsed limit before the reveal", () => {
    expect(visibleCount(9, 2, 10, false)).toBe(2);
  });

  it("shows the expanded limit after the reveal", () => {
    expect(visibleCount(9, 2, 10, true)).toBe(9);
    expect(visibleCount(25, 2, 10, true)).toBe(10);
  });

  it("never claims more rows than exist, so no phantom 'More' appears", () => {
    expect(visibleCount(1, 2, 10, false)).toBe(1);
    expect(visibleCount(0, 2, 10, false)).toBe(0);
  });

  it("shows everything when the list is the whole list (history route)", () => {
    expect(visibleCount(25, undefined, undefined, false)).toBe(25);
  });

  it("expands to the full list when no expanded ceiling is set", () => {
    expect(visibleCount(25, 2, undefined, true)).toBe(25);
  });
});
