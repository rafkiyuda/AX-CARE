// AX CARE simulated data engine (PRD 6, 8.1, 8.2). Runs fully in the browser.
import { DEFAULT_THRESHOLDS, PEOPLE, SIM_START, STATIONS, hasTier, type Thresholds, type Tier } from "./config";
import type {
  Alert,
  AlertType,
  CalEvent,
  Cause,
  Consumable,
  HourAgg,
  LedgerMonth,
  ModuleInfo,
  PartKind,
  Rul,
  Sample,
  Scenario,
  Severity,
  Sim,
  Station,
  StationStatus,
  Verdict,
  Weld,
  WorkOrder,
} from "./types";
import type { Lang } from "./i18n";
import type { Role } from "./config";

// ---------- random ----------
let seed = 20261105;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss(sd = 1) {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const r2 = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export const H = 3600_000;
export const DAY = 86_400_000;
const HIST_STEP_S = 600;
const HISTORY_STEPS = 8350; // ~50,000 welds of history
const M0 = 101; // first module serial in history
const WELDS_PER_STATION = 6; // 6 stations x 6 welds = 36 welds per module (18 cells x 2)

export const pad = (n: number, w = 4) => String(n).padStart(w, "0");
export const moduleIdOf = (serial: number) => `MOD-2611-${pad(serial)}`;

// ---------- signal physics ----------
function overrideDrop(st: Station) {
  const o = st.depthOverride;
  if (!o || o.pending) return 0;
  return 0.15 * Math.min(1, (o.k + 1) / 3);
}

function makeSample(st: Station, t: number): Sample {
  const power = 100 + st.powerDrift + gauss(0.25);
  const pgm = clamp(st.pgm + gauss(0.3), 0, 100);
  const depth =
    1.2 + 0.02 * (power - 100) - Math.max(0, st.pgm - 60) * 0.0035 - overrideDrop(st) + gauss(0.015);
  const gap = Math.abs(0.025 + gauss(0.01));
  const plasma = 0.525 - Math.max(0, st.pgm - 50) * 0.002 + gauss(0.015);
  const backRefl = 0.15 + Math.max(0, st.pgm - 60) * 0.003 + gauss(0.012);
  const chillerTemp = 23 + st.chillerOffset + gauss(0.12);
  const optTemp = 31 + 1.8 * st.chillerOffset + Math.max(0, st.pgm - 60) * 0.05 + gauss(0.25);
  return { t, power, pgm, depth, gap, plasma, backRefl, optTemp, chillerTemp };
}

function meanSample(arr: Sample[], t?: number): Sample {
  const n = Math.max(1, arr.length);
  const m: Sample = { t: t ?? arr[arr.length - 1]?.t ?? 0, power: 0, pgm: 0, depth: 0, gap: 0, plasma: 0, backRefl: 0, optTemp: 0, chillerTemp: 0 };
  for (const s of arr) {
    m.power += s.power / n;
    m.pgm += s.pgm / n;
    m.depth += s.depth / n;
    m.gap += s.gap / n;
    m.plasma += s.plasma / n;
    m.backRefl += s.backRefl / n;
    m.optTemp += s.optTemp / n;
    m.chillerTemp += s.chillerTemp / n;
  }
  return m;
}

export function scoreWeld(d: number, g: number, p: number, br: number, pgm: number, th: Thresholds) {
  const pen = { depth: 0, gap: 0, plasma: 0, br: 0, pgm: 0 };
  let inband = Math.min(6, (6 * Math.abs(d - 1.2)) / 0.05) + (4 * Math.min(g, 0.05)) / 0.05 + (3 * Math.min(Math.abs(p - 0.525), 0.075)) / 0.075;
  if (d < 1.15) pen.depth = Math.min(50, ((1.15 - d) / 0.15) * 50);
  else if (d > 1.3) pen.depth = Math.min(50, ((d - 1.3) / 0.15) * 50);
  if (g > 0.05) pen.gap = Math.min(20, ((g - 0.05) / 0.15) * 20);
  if (p < th.plasmaLow) pen.plasma = Math.min(15, ((th.plasmaLow - p) / 0.1) * 15);
  else if (p > th.plasmaHigh) pen.plasma = Math.min(15, ((p - th.plasmaHigh) / 0.1) * 15);
  if (br > 0.2) pen.br = Math.min(10, ((br - 0.2) / 0.2) * 10);
  if (pgm > 70) pen.pgm = Math.min(5, ((pgm - 70) / 15) * 5);
  inband = Math.min(inband, 8);
  const score = Math.max(0, Math.round(100 - inband - pen.depth - pen.gap - pen.plasma - pen.br - pen.pgm));
  const verdict: Verdict = score >= 85 ? "OK" : score >= 70 ? "CHECK" : "NG";
  let cause: Cause | null = null;
  if (verdict !== "OK") {
    const entries: [Cause, number][] = [
      [d < 1.15 ? "Depth low" : "Depth high", pen.depth],
      ["Gap", pen.gap],
      ["Plasma", pen.plasma],
      ["Back-reflection", pen.br],
      ["Window", pen.pgm],
    ];
    entries.sort((a, b) => b[1] - a[1]);
    cause = entries[0][0];
  }
  return { score, verdict, cause, pen };
}

// ---------- creation ----------
function pgmBackAt(pgmNow: number, hoursAgo: number, rate = 0.5) {
  let v = pgmNow - rate * hoursAgo;
  while (v < 3) v += 62;
  return v;
}

function newStation(idx: number, now: number): Station {
  const m = STATIONS[idx];
  const st: Station = {
    id: m.id,
    idx,
    laser: m.laser,
    joint: m.joint,
    recipe: m.recipe,
    pgm: m.pgm0,
    pgmRate: 0.5,
    powerDrift: 0,
    powerDriftRate: 0,
    chillerOffset: 0,
    chillerRate: 0,
    chillerCap: 4,
    depthOverride: null,
    laserHours: m.hours0,
    nozzleUsed: m.nozzle0,
    filterUsed: m.filter0,
    st: now,
    trendSpeed: 1,
    histAcc: 0,
    samples: [],
    hist: [],
    minute: [],
    minuteAcc: [],
    baseline: [],
    recent: [],
    plasmaRun: 0,
    current: null as unknown as Sample,
    anomaly: 18,
    anomalyPrev: 18,
    anomalyTrend: 0,
    driver: "laser power",
    health: 95,
    status: "running",
    rulWindow: null,
    rulLaser: null,
    powerSlopeDay: 0,
    moduleSerial: 0,
    weldInModule: 0,
    today: { n: 0, ok: 0, check: 0, ng: 0 },
  };
  // 7 days of 10-minute history (station time)
  const saved = st.pgm;
  for (let k = 1008; k >= 1; k--) {
    const t = now - k * HIST_STEP_S * 1000;
    st.pgm = pgmBackAt(saved, (k * HIST_STEP_S) / 3600);
    st.hist.push(makeSample(st, t));
  }
  st.pgm = saved;
  for (let k = 600; k >= 1; k--) st.samples.push(makeSample(st, now - k * 1000));
  for (let k = 60; k >= 1; k--) {
    const s = makeSample(st, now - k * 60_000);
    st.minute.push(s);
  }
  resetBaseline(st);
  st.current = st.samples[st.samples.length - 1];
  return st;
}

function resetBaseline(st: Station) {
  st.baseline = [];
  for (let i = 0; i < 200; i++) st.baseline.push(makeSample(st, st.st));
}

function seedLedger(): LedgerMonth[] {
  const rows: [string, string, number, number, number, number][] = [
    ["2026-06", "Jun", 4.5, 620, 14, 100],
    ["2026-07", "Jul", 6, 810, 17, 100],
    ["2026-08", "Aug", 3.5, 540, 12, 92],
    ["2026-09", "Sep", 7, 960, 19, 100],
    ["2026-10", "Oct", 5, 730, 16, 100],
    ["2026-11", "Nov (to date)", 1, 140, 3, 100],
  ];
  return rows.map(([month, label, downtimeH, ngAvoided, parts, responseMet]) => ({ month, label, downtimeH, ngAvoided, parts, responseMet, events: [] }));
}

function seedCalendar(): CalEvent[] {
  const d = (day: number, h: number) => Date.parse(`2026-11-${pad(day, 2)}T${pad(h, 2)}:00:00+09:00`);
  return [
    { id: "CAL-1", t: d(3, 10), kind: "remote", title: "Remote health review (monthly)", done: true },
    { id: "CAL-2", t: d(4, 15), kind: "visit", title: "Window cassette swap WELD-01", done: true },
    { id: "CAL-3", t: d(12, 9), kind: "visit", title: "Preventive visit WELD-01…03", done: false },
    { id: "CAL-4", t: d(19, 14), kind: "remote", title: "Remote health review", done: false },
    { id: "CAL-5", t: d(26, 9), kind: "visit", title: "Preventive visit WELD-04…06", done: false },
  ];
}

function seedUptime(): { day: string; pct: number }[] {
  const out: { day: string; pct: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const t = SIM_START - i * DAY;
    const dt = new Date(t + 9 * H);
    const label = `${pad(dt.getUTCMonth() + 1, 2)}/${pad(dt.getUTCDate(), 2)}`;
    let pct = 98.9 + gauss(0.35);
    if (i === 21) pct = 96.4;
    if (i === 9) pct = 97.2;
    out.push({ day: label, pct: r2(clamp(pct, 95, 99.8), 1) });
  }
  return out;
}

export interface SimOptions {
  tier?: Tier;
  lang?: Lang;
  role?: Role;
  thresholds?: Thresholds;
  value?: Sim["value"];
}

export function createSim(opts: SimOptions = {}): Sim {
  seed = 20261105;
  const now = SIM_START;
  const sim: Sim = {
    now,
    tickN: 0,
    step: 0,
    tier: opts.tier ?? "CARE+",
    lang: opts.lang ?? "EN",
    role: opts.role ?? "manager",
    thresholds: opts.thresholds ?? { ...DEFAULT_THRESHOLDS },
    stations: STATIONS.map((_, i) => newStation(i, now)),
    welds: [],
    byWeld: new Map(),
    byCell: new Map(),
    modules: new Map(),
    hours: new Map(),
    depthBins: new Array(31).fill(0),
    causes: {
      "Depth low": { check: 0, ng: 0 },
      "Depth high": { check: 0, ng: 0 },
      Gap: { check: 0, ng: 0 },
      Plasma: { check: 0, ng: 0 },
      "Back-reflection": { check: 0, ng: 0 },
      Window: { check: 0, ng: 0 },
    },
    checkQueue: [],
    alerts: [],
    suppress: new Map(),
    consumables: [],
    stock: { window: 6, nozzle: 12, filter: 3 },
    reorderPoint: { window: 3, nozzle: 4, filter: 2 },
    workOrders: [],
    calendar: seedCalendar(),
    ledger: seedLedger(),
    partsDelivered: 0,
    remoteSessions: 7,
    scenario: null,
    seq: 1,
    uptime30: seedUptime(),
    log: [],
    value: opts.value ?? { lineScalePct: 0.5, fxKrw: 1380, scrapKrw: 20_000, feePerMachineYearM: 60 },
    doeRequests: [],
  };
  for (const st of sim.stations) {
    (["window", "nozzle", "filter"] as PartKind[]).forEach((part) =>
      sim.consumables.push({ id: `${st.id}-${part}`, part, stationId: st.id, used: 0, order: { status: "none" } }),
    );
  }
  generateHistory(sim);
  updateConsumables(sim, false);
  for (const st of sim.stations) derive(sim, st);
  return sim;
}

// ---------- welds ----------
function addWeld(sim: Sim, w: Weld) {
  sim.welds.push(w);
  sim.byWeld.set(w.weldId, w);
  let cell = sim.byCell.get(w.cellId);
  if (!cell) sim.byCell.set(w.cellId, (cell = []));
  cell.push(w);
  let mod = sim.modules.get(w.moduleId);
  if (!mod) {
    const serial = Number(w.moduleId.slice(-4));
    mod = { moduleId: w.moduleId, serial, batch: `B-261105-${pad(Math.floor(serial / 50), 2)}`, welds: [] };
    sim.modules.set(w.moduleId, mod);
  }
  mod.welds.push(w);
  const hour = Math.floor((w.ts + 9 * H) / H) * H - 9 * H;
  let agg = sim.hours.get(hour) as HourAgg | undefined;
  if (!agg) sim.hours.set(hour, (agg = { hour, n: 0, ok: 0, sum: 0, sumSq: 0 }));
  agg.n++;
  if (w.verdict === "OK") agg.ok++;
  agg.sum += w.score;
  agg.sumSq += w.score * w.score;
  const bin = clamp(Math.floor((w.depthMm - 0.9) / 0.02), 0, 30);
  sim.depthBins[bin]++;
  if (w.cause) sim.causes[w.cause][w.verdict === "NG" ? "ng" : "check"]++;
  if (w.verdict === "CHECK") sim.checkQueue.push(w);
  const st = sim.stations.find((s) => s.id === w.stationId)!;
  st.today.n++;
  if (w.verdict === "OK") st.today.ok++;
  else if (w.verdict === "CHECK") st.today.check++;
  else st.today.ng++;
  st.recent.push(w);
  if (st.recent.length > 50) st.recent.shift();
}

function buildWeld(sim: Sim, st: Station, serial: number, pos: number, ts: number, v: { depth: number; gap: number; plasma: number; backRefl: number; pgm: number }): Weld {
  const s4 = pad(serial);
  const { score, verdict, cause } = scoreWeld(v.depth, v.gap, v.plasma, v.backRefl, v.pgm, sim.thresholds);
  return {
    weldId: `W-${s4}-${pad(pos, 2)}`,
    moduleId: moduleIdOf(serial),
    cellId: `C-${s4}-${pad(Math.ceil(pos / 2), 2)}`,
    stationId: st.id,
    ts,
    recipe: st.recipe,
    depthMm: r2(v.depth, 3),
    gapMm: r2(v.gap, 3),
    plasma: r2(v.plasma, 3),
    backRefl: r2(v.backRefl, 3),
    pgm: r2(v.pgm, 1),
    score,
    verdict,
    cause,
  };
}

function generateHistory(sim: Sim) {
  const now = sim.now;
  for (let step = 0; step < HISTORY_STEPS; step++) {
    const ts = now - (HISTORY_STEPS - step) * 2000;
    const hoursAgo = (now - ts) / H;
    const local = new Date(ts + 9 * H);
    const hm = local.getUTCHours() * 60 + local.getUTCMinutes();
    for (const st of sim.stations) {
      const serial = M0 + Math.floor(step / WELDS_PER_STATION) - st.idx;
      if (serial < M0) continue;
      const pos = st.idx * WELDS_PER_STATION + (step % WELDS_PER_STATION) + 1;
      const pgm = pgmBackAt(STATIONS[st.idx].pgm0, hoursAgo);
      const power = 100 + gauss(0.25);
      let depth = 1.2 + 0.02 * (power - 100) - Math.max(0, pgm - 60) * 0.0035 + gauss(0.022);
      let gap = Math.abs(0.025 + gauss(0.012));
      let plasma = 0.525 - Math.max(0, pgm - 50) * 0.002 + gauss(0.018);
      const backRefl = 0.15 + Math.max(0, pgm - 60) * 0.003 + gauss(0.014);
      const protectedModule = serial === 482;
      if (!protectedModule) {
        // historic events so quality charts have something to show
        if (st.id === "WELD-04" && hm >= 11 * 60 + 10 && hm < 11 * 60 + 22 && rnd() < 0.35) gap += 0.11 + gauss(0.02);
        if (st.id === "WELD-01" && hm >= 10 * 60 + 5 && hm < 10 * 60 + 7) depth -= 0.1 + gauss(0.02);
        if (rnd() < 0.003) {
          gap += 0.13;
          plasma += 0.1;
        }
      }
      addWeld(sim, buildWeld(sim, st, serial, pos, ts, { depth, gap, plasma, backRefl, pgm }));
    }
  }
  sim.step = HISTORY_STEPS;
}

function produceWelds(sim: Sim) {
  const step = sim.step;
  for (const st of sim.stations) {
    const serial = M0 + Math.floor(step / WELDS_PER_STATION) - st.idx;
    const inMod = step % WELDS_PER_STATION;
    const pos = st.idx * WELDS_PER_STATION + inMod + 1;
    st.moduleSerial = serial;
    st.weldInModule = inMod;
    const o = st.depthOverride;
    if (o && o.pending && inMod === 0) o.pending = false;
    const power = 100 + st.powerDrift + gauss(0.25);
    let depth = 1.2 + 0.02 * (power - 100) - Math.max(0, st.pgm - 60) * 0.0035 - overrideDrop(st) + gauss(o && !o.pending ? 0.015 : 0.022);
    let gap = Math.abs(0.025 + gauss(0.012));
    let plasma = 0.525 - Math.max(0, st.pgm - 50) * 0.002 + gauss(0.018);
    const backRefl = 0.15 + Math.max(0, st.pgm - 60) * 0.003 + gauss(0.014);
    if (rnd() < 0.003) {
      gap += 0.13;
      plasma += 0.1;
    }
    depth = Math.max(0.85, depth);
    const w = buildWeld(sim, st, serial, pos, sim.now, { depth, gap, plasma, backRefl, pgm: st.pgm });
    addWeld(sim, w);
    if (w.plasma < sim.thresholds.plasmaLow || w.plasma > sim.thresholds.plasmaHigh) st.plasmaRun++;
    else st.plasmaRun = 0;
    if (o && !o.pending) {
      o.k++;
      if (o.k >= o.total) st.depthOverride = null;
    }
  }
  sim.step++;
}

// ---------- statistics (layer 2) ----------
function linfit(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return { slope: 0, intercept: ys[n - 1] ?? 0, sd: 0 };
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - (intercept + slope * xs[i])) ** 2;
  return { slope, intercept, sd: Math.sqrt(ss / Math.max(1, n - 2)) };
}

