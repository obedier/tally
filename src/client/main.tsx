import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/typography.css";
import "./components/ui/ui.css";
import { App } from "./App";
import { initTelemetry } from "./lib/telemetry";
import { initStatusBar } from "./lib/native";

initTelemetry();
// No-ops in a browser; styles the iOS status bar for the light paper ground.
void initStatusBar();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
