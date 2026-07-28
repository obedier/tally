import { describe, expect, test } from "vitest";
import { extractOgImage, isLikelyGenericImage } from "./images";

describe("extractOgImage", () => {
  test("pulls og:image and resolves relative URLs", () => {
    const html = `<head><meta property="og:image" content="/img/product-123.jpg" /></head>`;
    expect(extractOgImage(html, "https://shop.example.com/p/1")).toBe(
      "https://shop.example.com/img/product-123.jpg",
    );
  });

  test("attribute order flipped still matches", () => {
    const html = `<meta content="https://cdn.example.com/hero.webp" property="og:image" />`;
    expect(extractOgImage(html, "https://example.com")).toBe("https://cdn.example.com/hero.webp");
  });

  test("falls through to twitter:image", () => {
    const html = `<meta name="twitter:image" content="https://cdn.example.com/t.png" />`;
    expect(extractOgImage(html, "https://example.com")).toBe("https://cdn.example.com/t.png");
  });

  // Regression (2026-07-27 live run): eBay served its logo as og:image and it
  // shipped as a "product image". Brand furniture must never pose as a product.
  test("rejects logos and default social banners", () => {
    const html = `<meta property="og:image" content="https://ir.ebaystatic.com/cr/v/c1/ebay-logo-1-1200x630-margin.png" />`;
    expect(extractOgImage(html, "https://ebay.com")).toBeNull();
  });

  test("rejects non-http and garbage URLs", () => {
    const html = `<meta property="og:image" content="javascript:alert(1)" />`;
    expect(extractOgImage(html, "https://example.com")).toBeNull();
  });

  test("no image meta yields null, never a substitute", () => {
    expect(extractOgImage("<head><title>x</title></head>", "https://example.com")).toBeNull();
  });
});

describe("isLikelyGenericImage", () => {
  test("flags brand furniture, passes product shots", () => {
    expect(isLikelyGenericImage("https://x.com/assets/site-logo.png")).toBe(true);
    expect(isLikelyGenericImage("https://x.com/og-default.jpg")).toBe(true);
    expect(isLikelyGenericImage("https://m.media-amazon.com/images/I/61abc.jpg")).toBe(false);
  });
});
