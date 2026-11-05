import type { Joint, Role, Thresholds, Tier } from "./config";
import type { Lang } from "./i18n";

export type Verdict = "OK" | "CHECK" | "NG";
export type Cause = "Depth low" | "Depth high" | "Gap" | "Plasma" | "Back-reflection" | "Window";

export interface Sample {
  t: number;
  power: number;
  pgm: number;
  depth: number;
  gap: number;
  plasma: number;
  backRefl: number;
  optTemp: number;
  chillerTemp: number;
}

export interface Weld {
  weldId: string;
  moduleId: string;
  cellId: string;
  stationId: string;
  ts: number;
  recipe: string;
  depthMm: number;
  gapMm: number;
  plasma: number;
  backRefl: number;
  pgm: number;
  score: number;
  verdict: Verdict;
  cause: Cause | null;
  reinspected?: "OK" | "NG";
}

export interface ModuleInfo {
  moduleId: string;
  serial: number;
  batch: string;
  welds: Weld[];
  exported?: string;
}

export type StationStatus = "running" | "warning" | "critical";

export interface Rul {
  value: number; // hours (window) or days (laser)
  pm: number;
  slope: number; // per hour (window) or per day (laser)
  a: number; // fitted value now
  sd: number; // residual standard deviation
  infinite: boolean; // no meaningful downward/upward trend
}

export interface Station {
  id: string;
  idx: number;
  laser: string;
  joint: Joint;
  recipe: string;
  // degradation state
  pgm: number;
  pgmRate: number; // %/h
  powerDrift: number; // % offset
  powerDriftRate: number; // %/day
  chillerOffset: number; // °C
  chillerRate: number; // °C/h
  chillerCap: number;
  depthOverride: { pending: boolean; k: number; total: number } | null;
  laserHours: number;
  nozzleUsed: number;
  filterUsed: number;
  // time
  st: number; // station time (ms); == now unless time-lapsed
  trendSpeed: number; // station seconds per tick
  histAcc: number;
  // buffers
  samples: Sample[]; // last 600 one-second samples (global time)
  hist: Sample[]; // 10-minute points over 7 days (station time)
  minute: Sample[]; // last 60 one-minute averages (global time)
  minuteAcc: Sample[];
  baseline: Sample[]; // rolling 200 samples from normal operation
  recent: Weld[]; // last 50 welds
  plasmaRun: number;
  // derived
  current: Sample;
  anomaly: number;
  anomalyPrev: number;
  anomalyTrend: number;
  driver: string;
  health: number;
  status: StationStatus;
  rulWindow: Rul | null;
  rulLaser: Rul | null;
  powerSlopeDay: number;
  moduleSerial: number;
  weldInModule: number;
  today: { n: number; ok: number; check: number; ng: number };
}

export type AlertType =
  | "window"
  | "power"
  | "powerDrift"
  | "anomaly"
  | "depth"
  | "gap"
  | "plasma"
  | "backRefl"
  | "optTemp"
  | "chiller"
  | "hours";

export type Severity = "info" | "warning" | "critical";

export interface ExplainResult {
  likely_cause: string;
  risk_if_ignored: string;
  time_to_impact?: string;
  recommended_actions: string[];
  parts_needed?: string[];
  confidence: "low" | "medium" | "high";
  source: "gemini" | "template";
  model?: string;
}

export interface Alert {
  id: string;
  stationId: string;
  type: AlertType;
  title: string;
  severity: Severity;
  detected: number;
  predictedFailure: number | null;
  remainingLife: string | null;
  rule: string;
  value: string;
  action: string;
  autoActions: string[];
  status: "open" | "acknowledged" | "resolved";
  assignee: string | null;
  timeline: { t: number; label: string }[];
  signal: keyof Omit<Sample, "t">;
  ai?: ExplainResult;
  workOrderId?: string;
}

export type PartKind = "window" | "nozzle" | "filter";

export interface Consumable {
  id: string;
  part: PartKind;
  stationId: string;
  used: number;
  order: { status: "none" | "ordered" | "delivered"; po?: string; orderedAt?: number; arrives?: number };
}

export interface WorkOrder {
  id: string;
  alertId: string | null;
  stationId: string;
  type: AlertType | "general" | "doe";
  title: string;
  assignee: string;
  created: number;
  due: number;
  checklist: { text: string; done: boolean }[];
  closed: number | null;
}

export interface CalEvent {
  id: string;
  t: number;
  kind: "visit" | "remote" | "workorder" | "doe";
  title: string;
  done?: boolean;
}

export interface LedgerMonth {
  month: string; // YYYY-MM
  label: string;
  downtimeH: number;
  ngAvoided: number;
  parts: number;
  responseMet: number; // %
  events: { t: number; text: string; hours: number; ng: number }[];
}

export interface Scenario {
  id: "S1" | "S2" | "S3" | "S4";
  label: string;
  stationId: string;
  ticksLeft: number;
  total: number;
  lapse: string;
}

export interface HourAgg {
  hour: number; // start ms
  n: number;
  ok: number;
  sum: number;
  sumSq: number;
}

export interface Sim {
  now: number;
  tickN: number;
  step: number;
  tier: Tier;
  lang: Lang;
  role: Role;
  thresholds: Thresholds;
  stations: Station[];
  welds: Weld[];
  byWeld: Map<string, Weld>;
  byCell: Map<string, Weld[]>;
  modules: Map<string, ModuleInfo>;
  hours: Map<number, HourAgg>;
  depthBins: number[]; // today's depth histogram, 0.90..1.50 by 0.02
  causes: Record<Cause, { check: number; ng: number }>;
  checkQueue: Weld[];
  alerts: Alert[];
  suppress: Map<string, number>;
  consumables: Consumable[];
  stock: Record<PartKind, number>;
  reorderPoint: Record<PartKind, number>;
  workOrders: WorkOrder[];
  calendar: CalEvent[];
  ledger: LedgerMonth[];
  partsDelivered: number;
  remoteSessions: number;
  scenario: Scenario | null;
  seq: number;
  uptime30: { day: string; pct: number }[];
  log: { t: number; text: string }[];
  value: { lineScalePct: number; fxKrw: number; scrapKrw: number; feePerMachineYearM: number };
  doeRequests: { t: number; stationId: string }[];
}
