import { BrowserRouter, Route, Routes } from "react-router-dom";
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

export function App() {
  return (
    <BrowserRouter>
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