const ANOM_KEYS: { k: keyof Omit<Sample, "t">; w: number; floor: number; label: string }[] = [
  // sigma floors keep the score from over-reacting to tiny baseline spreads
  { k: "power", w: 0.3, floor: 0.35, label: "laser power" },
  { k: "depth", w: 0.3, floor: 0.025, label: "OCT depth" },
  { k: "pgm", w: 0.2, floor: 3, label: "PGM" },
  { k: "plasma", w: 0.1, floor: 0.03, label: "plasma" },
  { k: "optTemp", w: 0.1, floor: 0.8, label: "optics temperature" },
];

function derive(sim: Sim, st: Station) {
  const th = sim.thresholds;
  const last = st.samples.slice(-5);
  const m = meanSample(last);
  st.current = m;
  // anomaly score (8.1)
  let sum = 0;
  let best = 0;
  let driver = st.driver;
  for (const a of ANOM_KEYS) {
    let mu = 0;
    for (const b of st.baseline) mu += b[a.k] / st.baseline.length;
    let v = 0;
    for (const b of st.baseline) v += (b[a.k] - mu) ** 2 / st.baseline.length;
    const z = (m[a.k] - mu) / Math.max(Math.sqrt(v), a.floor);
    const c = a.w * Math.abs(z);
    sum += c;
    if (c > best) {
      best = c;
      driver = a.label;
    }
  }
  const raw = Math.min(100, 25 * sum);
  st.anomaly = st.anomaly * 0.7 + raw * 0.3;
  st.driver = driver;
  if (sim.tickN % 10 === 0) {
    st.anomalyTrend = st.anomaly - st.anomalyPrev;
    st.anomalyPrev = st.anomaly;
  }
  const inScenario = sim.scenario?.stationId === st.id || st.depthOverride !== null;
  if (raw < 40 && !inScenario) {
    st.baseline.push(st.samples[st.samples.length - 1]);
    if (st.baseline.length > 200) st.baseline.shift();
  }
  // remaining life (8.2) — window from last 6 h of PGM
  {
    const from = st.st - 6 * H;
    const pts = st.hist.filter((p) => p.t >= from);
    const xs = pts.map((p) => (p.t - st.st) / H);
    const ys = pts.map((p) => p.pgm);
    xs.push(0);
    ys.push(m.pgm);
    const f = linfit(xs, ys);
    const a = f.intercept;
    if (f.slope > 0.05) {
      const hours = Math.max(0, (th.pgmCrit - Math.max(a, m.pgm)) / f.slope);
      st.rulWindow = { value: hours, pm: Math.max(hours * 0.12, (2 * f.sd) / f.slope), slope: f.slope, a, sd: f.sd, infinite: false };
    } else st.rulWindow = { value: Infinity, pm: 0, slope: f.slope, a, sd: f.sd, infinite: true };
  }
  // laser source from last 7 days of power
  {
    const xs = st.hist.map((p) => (p.t - st.st) / DAY);
    const ys = st.hist.map((p) => p.power);
    xs.push(0);
    ys.push(m.power);
    const f = linfit(xs, ys);
    st.powerSlopeDay = f.slope;
    const a = f.intercept;
    if (f.slope < -0.02) {
      const days = Math.max(0, (Math.min(a, m.power) - th.powerCrit) / -f.slope);
      st.rulLaser = { value: days, pm: Math.max(days * 0.15, (2 * f.sd) / -f.slope), slope: f.slope, a, sd: f.sd, infinite: false };
    } else st.rulLaser = { value: Infinity, pm: 0, slope: f.slope, a, sd: f.sd, infinite: true };
  }
  // status and health
  const recent3 = st.recent.slice(-3);
  const depth3 = recent3.reduce((s, w) => s + w.depthMm, 0) / Math.max(1, recent3.length);
  const gap3 = recent3.reduce((s, w) => s + w.gapMm, 0) / Math.max(1, recent3.length);
  let status: StationStatus = "running";
  const crit =
    m.power < th.powerCrit ||
    m.pgm >= th.pgmCrit ||
    depth3 < th.depthCritLow ||
    gap3 > th.gapCrit ||
    st.plasmaRun >= th.plasmaCritN ||
    m.backRefl > th.brCrit ||
    m.optTemp > th.optCrit ||
    m.chillerTemp > th.chillCrit ||
    st.anomaly > 80;
  const warn =
    m.power < th.powerWarn ||
    m.pgm >= th.pgmWarn ||
    depth3 < th.depthWarnLow ||
    depth3 > th.depthWarnHigh ||
    gap3 > th.gapWarn ||
    st.plasmaRun >= th.plasmaWarnN ||
    m.backRefl > th.brWarn ||
    m.optTemp > th.optWarn ||
    m.chillerTemp > th.chillWarn ||
    st.anomaly > 60 ||
    st.powerSlopeDay < th.powerSlopeWarn;
  if (crit) status = "critical";
  else if (warn) status = "warning";
  st.status = status;
  st.health = Math.round(clamp(100 - 0.35 * st.anomaly - Math.max(0, m.pgm - 60) * 0.8 - Math.max(0, 100 - m.power) * 3 - Math.max(0, m.chillerTemp - 24) * 2, 5, 100));
  return { m, depth3, gap3 };
}

