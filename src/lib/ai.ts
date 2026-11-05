"use client";
// Layer 3 (PRD 8): Gemini through /api/ai, with template fallback so the demo never breaks.
import { SITE, RESPONSE_TIME, hasTier } from "./config";
import { fmtTime, openAlerts, partName, rulText, siteToday, worstVerdict, effectiveVerdict, r2 } from "./sim";
import type { Alert, ExplainResult, Sim, Station } from "./types";

export interface ChatAction {
  label: string;
  type: "work_order" | "open_station" | "open_alerts" | "open_quality";
  stationId?: string;
}
export interface ChatAnswer {
  summary: string;
  evidence: string[];
  actions: ChatAction[];
}
export interface AIResult<T> {
  data: T;
  source: "gemini" | "template";
  model?: string;
  note?: string;
  context: unknown;
}

// ---------- context snapshot (8.3) ----------
function stationBrief(sim: Sim, st: Station) {
  const m = st.current;
  const d20 = st.recent.slice(-20);
  return {
    id: st.id,
    laser: st.laser,
    joint: st.joint,
    recipe: st.recipe,
    status: st.status,
    anomalyScore: Math.round(st.anomaly),
    anomalyDriver: st.driver,
    healthPct: st.health,
    powerPct: r2(m.power, 1),
    powerSlopePctPerDay: r2(st.powerSlopeDay, 2),
    pgmPct: r2(m.pgm, 1),
    pgmSlopePctPerHour: st.rulWindow ? r2(st.rulWindow.slope, 2) : null,
    depthMmLast20Mean: r2(d20.reduce((s, w) => s + w.depthMm, 0) / Math.max(1, d20.length), 3),
    plasma: r2(m.plasma, 2),
    backReflection: r2(m.backRefl, 2),
    opticsTempC: r2(m.optTemp, 1),
    chillerOutletC: r2(m.chillerTemp, 1),
    laserOnHoursSinceService: Math.round(st.laserHours),
    windowLifeLeft: rulText(st.rulWindow, "h"),
    laserSourceLifeLeft: rulText(st.rulLaser, "d"),
    weldsToday: st.today.n,
    yieldTodayPct: r2(st.today.n ? (st.today.ok / st.today.n) * 100 : 100, 1),
    checkToday: st.today.check,
    ngToday: st.today.ng,
  };
}

export function buildContext(sim: Sim, opts: { screen: string; stationId?: string | null; full?: boolean }) {
  const today = siteToday(sim);
  const th = sim.thresholds;
  const focus = opts.stationId ? sim.stations.find((s) => s.id === opts.stationId) : [...sim.stations].sort((a, b) => b.anomaly - a.anomaly)[0];
  const full = opts.full ?? hasTier(sim.tier, "QUALITY+");
  const shiftFrom = sim.now - 8 * 3600_000;
  const risky = [...sim.modules.values()]
    .filter((m) => m.welds.some((w) => w.ts >= shiftFrom && effectiveVerdict(w) !== "OK"))
    .slice(-8)
    .map((m) => ({
      moduleId: m.moduleId,
      worst: worstVerdict(m.welds),
      notOk: m.welds.filter((w) => effectiveVerdict(w) !== "OK").map((w) => `${w.weldId} ${w.stationId} ${w.verdict} ${w.cause} depth ${w.depthMm} mm score ${w.score}`),
    }));
  return {
    site: { name: SITE.name, tier: sim.tier, responseTime: RESPONSE_TIME[sim.tier] },
    now: fmtTime(sim.now),
    date: "2026-11-05",
    screen: opts.screen,
    selectedStation: opts.stationId ?? null,
    thresholds: {
      powerWarnPct: th.powerWarn,
      powerCritPct: th.powerCrit,
      powerSlopeWarnPerDay: th.powerSlopeWarn,
      pgmWarnPct: th.pgmWarn,
      pgmCritPct: th.pgmCrit,
      depthTargetMm: 1.2,
      depthBandMm: [1.15, 1.3],
      depthWarnLowMm: th.depthWarnLow,
      gapWarnMm: th.gapWarn,
      chillerWarnC: th.chillWarn,
      opticsWarnC: th.optWarn,
    },
    shift: { from: fmtTime(shiftFrom), to: fmtTime(sim.now), welds: today.n, okPct: r2(today.okPct, 2), check: today.check, ng: today.ng },
    stations: sim.stations.map((s) => stationBrief(sim, s)),
    focusStation: focus
      ? {
          id: focus.id,
          minuteAverages: focus.minute.slice(-60).map((s) => ({
            t: fmtTime(s.t),
            power: r2(s.power, 1),
            pgm: r2(s.pgm, 1),
            depth: r2(s.depth, 3),
            plasma: r2(s.plasma, 2),
            optTemp: r2(s.optTemp, 1),
            chiller: r2(s.chillerTemp, 1),
          })),
          last200WeldScores: full ? sim.welds.filter((w) => w.stationId === focus.id).slice(-200).map((w) => w.score) : undefined,
        }
      : null,
    openAlerts: openAlerts(sim).map((a) => ({
      id: a.id,
      station: a.stationId,
      title: a.title,
      severity: a.severity,
      detected: fmtTime(a.detected),
      rule: a.rule,
      value: a.value,
      remainingLife: a.remainingLife,
      status: a.status,
      autoActions: a.autoActions,
    })),
    consumables: sim.consumables
      .filter((c) => c.used >= 60 || c.order.status === "ordered")
      .map((c) => ({ part: partName(c.part), station: c.stationId, usedPct: Math.round(c.used), order: c.order.status, po: c.order.po ?? null })),
    modulesAtRisk: full ? risky : undefined,
  };
}

