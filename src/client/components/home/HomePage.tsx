import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ResearchMode } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { Lockup, Spyglass } from "../ui/Lockup";
import { RecentResearch } from "./RecentResearch";
import "./home.css";

/** Entry values a visitor→searcher CTA may carry in ?entry= (growth loop). */
const CTA_ENTRIES = ["share-cta", "poll"] as const;
type CtaEntry = (typeof CTA_ENTRIES)[number];

/**
 * Home mode choice: Quick / Full research. Deep dive is offered post-report.
 * The timing lives in the accessible name rather than on the chip — the switch
 * sits above the search field, where width is the scarce resource, and the
 * research screen states the real estimate once a run is under way.
 */
const MODES: ReadonlyArray<{ id: ResearchMode; label: string; hint: string }> = [
  { id: "quick", label: "Quick", hint: "about 30 seconds" },
  { id: "full", label: "Full", hint: "a few minutes" },
];

export function HomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // A visitor arriving from a share/poll CTA carries ?entry=; their first search
  // is the converted visitor→searcher event (S7). An optional ?q= pre-fills.
  const rawEntry = params.get("entry");
  const ctaEntry: CtaEntry | null = CTA_ENTRIES.includes(rawEntry as CtaEntry)
    ? (rawEntry as CtaEntry)
    : null;
  const [draft, setDraft] = useState(() => params.get("q")?.trim() ?? "");
  const [mode, setMode] = useState<ResearchMode>("full");
  // Optional coarse location for local prices — off until the user opens it.
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");

  const startResearch = (query: string, entry: "home-search") => {
    const trimmed = query.trim();
    if (!trimmed) return;
    // A CTA arrival attributes the conversion to that source, not the local action.
    track({ name: "search_started", query: trimmed, mode, entry: ctaEntry ?? entry });
    const search = new URLSearchParams({ q: trimmed, mode });
    const place = locationDraft.trim();
    if (place !== "") search.set("location", place);
    navigate(`/research?${search.toString()}`);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startResearch(draft, "home-search");
  };

  return (
    <main className="page page--wide home">
      <Lockup />

      <section className="home__hero" aria-labelledby="home-heading">
        <h1 id="home-heading" className="display display--hero">
          Know before you buy.
        </h1>

        <form className="home__search-form" onSubmit={onSubmit}>
          <div className="home__modes" role="radiogroup" aria-label="Research depth">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mode === option.id}
                aria-label={`${option.label} research — ${option.hint}`}
                title={`${option.label} research — ${option.hint}`}
                className={`home__mode${mode === option.id ? " home__mode--on" : ""}`}
                onClick={() => setMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="home__search">
            <Spyglass className="home__search-glass" />
            <input
              type="search"
              name="q"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Product, Need, Problem, SKU…"
              aria-label="Start a product search"
              autoComplete="off"
              enterKeyHint="search"
            />
            <button
              type="submit"
              className={`home__search-go${draft.trim() ? " home__search-go--ready" : ""}`}
              aria-label="Start research"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>

          {locationOpen ? (
            <div className="home__location">
              <label className="micro-copy home__location-label" htmlFor="home-location">
                City or region for local prices
              </label>
              <input
                id="home-location"
                className="home__location-input"
                type="text"
                value={locationDraft}
                onChange={(event) => setLocationDraft(event.target.value)}
                placeholder="e.g. Seattle, WA"
                autoComplete="address-level2"
                maxLength={120}
              />
            </div>
          ) : (
            <button
              type="button"
              className="micro-copy home__location-toggle"
              onClick={() => setLocationOpen(true)}
            >
              <span aria-hidden="true">◎</span> Set a location for local prices (optional)
            </button>
          )}
        </form>
      </section>

      <div className="home__objects" aria-hidden="true">
        <img src="/product-images/catalog-vacuum.png" alt="" width="220" height="270" loading="eager" />
        <img src="/product-images/dutch-oven.png" alt="" width="220" height="270" loading="lazy" />
        <img src="/product-images/linen-bedding.png" alt="" width="220" height="270" loading="lazy" />
      </div>

      <RecentResearch limit={2} expandedLimit={10} />
    </main>
  );
}