// ---------- consumables ----------
function updateConsumables(sim: Sim, allowOrder = true) {
  for (const c of sim.consumables) {
    const st = sim.stations.find((s) => s.id === c.stationId)!;
    if (c.part === "window") c.used = clamp((st.pgm / sim.thresholds.pgmCrit) * 100, 0, 100);
    else if (c.part === "nozzle") c.used = clamp(st.nozzleUsed, 0, 100);
    else c.used = clamp(st.filterUsed + st.chillerOffset * 8, 0, 100);
    if (allowOrder && c.order.status !== "ordered" && c.used >= sim.thresholds.reorderPct && hasTier(sim.tier, "CARE")) placeOrder(sim, c, "auto");
  }
}

const PART_NAME: Record<PartKind, string> = { window: "Protective window", nozzle: "Nozzle", filter: "Chiller filter" };
export const partName = (p: PartKind) => PART_NAME[p];

function placeOrder(sim: Sim, c: Consumable, why: "auto" | "alert") {
  const po = `PO-2611${pad(sim.seq++, 4)}`;
  c.order = { status: "ordered", po, orderedAt: sim.now, arrives: sim.now + DAY };
  logEvent(sim, `${why === "auto" ? "Auto-reorder" : "Reorder"}: ${PART_NAME[c.part]} for ${c.stationId} (${po}) at ${Math.round(c.used)}% used`);
  return po;
}