// ---------- templates ----------
const fmt = (x: number, d = 1) => x.toFixed(d);

function findStation(sim: Sim, text: string, fallback?: string | null): Station | undefined {
  const m = text.toUpperCase().match(/WELD[-\s]?0?([1-6])/);
  if (m) return sim.stations.find((s) => s.id === `WELD-0${m[1]}`);
  if (fallback) return sim.stations.find((s) => s.id === fallback);
  return undefined;
}

function stationDiagnosis(sim: Sim, st: Station): ChatAnswer {
  const m = st.current;
  const th = sim.thresholds;
  const ev: string[] = [];
  const acts: ChatAction[] = [];
  let summary = "";
  const d20 = st.recent.slice(-20);
  const depth = d20.reduce((s, w) => s + w.depthMm, 0) / Math.max(1, d20.length);
  const yieldPct = st.today.n ? (st.today.ok / st.today.n) * 100 : 100;
  const now = fmtTime(sim.now);
  if (st.powerSlopeDay < th.powerSlopeWarn || m.power < th.powerWarn) {
    summary = `${st.id} laser power has drifted to ${fmt(m.power)}% of setpoint (${fmt(st.powerSlopeDay, 2)} %/day over 7 days). Lower power reduces OCT depth (last 20 welds ${fmt(depth, 3)} mm vs 1.20 mm target), which explains the yield drop to ${fmt(yieldPct)}%.`;
    ev.push(`Laser power ${fmt(m.power)}% at ${now}; 7-day slope ${fmt(st.powerSlopeDay, 2)} %/day (warning below ${th.powerSlopeWarn})`);
    ev.push(`Anomaly score ${Math.round(st.anomaly)}, driven by ${st.driver}`);
    ev.push(`Laser source life to ${th.powerCrit}%: ${rulText(st.rulLaser, "d")}`);
    acts.push({ label: `Create work order: LPM calibration on ${st.id}`, type: "work_order", stationId: st.id });
  } else if (m.pgm >= th.pgmWarn - 5) {
    summary = `${st.id} protective window is ${fmt(m.pgm)}% contaminated and rising ${st.rulWindow ? fmt(st.rulWindow.slope, 1) : "–"} %/h. Window life left: ${rulText(st.rulWindow, "h")}.`;
    ev.push(`PGM ${fmt(m.pgm)}% at ${now} (warning ${th.pgmWarn}%, critical ${th.pgmCrit}%)`);
    ev.push(`Plasma ${fmt(m.plasma, 2)}, back-reflection ${fmt(m.backRefl, 2)}`);
    ev.push(`Last 20 welds mean depth ${fmt(depth, 3)} mm`);
    acts.push({ label: `Create work order: replace window on ${st.id}`, type: "work_order", stationId: st.id });
  } else if (m.chillerTemp > th.chillWarn || m.optTemp > th.optWarn) {
    summary = `${st.id} chiller outlet is ${fmt(m.chillerTemp)} °C (normal 22–24 °C) and optics temperature has followed it to ${fmt(m.optTemp)} °C. Rising optics temperature can shift focus and reduce depth.`;
    ev.push(`Chiller outlet ${fmt(m.chillerTemp)} °C at ${now} (warning ${th.chillWarn} °C)`);
    ev.push(`Optics temperature ${fmt(m.optTemp)} °C (warning ${th.optWarn} °C)`);
    acts.push({ label: `Create work order: chiller filter on ${st.id}`, type: "work_order", stationId: st.id });
  } else if (depth < 1.15 || st.today.check + st.today.ng > 15) {
    const bad = st.recent.filter((w) => w.verdict !== "OK");
    summary = `${st.id} has ${bad.length} CHECK/NG welds in its last 50, mostly "${bad[0]?.cause ?? "depth low"}". Mean depth of the last 20 welds is ${fmt(depth, 3)} mm against a 1.15–1.30 mm band.`;
    ev.push(`Yield today ${fmt(yieldPct)}% (${st.today.check} CHECK, ${st.today.ng} NG)`);
    if (bad[0]) ev.push(`Latest: ${bad[bad.length - 1].weldId} depth ${bad[bad.length - 1].depthMm} mm, score ${bad[bad.length - 1].score}`);
    acts.push({ label: "Open the re-inspection queue", type: "open_quality" });
  } else {
    summary = `${st.id} is ${st.status}: all signals are inside their bands. Anomaly score ${Math.round(st.anomaly)} (normal below 40), yield today ${fmt(yieldPct)}%.`;
    ev.push(`Power ${fmt(m.power)}%, PGM ${fmt(m.pgm)}%, chiller ${fmt(m.chillerTemp)} °C at ${now}`);
    ev.push(`Window life left ${rulText(st.rulWindow, "h")}; laser source ${rulText(st.rulLaser, "d")}`);
  }
  acts.push({ label: `Open ${st.id}`, type: "open_station", stationId: st.id });
  return { summary, evidence: ev, actions: acts.slice(0, 3) };
}

