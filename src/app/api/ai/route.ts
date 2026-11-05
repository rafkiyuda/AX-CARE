// Gemini proxy (PRD 8.3). The key stays on the server; the browser never sees it.
// Uses the stable REST generateContent endpoint. Any failure returns ok:false so the UI falls back to templates.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRO = process.env.GEMINI_PRO_MODEL || "gemini-3.1-pro-preview";
const FLASH = process.env.GEMINI_FLASH_MODEL || "gemini-3.8-flash";

const COPILOT_SYSTEM = `You are AX CARE Copilot, a maintenance and quality assistant for laser welding lines in a battery module plant.
Use ONLY the JSON context provided. Quote values with their units and timestamps.
If the data does not answer the question, say so and suggest what to check.
Never invent numbers, part numbers or customer names.
Answer in the user's language (English or Korean), in at most 120 words, as:
1) Summary 2) Evidence 3) Recommended actions (max 3).
Safety: never tell the user to bypass interlocks or open the laser enclosure while the laser is on.
Return JSON: summary (string), evidence (array of short strings with values and times), actions (max 3 objects with label, type one of work_order|open_station|open_alerts|open_quality, and stationId when relevant).`;

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          type: { type: "string", enum: ["work_order", "open_station", "open_alerts", "open_quality"] },
          stationId: { type: "string" },
        },
        required: ["label", "type"],
      },
    },
  },
  required: ["summary", "evidence", "actions"],
};

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    likely_cause: { type: "string" },
    risk_if_ignored: { type: "string" },
    time_to_impact: { type: "string" },
    recommended_actions: { type: "array", items: { type: "string" }, maxItems: 3 },
    parts_needed: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["likely_cause", "risk_if_ignored", "recommended_actions", "confidence"],
};

// simple per-IP rate limit: 10 calls a minute
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 10;
}

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.GEMINI_API_KEY), pro: PRO, flash: FLASH });
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, reason: "no-key" });
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  if (limited(ip)) return NextResponse.json({ ok: false, reason: "rate-limit" });

  let body: { kind?: string; prompt?: string; context?: unknown; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }
  const kind = body.kind === "explain" || body.kind === "shift" ? body.kind : "chat";
  const prompt = String(body.prompt ?? "").slice(0, 2000);
  const lang = body.lang === "KO" ? "Korean" : "English";
  const model = kind === "explain" ? FLASH : PRO;

  const system =
    kind === "explain"
      ? `${COPILOT_SYSTEM.split("Return JSON")[0]}Explain the alert in the context. Fill the response schema. Answer in ${lang}.`
      : kind === "shift"
        ? `${COPILOT_SYSTEM.split("Answer in")[0]}Write in ${lang}, in Markdown, at most one page. Never invent numbers.`
        : `${COPILOT_SYSTEM}\nThe user interface language is ${lang}.`;

  const generationConfig: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: kind === "shift" ? 2048 : 1024 };
  if (kind !== "shift") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = kind === "explain" ? EXPLAIN_SCHEMA : CHAT_SCHEMA;
  }

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: `${prompt}\n\nJSON context:\n${JSON.stringify(body.context)}` }] }],
    generationConfig,
  };

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(11_500),
    });
    if (!r.ok) return NextResponse.json({ ok: false, reason: `http-${r.status}` });
    const j = await r.json();
    const text: string = (j?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    if (!text) return NextResponse.json({ ok: false, reason: "empty" });
    if (kind === "shift") return NextResponse.json({ ok: true, model, data: { markdown: text } });
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
    return NextResponse.json({ ok: true, model, data: JSON.parse(cleaned) });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "error" });
  }
}
