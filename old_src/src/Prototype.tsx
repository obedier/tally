import { useEffect, useState } from "react";
import { BookmarkIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, Cross1Icon, FileTextIcon, HomeIcon, MagnifyingGlassIcon, Pencil1Icon, PlusIcon, ReloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { BottomSheet, KeyboardInput, MobileScroll } from "./mobile";

type Question = { id: string; label: string; state: "done" | "active" | "next"; reason?: string };
type View = "home" | "research" | "summary" | "detail" | "prices";
type Report = { query: string; verdict: string; bestFit: { name: string; price: string; rating: string; reviews: string; summary: string; pros: string[]; cons: string[] }; alternatives: { name: string; price: string; rating: string; note: string }[]; retailers: { type: string; seller: string; price: string; availability: string }[]; assumptions: string[]; questions: string[]; timeSaved: string; confidence: string };
type Source = { title: string; url: string };

const initialQuestions: Question[] = [
  { id: "assumptions", label: "What should we assume about your home and priorities?", state: "done" },
  { id: "pickup", label: "Which models remove pet hair best?", state: "done" },
  { id: "storage", label: "How easy are they to store in a small apartment?", state: "active", reason: "Storage affects whether a powerful vacuum is actually practical to keep and use." },
  { id: "ownership", label: "What does it cost to maintain them?", state: "next" },
  { id: "support", label: "Which warranty and support options matter?", state: "next" },
];
const assumptionList = [["Small apartment", "Under 700 sq ft"], ["Pet hair is the top priority", "Maximum pickup, minimal tangles"], ["Cordless is preferred", "Easier to move and store"], ["Budget is flexible", "Open to premium options"]] as const;
const comps = [
  ["Shark Stratos Cordless Pet Pro", "$299–$399", "4.5 · 8,200 reviews", "Excellent brushroll; heavier", "/product-images/backup-vacuum.png"],
  ["BISSELL MultiClean Allergen Lift-Off", "$199–$279", "4.3 · 3,100 reviews", "Great value; bulkier", "/product-images/lead-vacuum.png"],
  ["Tineco Pure One S15", "$249–$349", "4.4 · 1,800 reviews", "Smart sensing; smaller bin", "/product-images/backup-vacuum.png"],
  ["Miele Triflex HX2", "$449–$649", "4.4 · 990 reviews", "Premium build; expensive", "/product-images/lead-vacuum.png"],
  ["LG CordZero A949", "$399–$549", "4.5 · 2,600 reviews", "Two batteries; heavy dock", "/product-images/backup-vacuum.png"],
  ["Samsung Bespoke Jet", "$429–$649", "4.4 · 1,400 reviews", "Self-emptying; premium cost", "/product-images/lead-vacuum.png"],
  ["Eureka RapidClean Pro", "$129–$199", "4.2 · 5,700 reviews", "Affordable; shorter runtime", "/product-images/backup-vacuum.png"],
  ["Hoover ONEPWR Evolve", "$199–$299", "4.3 · 2,200 reviews", "Lightweight; less refined", "/product-images/lead-vacuum.png"],
  ["Kenmore DS1030", "$179–$249", "4.2 · 1,100 reviews", "Strong value; smaller bin", "/product-images/backup-vacuum.png"],
  ["Levoit LVAC-200", "$149–$199", "4.4 · 3,900 reviews", "Quiet; lower peak suction", "/product-images/lead-vacuum.png"],
];
const makeFallbackReport = (query: string): Report => ({ query, verdict: "A research-ready shortlist based on the priorities implied by your search. Confirm the assumptions to sharpen the ranking.", bestFit: { name: "Dyson V12 Detect Slim", price: "$499–$649", rating: "4.6 / 5", reviews: "14,231 verified reviews", summary: "Strong pickup in a light, compact machine that is easy to store.", pros: ["Excellent pet-hair pickup", "Light, compact, easy to store", "Strong floor-head design"], cons: ["Premium price", "Small dust bin", "Battery drops on max mode"] }, alternatives: comps.map(([name, price, rating, note]) => ({ name, price, rating: rating.split(" ·")[0], note })), retailers: [{ type: "Online", seller: "Dyson", price: "$649", availability: "Check delivery availability" }, { type: "Online", seller: "Amazon", price: "$599", availability: "Check current stock" }, { type: "Online", seller: "Best Buy", price: "$549", availability: "Check pickup availability" }, { type: "Local", seller: "Target", price: "$499", availability: "Check local store stock" }, { type: "Local", seller: "Costco", price: "$529", availability: "Check warehouse stock" }], assumptions: ["Small living space", "Performance is a top priority", "Easy storage is useful", "Budget is flexible"], questions: ["What performs best for the key job?", "What is practical to store and maintain?", "Which price tradeoffs are justified?"], timeSaved: "2–4", confidence: "Early" });

export default function Prototype() {
  const [view, setView] = useState<View>("home");
  const [questions, setQuestions] = useState(initialQuestions);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [assumptions, setAssumptions] = useState([true, true, false, false]);
  const [customAssumption, setCustomAssumption] = useState("");
  const [customQuestion, setCustomQuestion] = useState("");
  const [openAssumptions, setOpenAssumptions] = useState<string[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [currentSearch, setCurrentSearch] = useState("Best vacuum for pet hair in a small apartment");
  const [pastSearches, setPastSearches] = useState<string[]>(() => JSON.parse(localStorage.getItem("tally-recent-research") || "[\"Dyson V12 Detect vs V15 Detect\",\"Best non-toxic Dutch oven\",\"Quiet air purifier for a bedroom\",\"Best sheets for hot sleepers\"]"));
  const [report, setReport] = useState<Report>(() => makeFallbackReport("Best vacuum for pet hair in a small apartment"));
  const [researchState, setResearchState] = useState<"ready" | "working" | "complete" | "fallback">("ready");
  const [sourceCount, setSourceCount] = useState(0);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => { localStorage.setItem("tally-recent-research", JSON.stringify(pastSearches)); }, [pastSearches]);

  const removeQuestion = (id: string) => setQuestions((items) => items.filter((item) => item.id !== id));
  const addQuestion = (label: string) => {
    if (!label.trim() || questions.some((question) => question.label === label.trim())) return;
    setQuestions((items) => [...items, { id: `${label}-${Date.now()}`, label: label.trim(), state: "next" }]);
    setCustomQuestion("");
    setSuggestionsOpen(false);
  };
  const addAssumption = () => {
    if (!customAssumption.trim()) return;
    setOpenAssumptions((items) => [...items, customAssumption.trim()]);
    setCustomAssumption("");
  };
  const toggleSaved = (name: string) => setSaved((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]);
  const startSearch = async () => {
    if (!searchDraft.trim()) return;
    const search = searchDraft.trim();
    setCurrentSearch(search); setPastSearches((items) => [search, ...items.filter((item) => item !== search)]); setSearchDraft(""); setView("research"); setResearchState("working"); setSourceCount(0);
    const fallback = makeFallbackReport(search);
    try {
      const response = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: search, location: "United States", mode: "full" }) });
      if (!response.ok) throw new Error("Research service is not configured");
      const result = await response.json();
      const live = result.report as Partial<Report>;
      setReport({ ...fallback, ...live, query: search, bestFit: { ...fallback.bestFit, ...live.bestFit }, alternatives: live.alternatives?.length ? live.alternatives : fallback.alternatives, retailers: live.retailers?.length ? live.retailers : fallback.retailers });
      setSources(result.sources || []); setSourceCount(result.sources?.length || 0); setResearchState("complete");
    } catch { setReport(fallback); setSources([]); setResearchState("fallback"); }
  };

  if (view === "home") return <HomeScreen draft={searchDraft} setDraft={setSearchDraft} onStart={startSearch} searches={pastSearches} onOpen={(search) => { setCurrentSearch(search); setView("summary"); }} onDelete={(search) => setPastSearches((items) => items.filter((item) => item !== search))} />;
  if (view === "summary") return <ResultsSummary report={report} onBack={() => setView("research")} onHome={() => setView("home")} onDetail={() => setView("detail")} onPrices={() => setView("prices")} />;
  if (view === "detail") return <ProductDetail report={report} onBack={() => setView("summary")} onHome={() => setView("home")} onPrices={() => setView("prices")} />;
  if (view === "prices") return <PriceListings report={report} onBack={() => setView("summary")} onHome={() => setView("home")} />;

  return <>
    <MobileScroll className="app-screen"><main className="screen-content tally-screen" aria-label="Live product research">
      <header className="topline"><button className="brand brand-button" type="button" onClick={() => setView("home")}>Tally</button><p className="query">{currentSearch}</p><div className="time-saved"><strong>{report.timeSaved}</strong><span>hours saved</span></div><button className="sources-button" type="button" onClick={() => setSourcesOpen(true)} aria-label="View research sources"><FileTextIcon /> {sourceCount ? `${sourceCount} sources` : "Sources"}</button></header>
      <section className="progress-block" aria-label="Research progress"><div className="progress-label"><strong>{researchState === "working" ? "Researching now" : researchState === "complete" ? "Research complete" : "Research plan ready"}</strong><span>{researchState === "fallback" ? "Showing a local research scaffold until Gemini is connected." : "Estimate adjusts as we learn more."}</span></div><div className="progress-track"><span style={{ width: researchState === "working" ? "42%" : "100%" }} /></div></section>
      <section className="checking-section"><h1>Here’s what we’re checking.</h1><div className="question-list">{questions.map((question, index) => <article className={`question ${question.state}`} key={question.id}><div className="question-marker">{question.state === "done" ? <CheckIcon /> : index + 1}</div><div className="question-copy"><p>{question.label}</p>{question.state === "active" && <><small><i /> Researching now <b>•</b> 12 sources scanned</small><em>Why this matters: {question.reason}</em></>}</div>{question.id === "assumptions" ? <button className="text-action" type="button" onClick={() => setAssumptionsOpen(true)}><Pencil1Icon /> Review</button> : question.state === "done" ? <span className="done-label">Complete <ChevronRightIcon /></span> : question.state === "active" ? <button className="text-action" type="button" onClick={() => setAssumptionsOpen(true)}><Pencil1Icon /> Edit</button> : <button className="remove-button" type="button" onClick={() => removeQuestion(question.id)} aria-label={`Remove ${question.label}`}><Cross1Icon /></button>}</article>)}</div><button className="add-question" type="button" onClick={() => setSuggestionsOpen(true)}><PlusIcon /> Add a question</button><p className="suggestion-hint">Pick a suggested question or write your own.</p></section>
      <section className="best-fit" aria-label="Best fit so far"><div className="fit-kicker"><span>BEST FIT SO FAR</span><small>Rankings evolve as we learn more.</small></div><button type="button" className="lead-product product-link" onClick={() => setView("summary")}><img src="/product-images/lead-vacuum.png" alt="Dark cordless stick vacuum" /><div><h2><b>#1</b> Dyson V12 Detect Slim</h2><p className="price">$499–$649 <span>online & local</span></p><p className="fit-copy">Leads for strong pet-hair pickup on all floor types, a lightweight body, and easy apartment storage.</p></div></button><button className="redirect-button" type="button" onClick={() => setAssumptionsOpen(true)}><ReloadIcon /> Tell us what matters</button><button className="view-summary" type="button" onClick={() => setView("summary")}>View results summary <ChevronRightIcon /></button><BackupRow name="Shark Stratos Cordless Pet Pro" price="$299–$399" image="/product-images/backup-vacuum.png" saved={saved.includes("Shark")} onSave={() => toggleSaved("Shark")} /><BackupRow name="BISSELL MultiClean Allergen Lift-Off" price="$199–$279" image="/product-images/lead-vacuum.png" saved={saved.includes("BISSELL")} onSave={() => toggleSaved("BISSELL")} /></section>
    </main></MobileScroll>
    <BottomSheet open={assumptionsOpen} onOpenChange={setAssumptionsOpen} title="What we assumed" description="These shape the remaining research and the best-fit ranking." snap={0.82}><div className="sheet-assumptions">{assumptionList.map(([title, detail], index) => <button key={title} className={`assumption-row ${assumptions[index] ? "affirmed" : ""}`} type="button" onClick={() => setAssumptions((items) => items.map((value, itemIndex) => itemIndex === index ? !value : value))}><span>{assumptions[index] ? <CheckIcon /> : <PlusIcon />}</span><div><strong>{title}</strong><small>{detail}</small></div><b>{assumptions[index] ? "Affirmed" : "Add"}</b></button>)}{openAssumptions.map((item) => <div className="custom-row" key={item}><CheckIcon /><span>{item}</span></div>)}<div className="open-input"><KeyboardInput value={customAssumption} onChange={(event) => setCustomAssumption(event.target.value)} placeholder="Add your own assumption" aria-label="Add your own assumption" /><button onClick={addAssumption} type="button">Add</button></div><button type="button" className="update-button" onClick={() => setAssumptionsOpen(false)}>Update my research</button><p>Completed work stays intact. We’ll only revisit comparisons affected by your changes.</p></div></BottomSheet>
    <BottomSheet open={suggestionsOpen} onOpenChange={setSuggestionsOpen} title="Questions worth adding" description="Pick a direction or write your own."><div className="suggestion-list">{["How loud are they in real homes?", "Which is easiest to clean?", "What works best on carpet?"].map((question) => <button type="button" key={question} onClick={() => addQuestion(question)}><PlusIcon />{question}<ChevronRightIcon /></button>)}<div className="open-input"><KeyboardInput value={customQuestion} onChange={(event) => setCustomQuestion(event.target.value)} placeholder="Ask your own question" aria-label="Ask your own question" /><button onClick={() => addQuestion(customQuestion)} type="button">Add</button></div></div></BottomSheet>
    <BottomSheet open={sourcesOpen} onOpenChange={setSourcesOpen} title="Research sources" description={sources.length ? "Grounded web sources Gemini used for this report." : "Live source links appear here after Gemini completes its research."}><div className="source-list">{sources.length ? sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><FileTextIcon /><span>{source.title}</span><ChevronRightIcon /></a>) : <p>No live sources yet. Start a search and Tally will add the grounded sources here.</p>}</div></BottomSheet>
  </>;
}