function attention(sim: Sim): ChatAnswer {
  const alerts = openAlerts(sim);
  const ranked = [...sim.stations].sort((a, b) => b.anomaly - a.anomaly);
  const hot = ranked.filter((s) => s.status !== "running" || alerts.some((a) => a.stationId === s.id));
  if (!hot.length) {
    return {
      summary: `No station needs action this shift. All 6 stations are running; the highest anomaly score is ${Math.round(ranked[0].anomaly)} on ${ranked[0].id} (normal below 40).`,
      evidence: ranked.slice(0, 3).map((s) => `${s.id}: anomaly ${Math.round(s.anomaly)}, PGM ${fmt(s.current.pgm)}%, power ${fmt(s.current.power)}%`),
      actions: [{ label: `Open ${ranked[0].id}`, type: "open_station", stationId: ranked[0].id }],
    };
  }
  const ev: string[] = [];
  for (const s of hot.slice(0, 3)) {
    const a = alerts.find((x) => x.stationId === s.id);
    ev.push(`${s.id}: ${a ? `${a.title} (${a.value}, ${a.severity}, since ${fmtTime(a.detected)})` : `status ${s.status}`}${a?.remainingLife ? ` – ${a.remainingLife}` : ""}`);
  }
  const c = sim.consumables.filter((x) => x.order.status === "ordered");
  if (c.length) ev.push(`Parts on order: ${c.map((x) => `${partName(x.part)} ${x.stationId} (${x.order.po})`).join(", ")}`);
  return {
    summary: `${hot.length} station${hot.length > 1 ? "s need" : " needs"} attention: ${hot.slice(0, 3).map((s) => s.id).join(", ")}. Start with ${hot[0].id} (anomaly ${Math.round(hot[0].anomaly)}).`,
    evidence: ev,
    actions: [
      { label: `Create work order for ${hot[0].id}`, type: "work_order", stationId: hot[0].id },
      { label: `Open ${hot[0].id}`, type: "open_station", stationId: hot[0].id },
      { label: "Open alert centre", type: "open_alerts" },
    ],
  };
}

