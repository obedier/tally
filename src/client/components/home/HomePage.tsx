import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ResearchMode } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { Lockup, Spyglass } from "../ui/Lockup";
import { RecentResearch } from "./RecentResearch";
import "./home.css";

const EXAMPLES: ReadonlyArray<{ label: string; query: string }> = [
  { label: "Try Dyson V12 Detect", query: "Dyson V12 Detect" },
  { label: "Try best vacuum for pet hair", query: "best vacuum for pet hair" },
];

/** Home mode choice: Quick / Full research. Deep dive is offered post-report, not here. */
const MODES: ReadonlyArray<{ id: ResearchMode; label: string; hint: string }> = [
  { id: "quick", label: "Quick", hint: "~30 seconds" },
  { id: "full", label: "Full research", hint: "a few minutes" },
];

export function HomePage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ResearchMode>("full");

  const startResearch = (query: string, entry: "home-search" | "example-chip") => {
    const trimmed = query.trim();
    if (!trimmed) return;
    track({ name: "search_started", query: trimmed, mode, entry });
    navigate(`/research?q=${encodeURIComponent(trimmed)}&mode=${mode}`);
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

          <div className="home__modes" role="radiogroup" aria-label="Research depth">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mode === option.id}
                className={`home__mode${mode === option.id ? " home__mode--on" : ""}`}
                onClick={() => setMode(option.id)}
              >
                {option.label} <small>{option.hint}</small>
              </button>
            ))}
          </div>
        </form>

        <p className="home__examples">
          {EXAMPLES.map((example, index) => (
            <span key={example.query}>
              {index > 0 ? <b aria-hidden="true">•</b> : null}
              <button type="button" onClick={() => startResearch(example.query, "example-chip")}>
                {example.label}
              </button>
            </span>
          ))}
        </p>
      </section>

      <div className="home__objects" aria-hidden="true">
        <img src="/product-images/catalog-vacuum.png" alt="" width="220" height="270" loading="eager" />
        <img src="/product-images/dutch-oven.png" alt="" width="220" height="270" loading="lazy" />
        <img src="/product-images/linen-bedding.png" alt="" width="220" height="270" loading="lazy" />
      </div>

      <RecentResearch />
    </main>
  );
}
