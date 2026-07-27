import type { Alternative, ProductPick, Report, Source } from "../../shared/report";

/**
 * Server-rendered public share page (docs/GROWTH.md). No React, no client
 * bundle: a self-contained editorial HTML document carrying the full verdict,
 * tradeoffs, comparison shortlist, and sources, with per-report OG/social meta.
 *
 * SECURITY (non-negotiable): every report-derived string is model/user content
 * and may contain markup. It is escaped with `esc` before it reaches the HTML
 * or an attribute — there is no path by which raw report text is emitted.
 */

/** Exact required strings, verbatim from docs/GROWTH.md — never edit casually. */
const ATTRIBUTION = "Researched by Tally";
const CTA_LABEL = "Research your own — free";
const RERUN_LABEL = "prices may have changed — re-run this research";

/** Escape for HTML text nodes AND double-quoted attributes. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapse to a single attribute-safe line (for <meta> descriptions). */
function metaText(value: string): string {
  return esc(value.replace(/\s+/g, " ").trim());
}

/** Human research date, e.g. "July 27, 2026". Falls back to the raw ISO string. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** SPA link that re-runs this research for the visitor. */
function rerunHref(report: Report): string {
  const params = new URLSearchParams({ q: report.query, mode: report.meta.mode });
  return `/research?${params.toString()}`;
}

/** SPA link to the home search, pre-warmed to attribute the share-CTA entry. */
function ctaHref(report: Report): string {
  const params = new URLSearchParams({ entry: "share-cta", example: report.query });
  return `/?${params.toString()}`;
}