function modulesAtRisk(sim: Sim): ChatAnswer {
  const from = sim.now - 8 * 3600_000;
  const mods = [...sim.modules.values()].filter((m) => m.welds.some((w) => w.ts >= from && effectiveVerdict(w) !== "OK"));
  const ng = mods.filter((m) => worstVerdict(m.welds) === "NG");
  const recent = mods.slice(-5).reverse();
  return {
    summary: `${mods.length} modules from this shift have CHECK or NG welds still open; ${ng.length} have at least one NG. The most recent are listed below.`,
    evidence: recent.map((m) => {
      const bad = m.welds.filter((w) => effectiveVerdict(w) !== "OK");
      return `${m.moduleId}: ${bad.length} weld(s) not OK (${bad.map((w) => `${w.weldId} ${w.verdict}, ${w.cause}`).slice(0, 2).join("; ")})`;
    }),
    actions: [{ label: "Open the re-inspection queue", type: "open_quality" }],
  };
}

export function templateChat(sim: Sim, prompt: string, stationId?: string | null): ChatAnswer {
  const p = prompt.toLowerCase();
  if (/attention|shift\?|priority|first|주의|우선/.test(p)) return attention(sim);
  if (/module|risk|모듈/.test(p)) return modulesAtRisk(sim);
  const st = findStation(sim, prompt, stationId);
  if (st) return stationDiagnosis(sim, st);
  return attention(sim);
}

export function templateShiftReport(sim: Sim): string {
  const from = sim.now - 8 * 3600_000;
  const today = siteToday(sim);
  const alerts = sim.alerts.filter((a) => a.detected >= from);
  const open = openAlerts(sim);
  const rows = sim.stations
    .map((s) => `| ${s.id} | ${s.today.n} | ${fmt(s.today.n ? (s.today.ok / s.today.n) * 100 : 100)}% | ${s.today.check} | ${s.today.ng} | ${Math.round(s.anomaly)} | ${s.status} |`)
    .join("\n");
  const parts = sim.log.filter((l) => l.t >= from && /reorder|Auto-reorder/i.test(l.text));
  return `## Shift report – ${SITE.name}
**${fmtTime(from)} – ${fmtTime(sim.now)}, 05 Nov 2026** · tier ${sim.tier}

### Output and yield
${today.n.toLocaleString("en-US")} welds, ${fmt(today.okPct, 2)}% OK, ${today.check} CHECK, ${today.ng} NG.

| Station | Welds | Yield | CHECK | NG | Anomaly | Status |
|---|---|---|---|---|---|---|
${rows}

### Alerts and actions taken
${alerts.length ? alerts.map((a) => `- ${fmtTime(a.detected)} ${a.stationId} – ${a.title} (${a.value}, ${a.severity}) → ${a.status}${a.autoActions.length ? `; ${a.autoActions.join("; ")}` : ""}`).join("\n") : "- No alerts this shift."}

### Open risks for next shift
${open.length ? open.map((a) => `- ${a.stationId}: ${a.title}${a.remainingLife ? ` – ${a.remainingLife}` : ""}. ${a.action}`).join("\n") : "- None. All stations inside their bands."}

### Parts used
${parts.length ? parts.map((l) => `- ${fmtTime(l.t)} ${l.text}`).join("\n") : "- No parts ordered or used this shift."}
`;
}

