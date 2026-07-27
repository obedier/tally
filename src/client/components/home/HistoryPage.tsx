import { PageTop } from "../ui/States";
import { RecentResearch } from "./RecentResearch";
import "./home.css";

/** All saved research — the full history behind the home page's recent list. */
export function HistoryPage() {
  return (
    <main className="page history">
      <PageTop back={{ to: "/", label: "Home" }} />
      <p className="kicker">Your research</p>
      <h1 className="display display--headline">Everything you&rsquo;ve researched.</h1>
      <RecentResearch />
    </main>
  );
}