export function fmtDay(t: number) {
  const d = new Date(t + 9 * H);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${pad(d.getUTCDate(), 2)} ${mon}`;
}
export function fmtTime(t: number) {
  const d = new Date(t + 9 * H);
  return `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}`;
}
export function fmtTimeS(t: number) {
  const d = new Date(t + 9 * H);
  return `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`;
}
export function fmtDateTime(t: number) {
  return `${fmtDay(t)} ${fmtTime(t)}`;
}

export function orderText(c: Consumable) {
  if (c.order.status === "ordered") return `Ordered ${fmtDay(c.order.orderedAt!)}, arrives ${fmtDay(c.order.arrives!)}`;
  if (c.order.status === "delivered") return `Spare fitted from stock · restock arrives ${fmtDay(c.order.arrives!)}`;
  return "—";
}

function logEvent(sim: Sim, text: string) {
  sim.log.unshift({ t: sim.now, text });
  if (sim.log.length > 100) sim.log.pop();
}

// ---------- rules (layer 1) ----------
export function rulText(r: Rul | null, unit: "h" | "d") {
  if (!r || r.infinite) return unit === "h" ? "> 48 h" : "> 90 days";
  if (unit === "h") {
    if (r.value > 48) return "> 48 h";
    if (r.value < 0.5) return "limit reached – replace now";
    return `about ${Math.max(0, Math.round(r.value))} h (±${Math.max(1, Math.round(r.pm))} h)`;
  }
  if (r.value > 90) return "> 90 days";
  return `about ${r.value.toFixed(1)} days (±${Math.max(0.5, Math.round(r.pm * 2) / 2)} d)`;
}

const SEV_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

const ACTIONS: Record<AlertType, { title: string; signal: Alert["signal"]; action: string }> = {
  window: { title: "Protective window contamination", signal: "pgm", action: "Replace the protective window at the next module change; clean the nozzle and check cross-jet air." },
  power: { title: "Laser power low", signal: "power", action: "Run an LPM power calibration; inspect the fiber connector and collimator for contamination." },
  powerDrift: { title: "Laser power drift", signal: "power", action: "Book an AXBIS remote check of the laser source; compare LPM with an external power meter." },
  anomaly: { title: "Anomaly score high", signal: "power", action: "Inspect the top driver signal against the recipe reference band; open the station trend." },
  depth: { title: "Weld depth low", signal: "depth", action: "Hold affected modules for re-inspection; check focus position and power at the workpiece; request a DOE re-tune if it persists." },
  gap: { title: "Seam gap high", signal: "gap", action: "Check the clamping fixture and busbar flatness; review seam-tracking offsets." },
  plasma: { title: "Plasma out of band", signal: "plasma", action: "Check shielding gas flow and the protective window; compare against the reference band." },
  backRefl: { title: "Back-reflection high", signal: "backRefl", action: "Check copper surface condition and beam incidence angle." },
  optTemp: { title: "Optics temperature high", signal: "optTemp", action: "Check chiller flow and the head cooling circuit before optics drift affects focus." },
  chiller: { title: "Chiller outlet temperature high", signal: "chillerTemp", action: "Replace the chiller filter, check coolant level and clean the condenser." },
  hours: { title: "Service interval reached", signal: "power", action: "Schedule a preventive service visit for the laser source." },
};

function raise(sim: Sim, st: Station, type: AlertType, severity: Severity, rule: string, value: string) {
  const key = `${st.id}:${type}`;
  const sup = sim.suppress.get(key);
  if (sup && sup > sim.now) return;
  const existing = sim.alerts.find((a) => a.stationId === st.id && a.type === type && a.status !== "resolved");
  const life = lifeFor(sim, st, type);
  if (existing) {
    existing.value = value;
    existing.remainingLife = life.text;
    existing.predictedFailure = life.at;
    if (SEV_RANK[severity] > SEV_RANK[existing.severity]) {
      existing.severity = severity;
      existing.rule = rule;
      existing.timeline.push({ t: sim.now, label: `Escalated to ${severity}` });
    }
    return;
  }
  const meta = ACTIONS[type];
  const a: Alert = {
    id: `AL-${pad(sim.seq++, 4)}`,
    stationId: st.id,
    type,
    title: type === "anomaly" ? `Anomaly score high – driven by ${st.driver}` : meta.title,
    severity,
    detected: sim.now,
    predictedFailure: life.at,
    remainingLife: life.text,
    rule,
    value,
    action: meta.action,
    autoActions: [],
    status: "open",
    assignee: null,
    timeline: [{ t: sim.now, label: "Detected" }],
    signal: type === "anomaly" ? driverSignal(st.driver) : meta.signal,
  };
  // auto-actions
  if (type === "window" && hasTier(sim.tier, "CARE")) {
    const c = sim.consumables.find((x) => x.stationId === st.id && x.part === "window")!;
    if (c.order.status !== "ordered") {
      const po = placeOrder(sim, c, "alert");
      a.autoActions.push(`Spare window ordered (${po}), arrives ${fmtDay(c.order.arrives!)}`);
    } else if (c.order.status === "ordered") a.autoActions.push(`Spare window already ordered (${c.order.po}) at ${sim.thresholds.reorderPct}% used, arrives ${fmtDay(c.order.arrives!)}`);
  }
  if (type === "chiller" && hasTier(sim.tier, "CARE")) {
    const c = sim.consumables.find((x) => x.stationId === st.id && x.part === "filter")!;
    if (c.order.status !== "ordered") {
      const po = placeOrder(sim, c, "alert");
      a.autoActions.push(`Chiller filter ordered (${po})`);
    } else if (c.order.status === "ordered") a.autoActions.push(`Chiller filter already ordered (${c.order.po})`);
  }
  if ((type === "powerDrift" || (type === "anomaly" && st.driver === "laser power")) && hasTier(sim.tier, "CARE+")) {
    const booked = sim.calendar.find((e) => e.kind === "remote" && e.title.includes(st.id) && !e.done);
    if (!booked) {
      const t = sim.now + 2 * H;
      sim.calendar.push({ id: `CAL-${sim.seq++}`, t, kind: "remote", title: `AXBIS remote check – ${st.id} laser source` });
      sim.remoteSessions++;
      a.autoActions.push(`AXBIS remote check booked ${fmtDateTime(t)} (within the 4 h CARE+ response time)`);
      logEvent(sim, `Remote check booked for ${st.id}`);
    } else a.autoActions.push(`AXBIS remote check already booked ${fmtDateTime(booked.t)}`);
  }
  if (type === "depth") {
    const mods = [...new Set(st.recent.filter((w) => w.verdict !== "OK").map((w) => w.moduleId))];
    if (mods.length) a.autoActions.push(`Modules held for re-inspection: ${mods.join(", ")}`);
  }
  sim.alerts.unshift(a);
  logEvent(sim, `Alert ${a.id}: ${a.title} on ${st.id}`);
}

function driverSignal(driver: string): Alert["signal"] {
  if (driver === "PGM") return "pgm";
  if (driver === "OCT depth") return "depth";
  if (driver === "plasma") return "plasma";
  if (driver === "optics temperature") return "optTemp";
  return "power";
}

function lifeFor(sim: Sim, st: Station, type: AlertType): { text: string | null; at: number | null } {
  if (type === "window" || (type === "anomaly" && st.driver === "PGM")) {
    const r = st.rulWindow;
    return { text: `Window: ${rulText(r, "h")}`, at: r && !r.infinite ? sim.now + r.value * H : null };
  }
  if (type === "power" || type === "powerDrift" || (type === "anomaly" && st.driver === "laser power")) {
    const r = st.rulLaser;
    return { text: `Laser to 96%: ${rulText(r, "d")}`, at: r && !r.infinite ? sim.now + r.value * DAY : null };
  }
  if (type === "chiller" || type === "optTemp") {
    const peak = 23 + st.chillerCap;
    if (st.chillerRate > 0 && st.chillerOffset < st.chillerCap && peak < sim.thresholds.chillCrit)
      return { text: `Rising toward about ${peak} °C (critical ${sim.thresholds.chillCrit} °C)`, at: null };
    if (st.chillerRate > 0 && st.chillerOffset < st.chillerCap) {
      const hrs = (sim.thresholds.chillCrit - (23 + st.chillerOffset)) / st.chillerRate;
      return { text: `About ${Math.max(0.1, hrs).toFixed(1)} h to ${sim.thresholds.chillCrit} °C`, at: sim.now + hrs * H };
    }
    return { text: "Stable, above limit", at: null };
  }
  return { text: null, at: null };
}

function runRules(sim: Sim, st: Station, m: Sample, depth3: number, gap3: number) {
  const th = sim.thresholds;
  const f = (x: number, d = 1) => x.toFixed(d);
  if (m.pgm >= th.pgmCrit) raise(sim, st, "window", "critical", `PGM ≥ ${th.pgmCrit}%`, `${f(m.pgm)}%`);
  else if (m.pgm >= th.pgmWarn) raise(sim, st, "window", "warning", `PGM ≥ ${th.pgmWarn}%`, `${f(m.pgm)}%`);
  if (m.power < th.powerCrit) raise(sim, st, "power", "critical", `Power < ${th.powerCrit}% of setpoint`, `${f(m.power)}%`);
  else if (m.power < th.powerWarn) raise(sim, st, "power", "warning", `Power < ${th.powerWarn}% of setpoint`, `${f(m.power)}%`);
  if (st.powerSlopeDay < th.powerSlopeWarn) raise(sim, st, "powerDrift", "warning", `Power slope < ${th.powerSlopeWarn} %/day (7-day fit)`, `${f(st.powerSlopeDay, 2)} %/day`);
  const others = sim.alerts.some((a) => a.stationId === st.id && a.status !== "resolved" && a.type !== "anomaly");
  if (st.anomaly > 80) raise(sim, st, "anomaly", "critical", "Anomaly score > 80", `${Math.round(st.anomaly)}`);
  else if (st.anomaly > 60 && !others) raise(sim, st, "anomaly", "warning", "Anomaly score > 60", `${Math.round(st.anomaly)}`);
  if (st.recent.length >= 3) {
    if (depth3 < th.depthCritLow) raise(sim, st, "depth", "critical", `OCT depth < ${th.depthCritLow} mm (3-weld mean)`, `${f(depth3, 3)} mm`);
    else if (depth3 < th.depthWarnLow) raise(sim, st, "depth", "warning", `OCT depth < ${th.depthWarnLow} mm (3-weld mean)`, `${f(depth3, 3)} mm`);
    else if (depth3 > th.depthWarnHigh) raise(sim, st, "depth", "warning", `OCT depth > ${th.depthWarnHigh} mm (3-weld mean)`, `${f(depth3, 3)} mm`);
    if (gap3 > th.gapCrit) raise(sim, st, "gap", "critical", `Gap > ${th.gapCrit} mm (3-weld mean)`, `${f(gap3, 3)} mm`);
    else if (gap3 > th.gapWarn) raise(sim, st, "gap", "warning", `Gap > ${th.gapWarn} mm (3-weld mean)`, `${f(gap3, 3)} mm`);
  }
  if (st.plasmaRun >= th.plasmaCritN) raise(sim, st, "plasma", "critical", `Plasma out of band for ${th.plasmaCritN} welds`, `${st.plasmaRun} welds`);
  else if (st.plasmaRun >= th.plasmaWarnN) raise(sim, st, "plasma", "warning", `Plasma out of band for ${th.plasmaWarnN} welds in a row`, `${st.plasmaRun} welds`);
  if (m.backRefl > th.brCrit) raise(sim, st, "backRefl", "critical", `Back-reflection > ${th.brCrit}`, f(m.backRefl, 2));
  else if (m.backRefl > th.brWarn) raise(sim, st, "backRefl", "warning", `Back-reflection > ${th.brWarn}`, f(m.backRefl, 2));
  if (m.chillerTemp > th.chillCrit) raise(sim, st, "chiller", "critical", `Chiller outlet > ${th.chillCrit} °C`, `${f(m.chillerTemp)} °C`);
  else if (m.chillerTemp > th.chillWarn) raise(sim, st, "chiller", "warning", `Chiller outlet > ${th.chillWarn} °C`, `${f(m.chillerTemp)} °C`);
  if (m.optTemp > th.optCrit) raise(sim, st, "optTemp", "critical", `Optics temperature > ${th.optCrit} °C`, `${f(m.optTemp)} °C`);
  else if (m.optTemp > th.optWarn) raise(sim, st, "optTemp", "warning", `Optics temperature > ${th.optWarn} °C`, `${f(m.optTemp)} °C`);
  if (st.laserHours > th.hoursCrit) raise(sim, st, "hours", "warning", `Laser-on hours > ${th.hoursCrit}`, `${Math.round(st.laserHours)} h`);
  else if (st.laserHours > th.hoursWarn) raise(sim, st, "hours", "info", `Laser-on hours > ${th.hoursWarn}`, `${Math.round(st.laserHours)} h`);
}

// ---------- tick ----------
function advance(st: Station, sec: number) {
  const h = sec / 3600;
  st.pgm = Math.min(100, st.pgm + st.pgmRate * h);
  st.powerDrift += (st.powerDriftRate * sec) / 86400;
  st.chillerOffset = Math.min(st.chillerCap, st.chillerOffset + st.chillerRate * h);
  st.laserHours += h;
  st.nozzleUsed = Math.min(100, st.nozzleUsed + 0.02 * h);
  st.filterUsed = Math.min(100, st.filterUsed + 0.01 * h);
}

export function tick(sim: Sim) {
  sim.now += 1000;
  sim.tickN++;
  for (const st of sim.stations) {
    let remaining = st.trendSpeed;
    while (remaining > 0) {
      const chunk = Math.min(remaining, HIST_STEP_S - st.histAcc);
      advance(st, chunk);
      st.st += chunk * 1000;
      st.histAcc += chunk;
      remaining -= chunk;
      if (st.histAcc >= HIST_STEP_S) {
        st.hist.push(makeSample(st, st.st));
        st.histAcc = 0;
      }
    }
    const cutoff = st.st - 7 * DAY;
    while (st.hist.length && st.hist[0].t < cutoff) st.hist.shift();
    const s = makeSample(st, sim.now);
    st.samples.push(s);
    if (st.samples.length > 600) st.samples.shift();
    st.minuteAcc.push(s);
    if (st.minuteAcc.length >= 60) {
      st.minute.push(meanSample(st.minuteAcc, sim.now));
      if (st.minute.length > 60) st.minute.shift();
      st.minuteAcc = [];
    }
  }
  if (sim.tickN % 2 === 0) produceWelds(sim);
  updateConsumables(sim);
  for (const st of sim.stations) {
    const { m, depth3, gap3 } = derive(sim, st);
    runRules(sim, st, m, depth3, gap3);
  }
  // scenario countdown
  if (sim.scenario) {
    sim.scenario.ticksLeft--;
    if (sim.scenario.ticksLeft <= 0) endScenario(sim);
  }
}

// ---------- scenarios (6.4) ----------
export const SCENARIOS: { id: "S0" | Scenario["id"]; label: string; stationId: string; what: string; lapse: string }[] = [
  { id: "S0", label: "Normal", stationId: "All", what: "Reset: signals in band, about 0.3% CHECK welds", lapse: "live" },
  { id: "S1", label: "Window contamination", stationId: "WELD-03", what: "PGM rises 2% per hour from 60%", lapse: "12.5 h in 30 s" },
  { id: "S2", label: "Power drift", stationId: "WELD-05", what: "Laser power falls 0.6% per day", lapse: "5 days in 30 s" },
  { id: "S3", label: "Depth drop", stationId: "WELD-02", what: "OCT depth falls to 1.05 mm on 12 welds", lapse: "live, 12 welds" },
  { id: "S4", label: "Chiller fault", stationId: "WELD-06", what: "Chiller outlet climbs to 27 °C", lapse: "30 min in 30 s" },
];

function endScenario(sim: Sim) {
  const sc = sim.scenario;
  if (!sc) return;
  const st = sim.stations.find((s) => s.id === sc.stationId);
  if (st) st.trendSpeed = 1;
  logEvent(sim, `Scenario ${sc.id} finished`);
  sim.scenario = null;
}

export function startScenario(sim: Sim, id: Scenario["id"]) {
  endScenario(sim);
  const def = SCENARIOS.find((s) => s.id === id)!;
  const st = sim.stations.find((s) => s.id === def.stationId)!;
  sim.suppress.forEach((_, k) => k.startsWith(st.id) && sim.suppress.delete(k));
  let ticks = 30;
  if (id === "S1") {
    st.pgm = 60;
    st.pgmRate = 2;
    for (const p of st.hist) {
      const hb = (st.st - p.t) / H;
      if (hb <= 6) p.pgm = 60 - 2 * hb + gauss(0.3);
    }
    st.trendSpeed = 1500;
    ticks = 33;
  } else if (id === "S2") {
    st.powerDriftRate = -0.6;
    st.pgmRate = 0;
    st.trendSpeed = 14400;
  } else if (id === "S3") {
    st.depthOverride = { pending: true, k: 0, total: 12 };
    ticks = 40;
  } else if (id === "S4") {
    st.chillerRate = 8;
    st.chillerCap = 4;
    st.trendSpeed = 60;
  }
  sim.scenario = { id, label: def.label, stationId: st.id, ticksLeft: ticks, total: ticks, lapse: def.lapse };
  logEvent(sim, `Scenario ${id} started: ${def.label} on ${st.id}`);
}

// ---------- user actions ----------
const DOWNTIME_AVOIDED: Record<AlertType, { h: number; ng: number }> = {
  window: { h: 3, ng: 120 },
  power: { h: 4, ng: 100 },
  powerDrift: { h: 6, ng: 200 },
  anomaly: { h: 4, ng: 60 },
  depth: { h: 2, ng: 80 },
  gap: { h: 1, ng: 20 },
  plasma: { h: 1, ng: 20 },
  backRefl: { h: 1, ng: 20 },
  optTemp: { h: 3, ng: 40 },
  chiller: { h: 5, ng: 40 },
  hours: { h: 2, ng: 0 },
};
export const avoidedFor = (t: AlertType) => DOWNTIME_AVOIDED[t];

function applyFix(sim: Sim, st: Station, type: AlertType | "general" | "doe") {
  let kind: string = type;
  if (type === "anomaly") kind = st.driver === "PGM" || st.driver === "plasma" ? "window" : st.driver === "optics temperature" ? "chiller" : st.driver === "OCT depth" ? "depth" : "power";
  if (kind === "window" || kind === "plasma") {
    st.pgm = 2;
    st.pgmRate = 0.5;
    const c = sim.consumables.find((x) => x.stationId === st.id && x.part === "window")!;
    sim.stock.window = Math.max(0, sim.stock.window - 1);
    if (c.order.status === "ordered") {
      c.order.status = "delivered";
      sim.stock.window++;
    }
    sim.partsDelivered++;
    curMonth(sim).parts++;
  } else if (kind === "power" || kind === "powerDrift") {
    st.powerDrift = 0;
    st.powerDriftRate = 0;
    st.pgmRate = 0.5;
    st.hist.forEach((p) => {
      if (p.t > st.st - 6 * H) p.power = 100 + gauss(0.25);
    });
  } else if (kind === "depth" || kind === "doe") {
    st.depthOverride = null;
  } else if (kind === "chiller" || kind === "optTemp") {
    st.chillerOffset = 0;
    st.chillerRate = 0;
    st.filterUsed = 8;
    const c = sim.consumables.find((x) => x.stationId === st.id && x.part === "filter")!;
    sim.stock.filter = Math.max(0, sim.stock.filter - 1);
    if (c.order.status === "ordered") {
      c.order.status = "delivered";
      sim.stock.filter++;
    }
    sim.partsDelivered++;
    curMonth(sim).parts++;
  } else if (kind === "hours") {
    st.laserHours = 0;
  }
  if (sim.scenario?.stationId === st.id) endScenario(sim);
  st.samples = st.samples.slice(-1);
  for (let k = 0; k < 5; k++) st.samples.push(makeSample(st, sim.now));
  resetBaseline(st);
  st.anomaly = 20;
  st.plasmaRun = 0;
  updateConsumables(sim, false);
}

function curMonth(sim: Sim) {
  return sim.ledger[sim.ledger.length - 1];
}

export function acknowledge(sim: Sim, a: Alert) {
  if (a.status !== "open") return;
  a.status = "acknowledged";
  a.timeline.push({ t: sim.now, label: "Acknowledged" });
}

export function assign(sim: Sim, a: Alert, who: string) {
  a.assignee = who;
  if (a.status === "open") a.status = "acknowledged";
  a.timeline.push({ t: sim.now, label: `Assigned to ${who}` });
}

export function resolveAlert(sim: Sim, a: Alert, via?: string) {
  if (a.status === "resolved") return;
  const st = sim.stations.find((s) => s.id === a.stationId)!;
  a.status = "resolved";
  a.timeline.push({ t: sim.now, label: via ? `Resolved (${via})` : "Resolved" });
  applyFix(sim, st, a.type);
  const av = DOWNTIME_AVOIDED[a.type];
  const m = curMonth(sim);
  m.downtimeH += av.h;
  m.ngAvoided += av.ng;
  m.events.push({ t: sim.now, text: `${a.id} ${a.title} (${a.stationId})`, hours: av.h, ng: av.ng });
  sim.suppress.set(`${a.stationId}:${a.type}`, sim.now + 120_000);
  // the same fix clears related open alerts on this station
  for (const o of sim.alerts) {
    if (o !== a && o.stationId === a.stationId && o.status !== "resolved" && (o.type === "anomaly" || relatedTypes(a.type).includes(o.type))) {
      o.status = "resolved";
      o.timeline.push({ t: sim.now, label: `Cleared by fix on ${a.id}` });
      sim.suppress.set(`${o.stationId}:${o.type}`, sim.now + 120_000);
    }
  }
  const wo = sim.workOrders.find((w) => w.alertId === a.id && !w.closed);
  if (wo) {
    wo.checklist.forEach((c) => (c.done = true));
    wo.closed = sim.now;
  }
  logEvent(sim, `Alert ${a.id} resolved · ${av.h} h downtime avoided`);
}

function relatedTypes(t: AlertType): AlertType[] {
  if (t === "window") return ["plasma", "backRefl", "depth"];
  if (t === "power" || t === "powerDrift") return ["power", "powerDrift", "depth"];
  if (t === "chiller" || t === "optTemp") return ["chiller", "optTemp"];
  if (t === "depth") return ["depth"];
  return [];
}

const CHECKLISTS: Record<string, string[]> = {
  window: ["Laser off and lock-out per plant procedure", "Remove protective window cassette", "Fit new window from stock", "Reset PGM baseline", "Run 3 test welds and check OCT depth"],
  power: ["Laser off and lock-out", "Inspect fiber connector and collimator", "Run LPM calibration", "Verify power at workpiece 99–101%"],
  depth: ["Quarantine affected modules", "Check focus position", "Verify power at workpiece", "Run test coupon and cross-section", "Release or request DOE re-tune"],
  chiller: ["Check coolant level", "Replace chiller filter", "Clean condenser fins", "Verify outlet 22–24 °C"],
  general: ["Visual inspection of head and optics", "Check signals against reference band", "Record findings"],
  doe: ["Send last 200 welds to L.A.C.", "L.A.C. runs DOE on test coupons", "Release new recipe version", "Verify first 20 welds"],
};

export function createWorkOrder(sim: Sim, stationId: string, alert?: Alert | null, kind?: WorkOrder["type"]): WorkOrder {
  const st = sim.stations.find((s) => s.id === stationId)!;
  const a = alert ?? sim.alerts.find((x) => x.stationId === stationId && x.status !== "resolved") ?? null;
  const type: WorkOrder["type"] = kind ?? a?.type ?? "general";
  const ckKey = type === "powerDrift" ? "power" : type === "optTemp" ? "chiller" : type === "anomaly" ? (st.driver === "PGM" ? "window" : st.driver === "laser power" ? "power" : "general") : type;
  const list = CHECKLISTS[ckKey] ?? CHECKLISTS.general;
  const wo: WorkOrder = {
    id: `WO-${pad(sim.seq++, 4)}`,
    alertId: a?.id ?? null,
    stationId,
    type,
    title: type === "doe" ? `DOE re-tune request – ${stationId}` : a ? `${a.title} – ${stationId}` : `Inspection – ${stationId}`,
    assignee: type === "doe" ? PEOPLE.axbis : PEOPLE.maint,
    created: sim.now,
    due: sim.now + (type === "doe" ? 3 * DAY : 4 * H),
    checklist: list.map((text) => ({ text, done: false })),
    closed: null,
  };
  sim.workOrders.unshift(wo);
  sim.calendar.push({ id: `CAL-${sim.seq++}`, t: wo.due, kind: type === "doe" ? "doe" : "workorder", title: `${wo.id} ${wo.title}` });
  if (a) {
    a.workOrderId = wo.id;
    if (!a.assignee) a.assignee = wo.assignee;
    if (a.status === "open") a.status = "acknowledged";
    a.timeline.push({ t: sim.now, label: `Work order ${wo.id} created` });
  }
  logEvent(sim, `Work order ${wo.id} created for ${stationId}`);
  return wo;
}

export function closeWorkOrder(sim: Sim, wo: WorkOrder) {
  if (wo.closed) return;
  wo.checklist.forEach((c) => (c.done = true));
  wo.closed = sim.now;
  const a = wo.alertId ? sim.alerts.find((x) => x.id === wo.alertId) : null;
  if (a && a.status !== "resolved") resolveAlert(sim, a, `work order ${wo.id}`);
  else if (wo.type !== "general") applyFix(sim, sim.stations.find((s) => s.id === wo.stationId)!, wo.type);
  const ev = sim.calendar.find((e) => e.title.startsWith(wo.id));
  if (ev) ev.done = true;
  logEvent(sim, `Work order ${wo.id} closed`);
}

export function requestDoe(sim: Sim, stationId: string) {
  sim.doeRequests.push({ t: sim.now, stationId });
  return createWorkOrder(sim, stationId, null, "doe");
}

export function reinspect(sim: Sim, w: Weld, v: "OK" | "NG") {
  w.reinspected = v;
  sim.checkQueue = sim.checkQueue.filter((x) => x !== w);
}

// ---------- queries ----------
export function searchWelds(sim: Sim, q: string): { kind: "module" | "cell" | "weld" | "none"; moduleId?: string; welds: Weld[] } {
  const s = q.trim().toUpperCase();
  if (!s) return { kind: "none", welds: [] };
  if (sim.modules.has(s)) return { kind: "module", moduleId: s, welds: sim.modules.get(s)!.welds };
  if (sim.byCell.has(s)) return { kind: "cell", moduleId: sim.byCell.get(s)![0].moduleId, welds: sim.byCell.get(s)! };
  if (sim.byWeld.has(s)) {
    const w = sim.byWeld.get(s)!;
    return { kind: "weld", moduleId: w.moduleId, welds: [w] };
  }
  const digits = s.match(/(\d{3,4})$/);
  if (digits) {
    const id = moduleIdOf(Number(digits[1]));
    if (sim.modules.has(id)) return { kind: "module", moduleId: id, welds: sim.modules.get(id)!.welds };
  }
  return { kind: "none", welds: [] };
}

export function effectiveVerdict(w: Weld): Verdict {
  if (w.reinspected) return w.reinspected;
  return w.verdict;
}

export function worstVerdict(welds: Weld[]): Verdict {
  let v: Verdict = "OK";
  for (const w of welds) {
    const e = effectiveVerdict(w);
    if (e === "NG") return "NG";
    if (e === "CHECK") v = "CHECK";
  }
  return v;
}

export function costPerHourM(sim: Sim) {
  return (2.3e6 * (sim.value.lineScalePct / 100) * sim.value.fxKrw) / 1e6;
}
export function feeMonthM(sim: Sim) {
  return (sim.value.feePerMachineYearM * sim.stations.length) / 12;
}
export function monthValueM(sim: Sim, m: LedgerMonth) {
  return m.downtimeH * costPerHourM(sim) + (m.ngAvoided * sim.value.scrapKrw) / 1e6;
}

export function siteToday(sim: Sim) {
  let n = 0,
    ok = 0,
    check = 0,
    ng = 0;
  for (const st of sim.stations) {
    n += st.today.n;
    ok += st.today.ok;
    check += st.today.check;
    ng += st.today.ng;
  }
  return { n, ok, check, ng, okPct: n ? (ok / n) * 100 : 100 };
}

export function openAlerts(sim: Sim) {
  return sim.alerts.filter((a) => a.status !== "resolved");
}

// display helper: convert station-time to global time for history charts
export function histGlobal(st: Station, sim: Sim) {
  const off = st.st - sim.now;
  return st.hist.map((p) => ({ ...p, t: p.t - off }));
}

export { r2, clamp };
