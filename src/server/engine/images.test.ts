import { describe, expect, test } from "vitest";
import {
  extractJsonLdProductImage,
  extractOgImage,
  isLikelyGenericImage,
  isRootUrl,
  nameTokens,
  pageMatchesProduct,
} from "./images";

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

  // Regression (live prod 2026-07-28): Walmart's homepage og:image (their
  // /dfw/ marketing CDN path) shipped as the "product image".
  test("flags retailer marketing-CDN generics", () => {
    expect(isLikelyGenericImage("https://i5.walmartimages.com/dfw/63fd9f59-49ff/k2.v1.png")).toBe(true);
    expect(isLikelyGenericImage("https://i5.walmartimages.com/asr/real-product.jpg")).toBe(false);
  });
});

describe("isRootUrl", () => {
  test("homepages are never product pages", () => {
    expect(isRootUrl("https://www.walmart.com")).toBe(true);
    expect(isRootUrl("https://www.walmart.com/")).toBe(true);
    expect(isRootUrl("https://www.walmart.com/ip/dyson-v12/123")).toBe(false);
    expect(isRootUrl("not a url")).toBe(true);
  });
});

describe("pageMatchesProduct", () => {
  const tokens = nameTokens("Dyson V12 Detect Slim");

  test("model numbers survive tokenization", () => {
    expect(tokens).toContain("v12");
    expect(tokens).toContain("dyson");
    expect(nameTokens("Bose A20")).toEqual(["bose", "a20"]);
  });

  // Regression (owner PDF 2026-07-28): an unrelated article's hero image
  // (a Dutch oven) shipped as the Dyson product photo. Pages that never
  // mention the product may not contribute images.
  test("unrelated article pages are rejected", () => {
    const html = `<head><title>The 9 Best Dutch Ovens of 2026</title></head>`;
    expect(pageMatchesProduct(html, tokens)).toBe(false);
  });

  test("product pages and reviews pass", () => {
    const review = `<meta property="og:title" content="Dyson V12 Detect Slim Review: Tested" />`;
    expect(pageMatchesProduct(review, tokens)).toBe(true);
    const plain = `<title>Dyson V12 Detect Slim Cordless Vacuum | Walmart</title>`;
    expect(pageMatchesProduct(plain, tokens)).toBe(true);
  });

  test("no title means no trust", () => {
    expect(pageMatchesProduct("<body>Dyson V12</body>", tokens)).toBe(false);
  });
});

describe("extractJsonLdProductImage", () => {
  test("prefers the Product schema image", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Dyson V12","image":"https://cdn.x.com/v12.jpg"}</script>`;
    expect(extractJsonLdProductImage(html, "https://x.com/p/1")).toBe("https://cdn.x.com/v12.jpg");
  });

  test("walks @graph and image arrays / ImageObject", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Article"},{"@type":"Product","image":[{"url":"https://cdn.x.com/a.png"}]}]}</script>`;
    expect(extractJsonLdProductImage(html, "https://x.com/p")).toBe("https://cdn.x.com/a.png");
  });

  test("malformed JSON and non-product schemas yield null", () => {
    expect(extractJsonLdProductImage(`<script type="application/ld+json">{oops</script>`, "https://x.com")).toBeNull();
    expect(extractJsonLdProductImage(`<script type="application/ld+json">{"@type":"Article","image":"https://x.com/hero.jpg"}</script>`, "https://x.com")).toBeNull();
  });

  test("generic/logo images still rejected", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","image":"https://x.com/site-logo.png"}</script>`;
    expect(extractJsonLdProductImage(html, "https://x.com")).toBeNull();
  });
});
