import { describe, expect, it } from "vitest";
import { displayHost } from "./host";

describe("displayHost", () => {
  it("credits the host a photo actually came from", () => {
    expect(displayHost("https://www.bobvila.com/img/vacuum.jpg")).toBe("bobvila.com");
    expect(displayHost("https://i5.walmartimages.com/asr/x.jpeg")).toBe("i5.walmartimages.com");
  });

  it("returns null for a missing image rather than an empty credit line", () => {
    expect(displayHost(null)).toBeNull();
  });

  it("returns null for an unparseable URL instead of throwing in render", () => {
    expect(displayHost("not a url")).toBeNull();
    expect(displayHost("")).toBeNull();
  });
});
