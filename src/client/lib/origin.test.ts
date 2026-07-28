import { describe, expect, it } from "vitest";
import { normalizeOrigin, resolveApiUrl, resolveShareUrl } from "./origin";

describe("normalizeOrigin", () => {
  it("returns empty string for an unset variable", () => {
    expect(normalizeOrigin(undefined)).toBe("");
  });

  it("trims whitespace so a stray newline in an env file is harmless", () => {
    expect(normalizeOrigin("  https://tally.o11r.com \n")).toBe("https://tally.o11r.com");
  });

  it("strips trailing slashes so paths never double up", () => {
    expect(normalizeOrigin("https://tally.o11r.com///")).toBe("https://tally.o11r.com");
  });
});

describe("resolveApiUrl", () => {
  it("keeps web requests relative when no origin is configured", () => {
    expect(resolveApiUrl("", "/api/reports")).toBe("/api/reports");
  });

  it("makes native requests absolute against the deployment", () => {
    expect(resolveApiUrl("https://tally.o11r.com", "/api/reports")).toBe(
      "https://tally.o11r.com/api/reports",
    );
  });

  it("produces exactly one slash between origin and path", () => {
    expect(resolveApiUrl(normalizeOrigin("https://tally.o11r.com/"), "/api/events")).toBe(
      "https://tally.o11r.com/api/events",
    );
  });
});

describe("resolveShareUrl", () => {
  it("uses the page origin on the web", () => {
    expect(resolveShareUrl("", "https://tally.o11r.com", "abc123")).toBe(
      "https://tally.o11r.com/s/abc123",
    );
  });

  it("never emits a capacitor:// link a recipient could not open", () => {
    const url = resolveShareUrl("https://tally.o11r.com", "capacitor://localhost", "abc123");
    expect(url).toBe("https://tally.o11r.com/s/abc123");
    expect(url).not.toContain("capacitor");
  });
});
