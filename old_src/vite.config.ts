import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function researchPrompt(query: string, location: string, mode: string) {
  return `You are Tally, an independent product research analyst. Use Google Search grounding. Return only valid JSON, no markdown, matching: {"product":"","verdict":"","bestFit":{"name":"","price":"$min–$max","rating":"4.5 / 5","reviews":"review summary","summary":"","pros":[""],"cons":[""]},"alternatives":[{"name":"","price":"$min–$max","rating":"4.4","note":"pro / con"}],"retailers":[{"type":"Online or Local","seller":"","price":"$","availability":""}],"assumptions":[""],"questions":[""],"timeSaved":"2–4","confidence":"High, Medium, or Early"}. Include up to 10 alternatives and 5 retailers. Do not invent exact review counts or local availability: state that a retailer needs verification when evidence is weak. Query: ${query}. Location: ${location}. Depth: ${mode}.`;
}

function parseJson(text: string) {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
}

function geminiDevApi(key: string): Plugin {
  return {
    name: "tally-gemini-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/research", async (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "Method not allowed." })); return; }
        try {
          let raw = "";
          for await (const chunk of request) raw += chunk;
          const { query, location = "United States", mode = "full" } = JSON.parse(raw);
          const apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: researchPrompt(query, location, mode) }] }], tools: [{ googleSearch: {} }], generationConfig: { temperature: 0.2 } }),
          });
          if (!apiResponse.ok) throw new Error(`Gemini research request failed (HTTP ${apiResponse.status}).`);
          const payload = await apiResponse.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string; uri?: string } }> } }> };
          const candidate = payload.candidates?.[0];
          const text = candidate?.content?.parts?.map((part) => part.text || "").join("") || "";
          const sources = candidate?.groundingMetadata?.groundingChunks?.map((chunk) => ({ title: chunk.web?.title || "Source", url: chunk.web?.uri || "" })).filter((source) => source.url) || [];
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ report: parseJson(text), sources, live: true }));
        } catch (error) {
          response.statusCode = 502; response.setHeader("content-type", "application/json; charset=utf-8"); response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Gemini research failed." }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    build: { outDir: "dist/client" },
    server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
    plugins: [react(), geminiDevApi(env.GEMINI_API_KEY)],
  };
});
