import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();

// --- Security / basics ---
app.use(helmet());
app.use(express.json({ limit: "500kb" }));

// --- CORS (extension + local dev) ---
app.use(
  cors({
    origin:"*",
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  })
);

// --- Rate limit ---
app.use(rateLimit({ windowMs: 60 * 1000, max: 20 }));

// --- Cache (10 minutes) ---
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// --- Env guard ---
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing. Please set in .env file.");
  process.exit(1);
}

// --- Helpers ---
function normalizeText(text) {
  return text ? String(text).slice(0, 50000) : "";
}

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

async function fetchWithRetry(url, options, retries = 3, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;

      // Retry only on 5xx (esp. 503 UNAVAILABLE)
      if (res.status >= 500 && res.status < 600) {
        lastErr = new Error(`Upstream HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Other errors -> throw immediately
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error("Unknown upstream failure");
}

// Extract JSON even if the model wraps it (e.g., markdown fences or prose)
function extractJSON(text) {
  if (!text) return null;

  // 1) Try direct JSON parse
  try {
    return JSON.parse(text);
  } catch (_e) {
    // continue
  }

  // 2) Strip ```json fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch (_e) {
      // continue
    }
  }

  // 3) Greedy object capture
  const objMatch = text.match(/(\{[\s\S]*\})/);
  if (objMatch && objMatch[1]) {
    try {
      return JSON.parse(objMatch[1]);
    } catch (_e) {
      // continue
    }
  }

  // 4) Array capture (just in case model returns only results array)
  const arrMatch = text.match(/(\[[\s\S]*\])/);
  if (arrMatch && arrMatch[1]) {
    try {
      return { results: JSON.parse(arrMatch[1]) };
    } catch (_e) {
      // continue
    }
  }

  return null;
}

// --- Routes ---
app.post("/scan", async (req, res) => {
  try {
    const { text, url } = req.body || {};
    if (!text) return res.status(400).json({ error: "No text supplied" });

    const normalized = normalizeText(text);
    const cacheKey = `${normalized.slice(0, 200)}|${url || ""}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ cached: true, results: cached });

    const prompt = `
You are a strict medical fact-checker AI.

FOCUS ONLY on:
- Medicine
- Health & wellness
- Fitness
- Mental health
- Psychology
- Veterinary health
- Pharmaceuticals
- Human anatomy & physiology

INSTRUCTIONS:
1. Identify ALL specific health-related claims from the text.
2. For each claim, classify VERDICT as:
   - MISINFORMATION → Factually incorrect or misleading.
   - TRUE → Supported by reputable medical consensus.
   - UNCLEAR → Insufficient evidence or mixed results.
3. Assign DANGER LEVEL:
   - Low → Harmless or irrelevant to health.
   - Moderate → Could cause minor harm or delay treatment.
   - High → Could cause serious harm, permanent injury, or major health risks.
   - Critical → Could cause death or life-threatening consequences.
4. Include EXPLANATION for MISINFORMATION or UNCLEAR claims.
5. Always provide at least 2 reputable SOURCES (WHO, CDC, PubMed, NIH, Mayo Clinic, etc.) for your classification.

Return JSON ONLY in this format:
{
  "results": [
    {
      "claim": "<claim>",
      "verdict": "MISINFORMATION|TRUE|UNCLEAR",
      "explanation": "<required if MISINFORMATION or UNCLEAR>",
      "danger": "Low|Moderate|High|Critical",
      "sources": ["https://...", "https://..."]
    }
  ]
}

TEXT TO ANALYZE:
"""${normalized}"""
(Page URL: ${url || "unknown"})
`;


    const resp = await fetchWithRetry(
      GEMINI_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
      3,
      1500
    );

    const data = await resp.json();
    const raw =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.toString() ??
      "";

    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.results)) {
      console.error("Gemini returned non-JSON or missing 'results'. Raw:", raw);
      // Return a soft failure so the client can render gracefully
      return res.status(200).json({
        cached: false,
        results: [],
        warning: "invalid_or_empty_results",
      });
    }

    cache.set(cacheKey, parsed.results);
    return res.json({ cached: false, results: parsed.results });
  } catch (err) {
    console.error("Scan error:", err?.message || err);
    // Signal upstream issue without crashing the client
    return res
      .status(502)
      .json({ error: "upstream_error", status: 503, detail: String(err?.message || err) });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () =>
  console.log(`✅ MedShield backend (Gemini) running on port ${port}`)
);
