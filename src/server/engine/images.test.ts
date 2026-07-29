import { describe, expect, it, test } from "vitest";
import {
  isPubliclyFetchable,
  isVideoThumbnail,
  summarizeHarvest,
  candidateUrls,
  extractJsonLdProductImage,
  extractOgImage,
  harvestImage,
  isLikelyGenericImage,
  isRootUrl,
  isSearchUrl,
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

describe("isSearchUrl", () => {
  test("recognises the retailer search URLs we link shoppers to", () => {
    // These are exactly what deepRetailerUrl() produces from a bare homepage.
    expect(isSearchUrl("https://www.amazon.com/s?k=Dyson%20V12")).toBe(true);
    expect(isSearchUrl("https://www.walmart.com/search?q=Dyson%20V12")).toBe(true);
    expect(isSearchUrl("https://www.target.com/s?searchTerm=Dyson")).toBe(true);
    expect(isSearchUrl("https://www.bestbuy.com/site/searchpage.jsp?st=Dyson")).toBe(true);
    expect(isSearchUrl("https://www.costco.com/CatalogSearch?keyword=Dyson")).toBe(true);
    expect(isSearchUrl("https://www.ebay.com/sch/i.html?_nkw=Dyson")).toBe(true);
  });

  test("leaves real product and article pages alone", () => {
    expect(isSearchUrl("https://www.bobvila.com/articles/dyson-v12-review/")).toBe(false);
    expect(isSearchUrl("https://www.amazon.com/dp/B0BSHF7WHW")).toBe(false);
    expect(isSearchUrl("https://www.dyson.com/vacuum-cleaners/sticks/v12")).toBe(false);
  });

  test("unparseable input is not treated as a search page", () => {
    expect(isSearchUrl("not a url")).toBe(false);
  });
});

describe("candidateUrls", () => {
  test("drops homepages and search pages, which can never hold a product image", () => {
    expect(
      candidateUrls([
        "https://www.dyson.com",
        "https://www.amazon.com/s?k=Dyson",
        "https://www.bobvila.com/articles/dyson-v12-review/",
      ]),
    ).toEqual(["https://www.bobvila.com/articles/dyson-v12-review/"]);
  });

  test("preserves priority order and de-duplicates", () => {
    expect(
      candidateUrls(["https://a.test/p", "https://b.test/p", "https://a.test/p"]),
    ).toEqual(["https://a.test/p", "https://b.test/p"]);
  });

  test("caps how many pages one pick may fetch", () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://site${i}.test/p`);
    expect(candidateUrls(many)).toHaveLength(6);
  });
});

describe("harvestImage", () => {
  const page = (html: string, finalUrl: string) => ({ html, finalUrl });
  const ogPage = (title: string, image: string, url: string) =>
    page(`<title>${title}</title><meta property="og:image" content="${image}">`, url);

  test("returns the highest-priority page's image, not whichever resolved first", async () => {
    const load = async (url: string) =>
      url === "https://first.test/p"
        ? ogPage("Dyson V12 Detect Slim review", "https://cdn.first.test/v12.jpg", url)
        : ogPage("Dyson V12 Detect Slim deal", "https://cdn.second.test/v12.jpg", url);
    const image = await harvestImage(
      ["https://first.test/p", "https://second.test/p"],
      "Dyson V12 Detect Slim",
      load,
    );
    expect(image).toBe("https://cdn.first.test/v12.jpg");
  });

  test("falls through a bot-blocked retailer to a source that works", async () => {
    // The real failure mode: retailers 403, sources answer. Previously the
    // retailer attempts consumed the whole budget and the image was lost.
    const load = async (url: string) =>
      url.includes("amazon")
        ? null
        : ogPage("Dyson V12 Detect Slim review", "https://cdn.bobvila.test/v12.jpg", url);
    const image = await harvestImage(
      ["https://www.amazon.com/dp/B0", "https://bobvila.test/review"],
      "Dyson V12 Detect Slim",
      load,
    );
    expect(image).toBe("https://cdn.bobvila.test/v12.jpg");
  });

  test("never takes an image from a page that doesn't name the product", async () => {
    const load = async (url: string) =>
      ogPage("The 8 best Dutch ovens we tested", "https://cdn.x.test/dutch-oven.jpg", url);
    expect(await harvestImage(["https://x.test/roundup"], "Dyson V12 Detect Slim", load)).toBeNull();
  });

  test("an unnameable product harvests nothing rather than anything", async () => {
    const load = async (url: string) => ogPage("anything", "https://cdn.x.test/a.jpg", url);
    expect(await harvestImage(["https://x.test/p"], "", load)).toBeNull();
  });
});

