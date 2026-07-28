import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { onDeepLink } from "./lib/native";
import { HistoryPage } from "./components/home/HistoryPage";
import { HomePage } from "./components/home/HomePage";
import { ResearchPage } from "./components/research/ResearchPage";
import { ComparePage } from "./components/report/ComparePage";
import { PricesPage } from "./components/report/PricesPage";
import { ReportPage } from "./components/report/ReportPage";
import { PollPage } from "./components/poll/PollPage";
import { PageTop, ReportMissing } from "./components/ui/States";

function NotFoundPage() {
  return (
    <main className="page">
      <PageTop />
      <ReportMissing />
    </main>
  );
}

/**
 * Routes deep links opened from outside the app (a shared link, the share
 * sheet) to the matching screen. Renders nothing and does nothing on the web.
 */
function DeepLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void onDeepLink((path) => navigate(path)).then((cleanup) => {
      if (cancelled) cleanup();
      else dispose = cleanup;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [navigate]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <DeepLinks />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/report/:id" element={<ReportPage />} />
        <Route path="/report/:id/compare" element={<ComparePage />} />
        <Route path="/report/:id/prices" element={<PricesPage />} />
        <Route path="/poll/:id" element={<PollPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