export function templateExplain(sim: Sim, a: Alert): ExplainResult {
  const st = sim.stations.find((s) => s.id === a.stationId)!;
  const m = st.current;
  const base = { source: "template" as const };
  switch (a.type) {
    case "window":
      return {
        ...base,
        likely_cause: `Spatter build-up on the protective window of ${st.id}: PGM is ${fmt(m.pgm)}% and rising ${st.rulWindow ? fmt(st.rulWindow.slope, 1) : "–"} %/h.`,
        risk_if_ignored: `Less laser power reaches the joint; depth falls below 1.15 mm and CHECK/NG welds rise once PGM passes ${sim.thresholds.pgmCrit}%.`,
        time_to_impact: rulText(st.rulWindow, "h"),
        recommended_actions: ["Replace the protective window at the next module change", "Clean the nozzle and check cross-jet air", "Run 3 test welds and confirm OCT depth"],
        parts_needed: ["Protective window (1)"],
        confidence: "high",
      };
    case "power":
    case "powerDrift":
      return {
        ...base,
        likely_cause: `Gradual output loss of the laser source or contamination in the beam path: power is ${fmt(m.power)}% with a ${fmt(st.powerSlopeDay, 2)} %/day trend.`,
        risk_if_ignored: `Weld depth drops with power (about 0.02 mm per 1%); lack-of-penetration NG welds start below ${sim.thresholds.powerCrit}%.`,
        time_to_impact: rulText(st.rulLaser, "d"),
        recommended_actions: ["Run LPM calibration against an external power meter", "Inspect the fiber connector and collimator", "Let AXBIS remote service review the source log"],
        parts_needed: [],
        confidence: "medium",
      };
    case "anomaly":
      return {
        ...base,
        likely_cause: `Several signals have moved together away from their normal baseline; the largest contribution is ${st.driver}.`,
        risk_if_ignored: "Combined drift usually comes before a threshold alert; quality can degrade without any single limit being crossed.",
        time_to_impact: st.driver === "PGM" ? rulText(st.rulWindow, "h") : rulText(st.rulLaser, "d"),
        recommended_actions: [`Open ${st.id} and review the ${st.driver} trend`, "Compare the last 20 welds with the reference band", "Create an inspection work order"],
        parts_needed: [],
        confidence: "medium",
      };
    case "depth":
      return {
        ...base,
        likely_cause: `OCT depth on ${st.id} fell below the band (${a.value}); likely a focus shift or reduced power at the workpiece.`,
        risk_if_ignored: "Lack of penetration on busbar joints; affected modules could fail the leak test or in the field.",
        time_to_impact: "Immediate – modules already affected",
        recommended_actions: ["Hold and re-inspect the affected modules", "Check focus position and power at the workpiece", "Request a DOE re-tune from the L.A.C. if it repeats"],
        parts_needed: [],
        confidence: "high",
      };
    case "chiller":
    case "optTemp":
      return {
        ...base,
        likely_cause: `Cooling loss on ${st.id}: chiller outlet ${fmt(m.chillerTemp)} °C is pushing optics temperature to ${fmt(m.optTemp)} °C (clogged filter or low coolant).`,
        risk_if_ignored: "Thermal lensing shifts the focus and reduces depth; the laser may trip on over-temperature.",
        time_to_impact: a.remainingLife ?? "Hours",
        recommended_actions: ["Replace the chiller filter", "Check coolant level and condenser", "Verify outlet returns to 22–24 °C"],
        parts_needed: ["Chiller filter (1)"],
        confidence: "high",
      };
    default:
      return {
        ...base,
        likely_cause: `${a.title} on ${st.id} (${a.value}).`,
        risk_if_ignored: "Weld quality may degrade if it persists.",
        time_to_impact: a.remainingLife ?? "Unknown",
        recommended_actions: [a.action],
        parts_needed: [],
        confidence: "low",
      };
  }
}

// ---------- calling the server ----------
const calls: number[] = [];
const cache = new Map<string, unknown>();

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export async function aiStatus(): Promise<{ configured: boolean; pro: string; flash: string }> {
  try {
    const r = await fetch("/api/ai", { cache: "no-store" });
    return await r.json();
  } catch {
    return { configured: false, pro: "", flash: "" };
  }
}

