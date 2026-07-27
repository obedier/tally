/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client never sees GEMINI_API_KEY: no define/envPrefix exposure, all model
// calls go through the server. Dev proxies /api to the Hono server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
      // Server-rendered share pages + OG cards live on the Hono server (M4).
      // Trailing slash is REQUIRED: a bare "/s" prefix would also capture
      // "/src/..." (Vite's own source modules) and break the dev client.
      "/s/": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/og/": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist/client",
  },
  test: {
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
