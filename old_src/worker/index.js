const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors } });
}

function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Gemini did not return a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const researchPrompt = (query, location, mode) => `You are Tally, an independent product research analyst. Research the request below with Google Search grounding. Return only valid JSON (no markdown), following this exact shape:
{
  "product":"clear product/category name",
  "verdict":"one concise independent verdict",
  "bestFit":{"name":"product name","price":"$min–$max","rating":"4.5 / 5","reviews":"12,000 verified reviews","summary":"why it fits","pros":["..."],"cons":["..."]},
  "alternatives":[{"name":"...","price":"$...–$...","rating":"4.4","note":"one succinct pro / con"}],
  "retailers":[{"type":"Online or Local","seller":"...","price":"$...","availability":"specific availability note"}],
  "assumptions":["..."],
  "questions":["..."],
  "timeSaved":"2–4",
  "confidence":"High, Medium, or Early"
}
Include 10 alternatives and 5 retailers when available. Never invent exact review counts, availability, or prices; use ranges or say "Check retailer" where evidence is weak. User request: ${query}. Location for availability: ${location}. Research depth: ${mode}.`;

async function research(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: "Gemini has not been configured on this deployment." }, 503);
  const { query, location = "United States", mode = "full" } = await request.json();
  if (!query || typeof query !== "string") return json({ error: "A product or need is required." }, 400);

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: researchPrompt(query.slice(0, 500), location, mode) }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!response.ok) return json({ error: "Gemini research request failed.", detail: await response.text() }, 502);
  const payload = await response.json();
  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text || "").join("") || "";
  const report = extractJson(text);
  const sources = candidate?.groundingMetadata?.groundingChunks?.map((chunk) => ({ title: chunk.web?.title || "Source", url: chunk.web?.uri || "" })).filter((source) => source.url) || [];
  return json({ report, sources, live: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/research") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await research(request, env); } catch (error) { return json({ error: error instanceof Error ? error.message : "Research failed." }, 500); }
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;
    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