describe("pageMatchesProduct — identification, not mention", () => {
  // Regression (local run 2026-07-28): widening the candidate list gave the
  // Dyson V12's review photo to the Gen5detect and the V15, because all three
  // matched the single token "dyson". Same brand is not the same product.
  const v12Title = `<title>Dyson V12 Detect Slim Review: Tested and Rated</title>`;

  test("a sibling model may not borrow its brandmate's photo", () => {
    expect(pageMatchesProduct(v12Title, nameTokens("Dyson Gen5detect"))).toBe(false);
    expect(pageMatchesProduct(v12Title, nameTokens("Dyson V15 Detect"))).toBe(false);
  });

  test("the product the page is actually about still matches", () => {
    expect(pageMatchesProduct(v12Title, nameTokens("Dyson V12 Detect Slim"))).toBe(true);
  });

  test("brand alone never identifies a product", () => {
    const html = `<title>Samsung vacuums: everything announced this year</title>`;
    expect(pageMatchesProduct(html, nameTokens("Samsung Bespoke Jet AI"))).toBe(false);
  });

  test("model-free names need a majority of their words", () => {
    const tokens = nameTokens("Lodge 6 quart enameled Dutch oven");
    expect(pageMatchesProduct(`<title>Lodge Enameled Dutch Oven Review</title>`, tokens)).toBe(true);
    expect(pageMatchesProduct(`<title>The best Dutch ovens of 2026</title>`, tokens)).toBe(false);
  });
});

describe("isVideoThumbnail", () => {
  it("rejects video-platform thumbnails posing as product photos", () => {
    // Two of these shipped as product images before image sources were counted.
    expect(isVideoThumbnail("https://i.ytimg.com/vi/abc123/maxresdefault.jpg")).toBe(true);
    expect(isVideoThumbnail("https://i9.ytimg.com/vi/x/hq.jpg")).toBe(true);
    expect(isVideoThumbnail("https://i.vimeocdn.com/video/12345_640.jpg")).toBe(true);
  });

  it("keeps real product CDNs", () => {
    expect(isVideoThumbnail("https://i5.walmartimages.com/asr/abc.jpeg")).toBe(false);
    expect(isVideoThumbnail("https://cdn.mos.cms.futurecdn.net/x.jpg")).toBe(false);
  });

  it("does not match a lookalike domain that merely contains the string", () => {
    expect(isVideoThumbnail("https://notytimg.com.example.org/a.jpg")).toBe(false);
  });

  it("treats an unparseable URL as not a video thumbnail", () => {
    expect(isVideoThumbnail("not a url")).toBe(false);
  });
});

describe("isPubliclyFetchable", () => {
  it("allows ordinary public pages", () => {
    expect(isPubliclyFetchable("https://www.bobvila.com/reviews/vacuum")).toBe(true);
    expect(isPubliclyFetchable("http://example.com/p/1")).toBe(true);
  });

  it("blocks loopback and localhost — candidate URLs come from model output", () => {
    expect(isPubliclyFetchable("http://127.0.0.1:8787/api/health")).toBe(false);
    expect(isPubliclyFetchable("http://localhost/")).toBe(false);
    expect(isPubliclyFetchable("http://app.localhost/")).toBe(false);
  });

  it("blocks private and link-local ranges, including cloud metadata", () => {
    expect(isPubliclyFetchable("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isPubliclyFetchable("http://metadata.google.internal/")).toBe(false);
    expect(isPubliclyFetchable("http://10.0.0.5/")).toBe(false);
    expect(isPubliclyFetchable("http://192.168.1.1/")).toBe(false);
    expect(isPubliclyFetchable("http://172.16.0.1/")).toBe(false);
    expect(isPubliclyFetchable("http://172.31.255.1/")).toBe(false);
  });

  it("does not over-block public addresses that merely look adjacent", () => {
    expect(isPubliclyFetchable("http://172.32.0.1/")).toBe(true);
    expect(isPubliclyFetchable("http://11.0.0.1/")).toBe(true);
  });

  it("blocks non-http schemes outright", () => {
    expect(isPubliclyFetchable("file:///etc/passwd")).toBe(false);
    expect(isPubliclyFetchable("ftp://example.com/x")).toBe(false);
    expect(isPubliclyFetchable("data:text/html,<h1>x")).toBe(false);
  });

  it("rejects an unparseable URL rather than defaulting to fetchable", () => {
    expect(isPubliclyFetchable("http://")).toBe(false);
  });
});

describe("summarizeHarvest", () => {
  it("counts hits against attempts", () => {
    expect(summarizeHarvest({ bestFit: "https://x/a.jpg" })).toEqual({ attempted: 1, hit: 1 });
    expect(summarizeHarvest({ bestFit: null })).toEqual({ attempted: 1, hit: 0 });
  });

  it("reports a partial run honestly", () => {
    expect(summarizeHarvest({ a: "https://x/1.jpg", b: null, c: "https://x/2.jpg" })).toEqual({
      attempted: 3,
      hit: 2,
    });
  });

  it("handles a run with no tasks without dividing by zero downstream", () => {
    expect(summarizeHarvest({})).toEqual({ attempted: 0, hit: 0 });
  });
});