function HomeScreen({ draft, setDraft, onStart, searches, onOpen, onDelete }: { draft: string; setDraft: (value: string) => void; onStart: () => void; searches: string[]; onOpen: (search: string) => void; onDelete: (search: string) => void }) {
  const examples = ["Dyson V12 Detect", "Best vacuum for pet hair"];
  return <MobileScroll className="app-screen"><main className="screen-content home-screen">
    <header className="home-header"><span className="brand">Tally</span><MagnifyingGlassIcon /><i /><span>Deep product research.</span></header>
    <section className="home-hero"><h1>Know before<br />you buy.</h1><div className="home-search"><MagnifyingGlassIcon /><KeyboardInput value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onStart(); }} placeholder="Product, Need, Problem, SKU…" aria-label="Start a product search" /><button className={draft ? "ready" : ""} onClick={onStart} type="button" aria-label="Start research"><ChevronRightIcon /></button></div><div className="search-examples">{examples.map((example, index) => <span key={example}>{index > 0 && <b>•</b>}<button type="button" onClick={() => setDraft(example)}>{`Try ${example}`}</button></span>)}</div></section>
    <div className="object-strip" aria-label="Product types to research"><img src="/product-images/catalog-vacuum.png" alt="Cordless vacuum" /><img src="/product-images/dutch-oven.png" alt="Dutch oven" /><img src="/product-images/linen-bedding.png" alt="Folded linen bedding" /></div>
    <section className="past-searches"><div><h2>Recent research</h2></div>{searches.length ? searches.slice(0, 2).map((search) => <article key={search}><button type="button" onClick={() => onOpen(search)}><MagnifyingGlassIcon /><strong>{search}</strong><ChevronRightIcon /></button><button className="delete-search" type="button" onClick={() => onDelete(search)} aria-label={`Delete ${search}`}><TrashIcon /></button></article>) : <p className="empty-searches">No saved research yet.</p>}<button className="all-research" type="button">All research <ChevronRightIcon /></button></section>
  </main></MobileScroll>
}
function ResultsSummary({ report, onBack, onHome, onDetail, onPrices }: { report: Report; onBack: () => void; onHome: () => void; onDetail: () => void; onPrices: () => void }) { const best = report.bestFit; return <MobileScroll className="app-screen"><main className="screen-content report-screen"><ReportNav onBack={onBack} label="Live research" onHome={onHome} /><p className="eyebrow">FULL RESEARCH REPORT · {report.confidence} CONFIDENCE</p><h1>{report.query}</h1><p className="report-verdict">{report.verdict}</p><button className="summary-lead" type="button" onClick={onDetail}><img src="/product-images/lead-vacuum.png" alt={best.name} /><div><span>BEST FIT</span><h2>{best.name}</h2><p>{best.summary}</p><b>Open product detail <ChevronRightIcon /></b></div></button><section className="summary-grid"><button type="button" onClick={onPrices}><small>PRICE RANGE</small><strong>{best.price}</strong><span>Top online & local listings</span></button><div><small>RATING & REVIEWS</small><strong>{best.rating}</strong><span>{best.reviews}</span></div></section><section className="pros-cons"><div><small>TOP PROS</small><p>{best.pros.map((item) => <span key={item}>{item}<br /></span>)}</p></div><div><small>TOP CONS</small><p>{best.cons.map((item) => <span key={item}>{item}<br /></span>)}</p></div></section><button className="compare-cta" type="button" onClick={onDetail}>Compare with {report.alternatives.length} top alternatives <ChevronRightIcon /></button></main></MobileScroll> }
function ProductDetail({ report, onBack, onHome, onPrices }: { report: Report; onBack: () => void; onHome: () => void; onPrices: () => void }) { const best = report.bestFit; return <MobileScroll className="app-screen"><main className="screen-content report-screen"><ReportNav onBack={onBack} label="Results summary" onHome={onHome} /><p className="eyebrow">PRODUCT DETAIL</p><h1>{best.name}</h1><button className="price-band" type="button" onClick={onPrices}><span>Current price range</span><strong>{best.price}</strong><ChevronRightIcon /></button><p className="detail-intro">Compared with the {report.alternatives.length} strongest alternatives found for this research. Tap a range to see retailer listings.</p><div className="comparison-grid"><div className="comparison-head"><span>PRODUCT</span><span>REVIEWS</span><span>PRICE</span><span>PROS / CONS</span></div><ComparisonRow name={best.name} rating={best.rating.split(" /")[0]} range={best.price} note={`${best.pros[0]} / ${best.cons[0]}`} lead />{report.alternatives.map((item, index) => <ComparisonRow key={item.name} name={item.name} rating={item.rating} range={item.price} note={item.note} image={index % 2 ? "/product-images/lead-vacuum.png" : "/product-images/backup-vacuum.png"} />)}</div></main></MobileScroll> }
function PriceListings({ report, onBack, onHome }: { report: Report; onBack: () => void; onHome: () => void }) { const best = report.bestFit; return <MobileScroll className="app-screen"><main className="screen-content report-screen"><ReportNav onBack={onBack} label="Product detail" onHome={onHome} /><p className="eyebrow">PRICE CHECK</p><h1>{best.name} listings</h1><p className="listing-note">Prices and availability are organized by top online and local retailers. Confirm stock before visiting a store.</p><div className="price-summary"><span>Current range</span><strong>{best.price}</strong><small>Tap a retailer to verify its current listing.</small></div><section className="retailer-list">{report.retailers.map(({ type, seller, price, availability }) => <article key={`${type}-${seller}`}><span className={`retailer-type ${type.toLowerCase()}`}>{type}</span><div><strong>{seller}</strong><small>{availability}</small></div><b>{price}</b></article>)}</section></main></MobileScroll> }
function Back({ onBack, label }: { onBack: () => void; label: string }) { return <button className="back-button" type="button" onClick={onBack}><ChevronLeftIcon /> {label}</button> }
function ReportNav({ onBack, label, onHome }: { onBack: () => void; label: string; onHome: () => void }) { return <div className="report-nav"><Back onBack={onBack} label={label} /><button type="button" onClick={onHome}><HomeIcon /> Back to home</button></div> }
function ComparisonRow({ name, rating, range, note, lead, image }: { name: string; rating: string; range: string; note: string; lead?: boolean; image?: string }) { return <article className={`comparison-row ${lead ? "lead" : ""}`}><div>{image ? <img src={image} alt="Vacuum" /> : <b>#1</b>}<strong>{name}</strong></div><span>{rating}</span><span>{range}</span><small>{note}</small></article> }
function BackupRow({ name, price, image, saved, onSave }: { name: string; price: string; image: string; saved: boolean; onSave: () => void }) { return <div className="backup-row"><img src={image} alt="Cordless vacuum" /><div><strong>{name}</strong><small>Strong alternative with a different tradeoff.</small></div><b>{price}</b><button type="button" onClick={onSave} aria-label={`Save ${name}`} className={saved ? "saved" : ""}><BookmarkIcon /></button></div> }
