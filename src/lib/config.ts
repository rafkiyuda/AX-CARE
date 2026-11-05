// Static configuration for the AX CARE prototype. All values are prototype values ("sample data"),
// not AXBIS or customer limits (PRD 6).

export const SITE = {
  id: "plant-a-ml2",
  name: "Plant A · Module Line 2",
  customer: "Sample battery module plant",
  contractEnd: "Dec 2027",
};

export const SIM_START = Date.parse("2026-11-05T14:00:00+09:00");
export const TZ = "Asia/Seoul";

export type Tier = "RETROFIT" | "CARE" | "CARE+" | "QUALITY+";
export const TIERS: Tier[] = ["RETROFIT", "CARE", "CARE+", "QUALITY+"];
export const tierRank = (t: Tier) => TIERS.indexOf(t);
export const hasTier = (current: Tier, needed: Tier) => tierRank(current) >= tierRank(needed);

export const TIER_INFO: Record<Tier, { unlocks: string; price: string }> = {
  RETROFIT: {
    unlocks: "AX VIEW monitoring kit on an existing line, any laser brand: live signals and machine status",
    price: "One-off kit, then moves to CARE",
  },
  CARE: {
    unlocks: "+ maintenance calendar, remote support tickets, consumables tracker with automatic reordering",
    price: "KRW – per machine / year, prepaid",
  },
  "CARE+": {
    unlocks: "+ predictive alerts, anomaly score, remaining-life forecast, 4 h remote / 24 h on-site response",
    price: "KRW – premium on CARE",
  },
  "QUALITY+": {
    unlocks: "+ per-weld quality records, module traceability, MES export, DOE re-tune requests, AI copilot with full data",
    price: "KRW – highest tier",
  },
};

export const RESPONSE_TIME: Record<Tier, string> = {
  RETROFIT: "Ad hoc (billed)",
  CARE: "Next business day",
  "CARE+": "4 h remote · 24 h on-site",
  "QUALITY+": "4 h remote · 24 h on-site",
};

export type Joint = "busbar" | "tab" | "case";

export interface StationMeta {
  id: string;
  laser: string;
  joint: Joint;
  recipe: string;
  pgm0: number;
  hours0: number;
  nozzle0: number;
  filter0: number;
}

export const STATIONS: StationMeta[] = [
  { id: "WELD-01", laser: "IPG fiber 6 kW", joint: "busbar", recipe: "BB-AL-CU v3.2", pgm0: 34, hours0: 1420, nozzle0: 42, filter0: 38 },
  { id: "WELD-02", laser: "IPG fiber 6 kW", joint: "busbar", recipe: "BB-AL-CU v3.2", pgm0: 41, hours0: 980, nozzle0: 55, filter0: 47 },
  { id: "WELD-03", laser: "AXBIS VisionSCAN + 6 kW fiber", joint: "busbar", recipe: "BB-AL-CU v3.2", pgm0: 52, hours0: 1660, nozzle0: 61, filter0: 33 },
  { id: "WELD-04", laser: "TRUMPF disk 4 kW", joint: "tab", recipe: "TAB-CU-NI v2.4", pgm0: 28, hours0: 1210, nozzle0: 24, filter0: 52 },
  { id: "WELD-05", laser: "nLight fiber 6 kW", joint: "tab", recipe: "TAB-CU-NI v2.4", pgm0: 45, hours0: 1450, nozzle0: 37, filter0: 41 },
  { id: "WELD-06", laser: "AXBIS VisionSCAN + 4 kW fiber", joint: "case", recipe: "CS-AL v1.7", pgm0: 38, hours0: 760, nozzle0: 48, filter0: 58 },
];

export interface Thresholds {
  powerWarn: number;
  powerCrit: number;
  powerSlopeWarn: number;
  pgmWarn: number;
  pgmCrit: number;
  depthWarnLow: number;
  depthWarnHigh: number;
  depthCritLow: number;
  gapWarn: number;
  gapCrit: number;
  plasmaLow: number;
  plasmaHigh: number;
  plasmaWarnN: number;
  plasmaCritN: number;
  brWarn: number;
  brCrit: number;
  optWarn: number;
  optCrit: number;
  chillWarn: number;
  chillCrit: number;
  hoursWarn: number;
  hoursCrit: number;
  reorderPct: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  powerWarn: 98,
  powerCrit: 96,
  powerSlopeWarn: -0.3,
  pgmWarn: 70,
  pgmCrit: 85,
  depthWarnLow: 1.1,
  depthWarnHigh: 1.35,
  depthCritLow: 1.0,
  gapWarn: 0.1,
  gapCrit: 0.2,
  plasmaLow: 0.45,
  plasmaHigh: 0.6,
  plasmaWarnN: 3,
  plasmaCritN: 10,
  brWarn: 0.3,
  brCrit: 0.4,
  optWarn: 38,
  optCrit: 42,
  chillWarn: 26,
  chillCrit: 28,
  hoursWarn: 2000,
  hoursCrit: 2500,
  reorderPct: 80,
};

export const THRESHOLD_ROWS: { label: string; unit: string; warn: keyof Thresholds; crit?: keyof Thresholds; note?: string }[] = [
  { label: "Laser power vs setpoint (low)", unit: "%", warn: "powerWarn", crit: "powerCrit" },
  { label: "Laser power slope (warning)", unit: "%/day", warn: "powerSlopeWarn" },
  { label: "Protective-window contamination", unit: "%", warn: "pgmWarn", crit: "pgmCrit" },
  { label: "Weld depth OCT (low)", unit: "mm", warn: "depthWarnLow", crit: "depthCritLow" },
  { label: "Weld depth OCT (high)", unit: "mm", warn: "depthWarnHigh" },
  { label: "Seam offset / gap", unit: "mm", warn: "gapWarn", crit: "gapCrit" },
  { label: "Plasma band low / high", unit: "0–1", warn: "plasmaLow", crit: "plasmaHigh", note: "band" },
  { label: "Plasma welds out of band in a row", unit: "welds", warn: "plasmaWarnN", crit: "plasmaCritN" },
  { label: "Back-reflection", unit: "0–1", warn: "brWarn", crit: "brCrit" },
  { label: "Optics temperature", unit: "°C", warn: "optWarn", crit: "optCrit" },
  { label: "Chiller outlet temperature", unit: "°C", warn: "chillWarn", crit: "chillCrit" },
  { label: "Laser-on hours since service", unit: "h", warn: "hoursWarn", crit: "hoursCrit" },
  { label: "Consumable auto-reorder at", unit: "% used", warn: "reorderPct" },
];

export const PEOPLE = {
  maint: "Min-jun (maintenance)",
  quality: "Seo-yeon (quality)",
  manager: "Ji-ho (production)",
  director: "Hye-rin (plant director)",
  axbis: "AXBIS remote service",
};

export type Role = "maint" | "quality" | "manager" | "director";
export const ROLES: { id: Role; name: string; title: string; landing: string }[] = [
  { id: "maint", name: "Min-jun", title: "Maintenance engineer", landing: "/alerts" },
  { id: "quality", name: "Seo-yeon", title: "Quality engineer", landing: "/quality" },
  { id: "manager", name: "Ji-ho", title: "Production manager", landing: "/" },
  { id: "director", name: "Hye-rin", title: "Plant director (buyer)", landing: "/value" },
];
