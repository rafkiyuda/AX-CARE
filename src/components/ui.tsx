"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { TIERS, TIER_INFO, hasTier, type Tier } from "@/lib/config";
import { act, useSim } from "@/lib/store";
import { t } from "@/lib/i18n";

export function Card({ title, right, children, className = "", style }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || right) && (
        <div className="card-h">
          {typeof title === "string" ? <h2>{title}</h2> : <div style={{ flex: 1 }}>{title}</div>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({ label, value, unit, foot, tip }: { label: string; value: ReactNode; unit?: string; foot?: ReactNode; tip?: string }) {
  return (
    <div className="card kpi">
      <div className="label">{tip ? <Tip text={tip}><span className="formula">{label}</span></Tip> : label}</div>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="tip">
      {children}
      <span className="tip-body">{text}</span>
    </span>
  );
}

export function StatusBadge({ s }: { s: "running" | "warning" | "critical" }) {
  const sim = useSim();
  return (
    <span className={`badge b-${s}`}>
      <span className={`dot ${s}`} />
      {t(sim.lang, s)}
    </span>
  );
}

export function SevBadge({ s }: { s: "info" | "warning" | "critical" }) {
  return <span className={`badge b-${s}`}>{s}</span>;
}

export function VerdictBadge({ v }: { v: "OK" | "CHECK" | "NG" }) {
  return <span className={`badge b-${v.toLowerCase()}`}>{v}</span>;
}

export function Gauge({ value, size = 64 }: { value: number; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const a0 = Math.PI;
  const a = Math.PI * (1 - v / 100);
  const x = cx + r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  const color = v > 80 ? "var(--red-2)" : v > 60 ? "var(--amber)" : v > 40 ? "#d9b84a" : "var(--green)";
  return (
    <svg width={size} height={size / 2 + 12} viewBox={`0 0 ${size} ${size / 2 + 12}`} aria-label={`Anomaly score ${Math.round(v)}`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#e6eaef" strokeWidth={7} strokeLinecap="round" />
      <path d={`M ${cx + r * Math.cos(a0)} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size / 4.2} fontWeight={700} fill="var(--ink)">
        {Math.round(v)}
      </text>
    </svg>
  );
}

export function Sparkline({ data, lo, hi, width = 120, height = 30 }: { data: number[]; lo?: number; hi?: number; width?: number; height?: number }) {
  if (!data.length) return null;
  const min = Math.min(...data, lo ?? Infinity) - 0.01;
  const max = Math.max(...data, hi ?? -Infinity) + 0.01;
  const sx = (i: number) => (i / Math.max(1, data.length - 1)) * width;
  const sy = (v: number) => height - ((v - min) / (max - min)) * height;
  const pts = data.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {lo !== undefined && hi !== undefined && <rect x={0} y={sy(hi)} width={width} height={Math.max(0, sy(lo) - sy(hi))} fill="#e3f3ea" />}
      <polyline points={pts} fill="none" stroke="var(--navy)" strokeWidth={1.4} />
    </svg>
  );
}

export function Progress({ pct, warn = 70, crit = 90 }: { pct: number; warn?: number; crit?: number }) {
  return (
    <div className={`progress ${pct >= crit ? "crit" : pct >= warn ? "warn" : ""}`}>
      <span style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

const NEXT_PITCH: Record<Tier, string> = {
  RETROFIT: "",
  CARE: "Scheduled maintenance, remote tickets and automatic consumables reordering.",
  "CARE+": "Predictive alerts, anomaly score, remaining-life forecast and a guaranteed 4 h response.",
  "QUALITY+": "Per-weld quality records, module traceability, MES export and the AI copilot with full data.",
};

/** Locked-screen upsell: blurred preview + "Upgrade to X" card (F12). */
export function Gate({ need, children, title }: { need: Tier; children: ReactNode; title?: string }) {
  const sim = useSim();
  if (hasTier(sim.tier, need)) return <>{children}</>;
  return (
    <div className="locked">
      <div className="preview" aria-hidden>
        {children}
      </div>
      <div className="gate">
        <div className="gate-card">
          <div className="row">
            <span className="badge b-navy">🔒 {need}</span>
            <span className="muted small">Your licence: {sim.tier}</span>
          </div>
          <h2 style={{ marginTop: 10 }}>
            {t(sim.lang, "Upgrade to")} {need}
            {title ? ` to unlock ${title}` : ""}
          </h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>{NEXT_PITCH[need]}</p>
          <div className="tierline">
            {TIERS.map((x) => (
              <span key={x} className={`badge ${hasTier(x, need) ? "b-navy" : "b-grey"}`}>
                {x}
              </span>
            ))}
          </div>
          <p className="small muted" style={{ margin: "0 0 12px" }}>
            {TIER_INFO[need].unlocks} · <i>{TIER_INFO[need].price}</i>
          </p>
          <button className="btn btn-primary" onClick={() => act((s) => (s.tier = need))}>
            Upgrade to {need} (demo)
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small inline lock for a single widget. */
export function MiniLock({ need, label }: { need: Tier; label: string }) {
  return (
    <div className="mini-lock">
      🔒 {label}
      <br />
      <button className="link small" onClick={() => act((s) => (s.tier = need))}>
        Upgrade to {need}
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-h">
          <h2 style={{ flex: 1 }}>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="drawer-b">{children}</div>
        {footer && <div className="drawer-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="drawer-h">
          <div style={{ flex: 1 }}>{title}</div>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="drawer-b">{children}</div>
        {footer && <div className="drawer-f">{footer}</div>}
      </aside>
    </>
  );
}

export function StationLink({ id }: { id: string }) {
  return (
    <Link href={`/station/${id}`} className="link">
      {id}
    </Link>
  );
}