async function callServer<T>(kind: "chat" | "explain" | "shift", prompt: string, context: unknown, lang: string): Promise<{ data: T; model: string } | { error: string }> {
  const key = hash(kind + prompt + JSON.stringify(context));
  if (cache.has(key)) return cache.get(key) as { data: T; model: string };
  const now = Date.now();
  while (calls.length && now - calls[0] > 60_000) calls.shift();
  if (calls.length >= 10) return { error: "Rate limit: 10 AI calls a minute – using template" };
  calls.push(now);
  try {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, prompt, context, lang }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = await r.json();
    if (!j.ok) return { error: j.reason === "no-key" ? "AI offline – using templates" : `Gemini unavailable (${j.reason ?? r.status}) – using template` };
    const out = { data: j.data as T, model: j.model as string };
    cache.set(key, out);
    return out;
  } catch (e) {
    return { error: (e as Error)?.name === "TimeoutError" ? "Gemini timed out after 12 s – using template" : "AI offline – using templates" };
  }
}

export async function askCopilot(sim: Sim, prompt: string, screen: string, stationId: string | null, preview: boolean): Promise<AIResult<ChatAnswer>> {
  const context = buildContext(sim, { screen, stationId, full: !preview });
  const tmpl = templateChat(sim, prompt, stationId);
  const r = await callServer<ChatAnswer>("chat", prompt, context, sim.lang);
  if ("error" in r) return { data: tmpl, source: "template", note: r.error, context };
  const d = r.data;
  if (!d || typeof d.summary !== "string") return { data: tmpl, source: "template", note: "Gemini returned an unexpected shape – using template", context };
  return { data: { summary: d.summary, evidence: d.evidence ?? [], actions: (d.actions ?? []).slice(0, 3) }, source: "gemini", model: r.model, context };
}

export async function explainAlert(sim: Sim, a: Alert): Promise<AIResult<ExplainResult>> {
  const context = { ...buildContext(sim, { screen: "alert", stationId: a.stationId, full: true }), alert: { id: a.id, title: a.title, rule: a.rule, value: a.value, severity: a.severity, remainingLife: a.remainingLife, recommendedAction: a.action } };
  const tmpl = templateExplain(sim, a);
  const r = await callServer<ExplainResult>("explain", `Explain alert ${a.id}`, context, sim.lang);
  if ("error" in r) return { data: tmpl, source: "template", note: r.error, context };
  if (!r.data?.likely_cause) return { data: tmpl, source: "template", note: "Gemini returned an unexpected shape – using template", context };
  return { data: { ...r.data, source: "gemini", model: r.model }, source: "gemini", model: r.model, context };
}

export async function shiftReport(sim: Sim): Promise<AIResult<string>> {
  const context = buildContext(sim, { screen: "shift-report", stationId: null, full: true });
  const tmpl = templateShiftReport(sim);
  const from = fmtTime(sim.now - 8 * 3600_000);
  const prompt = `Write the shift report for ${SITE.name} from ${from} to ${fmtTime(sim.now)}. Sections: Output and yield, Alerts and actions taken, Open risks for next shift, Parts used. Use a table for station figures.`;
  const r = await callServer<{ markdown: string } | string>("shift", prompt, context, sim.lang);
  if ("error" in r) return { data: tmpl, source: "template", note: r.error, context };
  const md = typeof r.data === "string" ? r.data : r.data?.markdown;
  if (!md) return { data: tmpl, source: "template", note: "Empty Gemini answer – using template", context };
  return { data: md, source: "gemini", model: r.model, context };
}

// ---------- guardrail: number verification (8.5) ----------
const NUM_RE = /(?<![A-Za-z\-\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|(?<![A-Za-z\-\d.])\d+(?:\.\d+)?(?!\d)/g;

export function contextNumbers(context: unknown): number[] {
  const s = JSON.stringify(context ?? {});
  const out: number[] = [];
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  return out;
}

export function isVerified(token: string, nums: number[]): boolean {
  const x = Number(token.replace(/,/g, ""));
  if (!isFinite(x)) return true;
  if (Number.isInteger(x) && x <= 12) return true;
  const dec = (token.split(".")[1] ?? "").length;
  const f = 10 ** dec;
  return nums.some((n) => Math.round(n * f) / f === x || Math.abs(n - x) < 1e-9);
}

export function splitNumbers(text: string): { text: string; num: boolean }[] {
  const parts: { text: string; num: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(NUM_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: text.slice(last, i), num: false });
    parts.push({ text: m[0], num: true });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), num: false });
  return parts;
}