/** One decisive line for the OG description: a decisive factor, else the key tradeoff. */
function ogDescription(report: Report): string {
  const factor = report.verdict.decisiveFactors[0];
  if (factor) {
    return factor;
  }
  const keyAlt = report.alternatives.find((a) => a.isKeyAlternative) ?? report.alternatives[0];
  if (keyAlt) {
    return `${keyAlt.name}: ${keyAlt.note}`;
  }
  return report.verdict.rationale;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

function renderProsCons(pros: string[], cons: string[]): string {
  const proItems = pros.map((p) => `<li>${esc(p)}</li>`).join("");
  const conItems = cons.map((c) => `<li>${esc(c)}</li>`).join("");
  return `
    <div class="proscons">
      ${pros.length ? `<div class="pros"><h4>Strengths</h4><ul>${proItems}</ul></div>` : ""}
      ${cons.length ? `<div class="cons"><h4>Trade-offs</h4><ul>${conItems}</ul></div>` : ""}
    </div>`;
}

function renderBestFit(pick: ProductPick): string {
  const rating =
    pick.rating && pick.rating.value !== null
      ? `<span class="rating">${esc(pick.rating.value.toFixed(1))} / 5</span>`
      : "";
  return `
    <section class="card bestfit" aria-labelledby="bestfit-heading">
      <p class="kicker">Best fit</p>
      <h3 id="bestfit-heading">${esc(pick.name)}</h3>
      <p class="price">${esc(pick.priceRange.display)} ${rating}</p>
      <p class="why">${esc(pick.whyBest)}</p>
      ${renderProsCons(pick.pros, pick.cons)}
    </section>`;
}

function renderAlternative(alt: Alternative): string {
  const price = alt.priceRange ? esc(alt.priceRange.display) : "Check retailer";
  const keyTag = alt.isKeyAlternative
    ? `<span class="tag">Best for different priorities</span>`
    : "";
  return `
    <li class="card alt">
      <div class="alt-head">
        <h4>${esc(alt.name)}</h4>
        ${keyTag}
      </div>
      <p class="price">${price}</p>
      <p class="note">${esc(alt.note)}</p>
      ${alt.pros.length || alt.cons.length ? renderProsCons(alt.pros, alt.cons) : ""}
    </li>`;
}

function renderSource(source: Source): string {
  return `
    <li>
      <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(source.title)}</a>
      <span class="domain">${esc(source.domain)} · ${esc(source.sourceClass)}</span>
    </li>`;
}

/** The Tally lockup: serif wordmark + spyglass, per docs/PRODUCT.md. */
function wordmark(): string {
  return `
    <span class="wordmark">
      <svg class="spyglass" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="6.25" fill="none" stroke="currentColor" stroke-width="1.75" />
        <line x1="14.6" y1="14.6" x2="20" y2="20" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
      </svg>
      <span class="wordmark-text">Tally</span>
    </span>`;
}

/**
 * Minimal, dependency-free telemetry: emits share_page_viewed on load and
 * cta_clicked on either CTA. Anonymous ids only (localStorage-persisted or a
 * fresh id) — never identity. Matches EventEnvelopeSchema + the event bodies in
 * src/shared/telemetry.ts. Failures are swallowed; telemetry never blocks the page.
 */
function telemetryScript(reportId: string): string {
  const safeId = JSON.stringify(reportId);
  return `<script>(function(){
  try {
    var K="tally.deviceId", S="tally.sessionId";
    function anonId(){var b=new Uint8Array(12);(crypto.getRandomValues?crypto:{getRandomValues:function(a){for(var i=0;i<a.length;i++)a[i]=Math.floor(Math.random()*256);return a}}).getRandomValues(b);var s="";for(var i=0;i<b.length;i++){s+=(b[i]&255).toString(36)}return s.replace(/[^A-Za-z0-9_-]/g,"0").slice(0,22).padEnd(12,"0")}
    function get(store,key){try{var v=store.getItem(key);if(v)return v;v=anonId();store.setItem(key,v);return v}catch(e){return anonId()}}
    var deviceId=get(localStorage,K);
    var firstTouch=false;
    try{if(!localStorage.getItem(K+".seen")){firstTouch=true;localStorage.setItem(K+".seen","1")}}catch(e){firstTouch=true}
    var sessionId=(function(){try{var v=sessionStorage.getItem(S);if(v)return v;v=anonId();sessionStorage.setItem(S,v);return v}catch(e){return anonId()}})();
    var REPORT=${safeId};
    function send(name,body){
      var evt=Object.assign({eventId:(crypto.randomUUID?crypto.randomUUID():anonId()+anonId()),sessionId:sessionId,deviceId:deviceId,ts:new Date().toISOString(),name:name},body);
      try{
        var payload=JSON.stringify({events:[evt]});
        if(navigator.sendBeacon){navigator.sendBeacon("/api/events",new Blob([payload],{type:"application/json"}))}
        else{fetch("/api/events",{method:"POST",headers:{"Content-Type":"application/json"},body:payload,keepalive:true})}
      }catch(e){}
    }
    send("share_page_viewed",{reportId:REPORT,firstTouch:firstTouch});
    var ctas=document.querySelectorAll("[data-cta]");
    for(var i=0;i<ctas.length;i++){(function(el){el.addEventListener("click",function(){send("cta_clicked",{reportId:REPORT,cta:el.getAttribute("data-cta")})})})(ctas[i])}
  } catch(e) {}
})();</script>`;
}

const STYLES = `
:root{
  --paper:#fbfaf7;--ink:#171c1b;--green:#12543b;--green-deep:#0b2b20;
  --green-soft:#799087;--orange:#d94d18;--line:#dedbd3;--muted:#6e746e;
  --card:#fffdf8;--green-wash:#eef2ed;--chip:#eceae5;--on-green:#fbfaf7;
  --shadow:0 2px 2px rgba(13,31,22,.06),0 7px 16px rgba(13,31,22,.035);
  --serif:"Playfair Display",Georgia,"Times New Roman",serif;
  --ui:"DM Sans",-apple-system,"Segoe UI",sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--ui);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--green)}
.shell{max-width:680px;margin:0 auto;padding:1.5rem 1.25rem 4rem}
header.brand{display:flex;align-items:center;justify-content:space-between;
  padding-bottom:1rem;border-bottom:1px solid var(--line);margin-bottom:1.75rem}
.wordmark{display:inline-flex;align-items:center;gap:.4rem;color:var(--green-deep)}
.wordmark-text{font-family:var(--serif);font-weight:700;font-size:1.35rem;letter-spacing:-.02em}
.spyglass{color:var(--green)}
.brand .tagline{font-size:.75rem;color:var(--muted);letter-spacing:.02em}
.kicker{font-size:.6875rem;text-transform:uppercase;letter-spacing:.09em;
  color:var(--green-soft);margin:0 0 .35rem;font-weight:600}
.verdict{margin-bottom:2rem}
.verdict h1{font-family:var(--serif);font-weight:700;font-size:clamp(1.9rem,1.3rem+2.6vw,2.6rem);
  line-height:1.1;letter-spacing:-.03em;margin:.2rem 0 .75rem;color:var(--green-deep)}
.verdict .rationale{font-size:1.05rem;margin:0 0 1rem}
.confidence{display:inline-block;font-size:.75rem;font-weight:600;padding:.25rem .6rem;
  border-radius:999px;background:var(--green-wash);color:var(--green);border:1px solid var(--line)}
.confidence.low{color:var(--orange);background:#fbeee7;border-color:#f2c9b5}
.confidence-reason{font-size:.875rem;line-height:1.5;color:var(--ink);margin:.5rem 0 0}
.factors{margin:1.25rem 0 0;padding:0;list-style:none}
.factors li{padding:.5rem 0 .5rem .9rem;border-left:3px solid var(--green);margin-bottom:.4rem;
  background:var(--green-wash);border-radius:0 6px 6px 0}
h2.section{font-family:var(--serif);font-weight:700;font-size:1.35rem;letter-spacing:-.02em;
  margin:2.25rem 0 1rem;color:var(--green-deep)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;
  padding:1.1rem 1.15rem;box-shadow:var(--shadow);margin-bottom:1rem}
.card h3{font-family:var(--serif);font-size:1.4rem;margin:.1rem 0 .4rem;color:var(--green-deep)}
.card h4{margin:.1rem 0 .3rem;font-size:1.05rem}
.price{font-weight:600;color:var(--ink);margin:.2rem 0 .6rem}
.rating{font-weight:500;color:var(--muted);font-size:.85rem;margin-left:.4rem}
.why,.note{margin:.4rem 0;color:var(--ink)}
.proscons{display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-top:.75rem}
@media(max-width:520px){.proscons{grid-template-columns:1fr}}
.proscons h4{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 .3rem}
.proscons ul{margin:0;padding-left:1.1rem;font-size:.875rem}
.proscons .cons li{color:var(--orange)}
ol.alts{list-style:none;margin:0;padding:0}
.alt-head{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;flex-wrap:wrap}
.tag{font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--orange);background:#fbeee7;padding:.15rem .5rem;border-radius:999px;white-space:nowrap}
ul.sources{list-style:none;margin:0;padding:0}
ul.sources li{padding:.55rem 0;border-bottom:1px solid var(--line);font-size:.9rem}
ul.sources .domain{display:block;font-size:.75rem;color:var(--muted);margin-top:.15rem}
.rerun{margin:2rem 0;padding:1rem 1.15rem;background:var(--green-wash);border-radius:10px;
  border:1px solid var(--line)}
.rerun .date{font-size:.8125rem;color:var(--muted);margin:0 0 .5rem}
.rerun a{font-weight:600}
.cta{display:block;text-align:center;margin:2.5rem 0 1rem;padding:1.1rem 1.25rem;
  background:var(--green);color:var(--on-green);border-radius:10px;font-size:1.1rem;
  font-weight:600;text-decoration:none;font-family:var(--serif);letter-spacing:-.01em}
.cta:hover{background:var(--green-deep)}
.cta-sub{text-align:center;font-size:.8125rem;color:var(--muted);margin:.4rem 0 0}
footer.attribution{margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--line);
  display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:.8125rem}
`;

/**
 * Build the complete, self-contained share HTML document for a report.
 * @param report the stable, already-validated report contract
 * @param origin absolute origin (e.g. "https://tally.app") used for canonical + og:image
 */
export function buildShareHtml(report: Report, origin: string): string {
  const base = origin.replace(/\/$/, "");
  const shareUrl = `${base}/s/${encodeURIComponent(report.id)}`;
  const ogImage = `${base}/og/${encodeURIComponent(report.id)}.png`;
  const title = report.verdict.headline;
  const description = ogDescription(report);
  const researchDate = formatDate(report.createdAt);
  const confidenceKey = report.verdict.confidence;

  const altsHtml = report.alternatives.length
    ? `<h2 class="section">Also considered</h2><ol class="alts">${report.alternatives
        .map(renderAlternative)
        .join("")}</ol>`
    : "";

  const sourcesHtml = report.sources.length
    ? `<h2 class="section">Sources</h2><ul class="sources">${report.sources
        .map(renderSource)
        .join("")}</ul>`
    : "";

  const factorsHtml = report.verdict.decisiveFactors.length
    ? `<ul class="factors">${report.verdict.decisiveFactors
        .map((f) => `<li>${esc(f)}</li>`)
        .join("")}</ul>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — ${ATTRIBUTION}</title>
<meta name="description" content="${metaText(description)}" />
<link rel="canonical" href="${esc(shareUrl)}" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${metaText(title)}" />
<meta property="og:description" content="${metaText(description)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:url" content="${esc(shareUrl)}" />
<meta property="og:site_name" content="Tally" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${metaText(title)}" />
<meta name="twitter:description" content="${metaText(description)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
<style>${STYLES}</style>
</head>
<body>
<div class="shell">
  <header class="brand">
    ${wordmark()}
    <span class="tagline">Deep product research.</span>
  </header>

  <section class="verdict" aria-labelledby="verdict-heading">
    <p class="kicker">${esc(report.query)}</p>
    <h1 id="verdict-heading">${esc(title)}</h1>
    <p class="rationale">${esc(report.verdict.rationale)}</p>
    <span class="confidence ${confidenceKey === "low" ? "low" : ""}">${esc(
      CONFIDENCE_LABEL[confidenceKey] ?? confidenceKey,
    )}</span>
    <p class="confidence-reason">${esc(report.verdict.confidenceReason)}</p>
    ${factorsHtml}
  </section>

  ${renderBestFit(report.bestFit)}
  ${altsHtml}
  ${sourcesHtml}

  <div class="rerun">
    <p class="date">Researched ${esc(researchDate)}</p>
    <a href="${esc(rerunHref(report))}" data-cta="re-run">${RERUN_LABEL}</a>
  </div>

  <a class="cta" href="${esc(ctaHref(report))}" data-cta="research-your-own">${CTA_LABEL}</a>
  <p class="cta-sub">No account. Independent, evidence-backed research.</p>

  <footer class="attribution">
    ${wordmark()}
    <span>${ATTRIBUTION}</span>
  </footer>
</div>
${telemetryScript(report.id)}
</body>
</html>`;
}

/** Honest, branded 404 for an unknown share id (never a stack trace). */
export function buildNotFoundHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Research not found — Tally</title>
<meta name="robots" content="noindex" />
<style>${STYLES}</style>
</head>
<body>
<div class="shell">
  <header class="brand">
    ${wordmark()}
    <span class="tagline">Deep product research.</span>
  </header>
  <section class="verdict">
    <h1>This research isn't available</h1>
    <p class="rationale">The link may be mistyped or the research may have been removed. You can run a fresh, independent research in seconds.</p>
  </section>
  <a class="cta" href="/?entry=share-cta">${CTA_LABEL}</a>
</div>
</body>
</html>`;
}
