import { describe, expect, it } from "vitest";
import { deepLinkPath } from "./native";

const ORIGIN = "https://tally.o11r.com";

describe("deepLinkPath", () => {
  it("opens a shared /s/:id link as the report itself", () => {
    expect(deepLinkPath(`${ORIGIN}/s/tw8zwkD3QJ6D`, ORIGIN)).toBe("/report/tw8zwkD3QJ6D");
  });

  it("handles the custom scheme with the same rules", () => {
    expect(deepLinkPath("tally://report/tw8zwkD3QJ6D", ORIGIN)).toBe("/report/tw8zwkD3QJ6D");
    expect(deepLinkPath("tally://s/tw8zwkD3QJ6D", ORIGIN)).toBe("/report/tw8zwkD3QJ6D");
  });

  it("opens a poll link", () => {
    expect(deepLinkPath(`${ORIGIN}/poll/abc123`, ORIGIN)).toBe("/poll/abc123");
  });

  it("ignores links from another site that mimic our paths", () => {
    expect(deepLinkPath("https://evil.test/s/abc123", ORIGIN)).toBeNull();
  });

  it("ignores an unknown surface", () => {
    expect(deepLinkPath(`${ORIGIN}/admin/abc123`, ORIGIN)).toBeNull();
  });

  it("ignores a bare origin with nothing to open", () => {
    expect(deepLinkPath(ORIGIN, ORIGIN)).toBeNull();
    expect(deepLinkPath(`${ORIGIN}/s`, ORIGIN)).toBeNull();
  });

  it("ignores unparseable input rather than throwing", () => {
    expect(deepLinkPath("not a url", ORIGIN)).toBeNull();
  });

  it("escapes a hostile id instead of letting it climb out of the route", () => {
    // Re-encoding is deliberate: the id stays one inert path segment. Report
    // ids are nanoid (alphanumeric, - and _), so nothing legitimate is escaped.
    const path = deepLinkPath("tally://report/..%2F..%2Fadmin", ORIGIN);
    expect(path).toBe("/report/..%252F..%252Fadmin");
    expect(path).not.toContain("/admin");
  });

  it("rejects a link with extra segments rather than guessing at it", () => {
    // URL parsing collapses `..`, so reading this loosely would silently open
    // a different id than the link appears to name.
    expect(deepLinkPath("tally://report/abc/../../poll/xyz", ORIGIN)).toBeNull();
    expect(deepLinkPath(`${ORIGIN}/report/abc/compare`, ORIGIN)).toBeNull();
  });
});
