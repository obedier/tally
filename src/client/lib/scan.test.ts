import { describe, expect, it } from "vitest";
import {
  acceptScannedCode,
  classifyCameraError,
  isGtin,
  normalizeScannedCode,
  scanQuery,
} from "./scan";

/** getUserMedia rejects with a DOMException; only `name` carries the reason. */
const domError = (name: string): Error => Object.assign(new Error(name), { name });

describe("normalizeScannedCode", () => {
  it("keeps a clean numeric code as-is", () => {
    expect(normalizeScannedCode("012345678905")).toBe("012345678905");
  });

  it("strips the spacing printed under a barcode", () => {
    expect(normalizeScannedCode(" 0 12345 67890 5 ")).toBe("012345678905");
    expect(normalizeScannedCode("885909-950-805")).toBe("885909950805");
  });

  it("upper-cases alphanumeric SKUs so the same label always yields one query", () => {
    expect(normalizeScannedCode("wd-40x100")).toBe("WD40X100");
  });

  it("rejects decodes that are too short or too long to be a product code", () => {
    expect(normalizeScannedCode("12345")).toBeNull();
    expect(normalizeScannedCode("")).toBeNull();
    expect(normalizeScannedCode("A".repeat(49))).toBeNull();
  });

  it("rejects decoded prose and URLs — a QR code is not automatically a product", () => {
    expect(normalizeScannedCode("https://example.com/promo?utm=qr")).toBeNull();
    expect(normalizeScannedCode("Scan me for 20% off!")).toBeNull();
  });
});

describe("isGtin", () => {
  it("accepts real retail barcodes with correct check digits", () => {
    expect(isGtin("012345678905")).toBe(true); // UPC-A
    expect(isGtin("4006381333931")).toBe(true); // EAN-13
    expect(isGtin("96385074")).toBe(true); // EAN-8
  });

  it("rejects a single-digit misread — the whole reason the check digit exists", () => {
    expect(isGtin("012345678906")).toBe(false);
    expect(isGtin("4006381333932")).toBe(false);
  });

  it("rejects codes that are not a GTIN length at all", () => {
    expect(isGtin("1234567890")).toBe(false);
    expect(isGtin("ABC12345")).toBe(false);
  });
});

describe("acceptScannedCode", () => {
  it("accepts a verified retail barcode", () => {
    expect(acceptScannedCode(" 0 12345 67890 5 ")).toBe("012345678905");
  });

  it("refuses a GTIN-shaped code whose check digit fails", () => {
    // Researching the wrong product confidently is worse than asking for a re-scan.
    expect(acceptScannedCode("012345678906")).toBeNull();
  });

  it("accepts manufacturer SKUs, which carry no shared checksum", () => {
    expect(acceptScannedCode("bc-2027xl")).toBe("BC2027XL");
  });

  it("accepts numeric codes that are not GTIN-shaped without a checksum claim", () => {
    expect(acceptScannedCode("1234567")).toBe("1234567");
  });

  it("passes normalization rejections straight through", () => {
    expect(acceptScannedCode("https://example.com")).toBeNull();
  });
});

describe("classifyCameraError", () => {
  it("treats a refused permission as something the user can turn back on", () => {
    expect(classifyCameraError(domError("NotAllowedError"))).toBe("denied");
    expect(classifyCameraError(domError("SecurityError"))).toBe("denied");
  });

  it("treats a missing camera stack as 'no camera' — the Simulator and headless case", () => {
    expect(classifyCameraError(domError("NotFoundError"))).toBe("no-camera");
    expect(classifyCameraError(domError("NotSupportedError"))).toBe("no-camera");
    expect(classifyCameraError(domError("OverconstrainedError"))).toBe("no-camera");
  });

  it("falls back to 'unavailable' for hardware that exists but won't start", () => {
    expect(classifyCameraError(domError("NotReadableError"))).toBe("unavailable");
    expect(classifyCameraError("not an error at all")).toBe("unavailable");
  });
});

describe("scanQuery", () => {
  it("sends the code through verbatim rather than inventing a product name", () => {
    expect(scanQuery("012345678905")).toBe("012345678905");
  });
});
