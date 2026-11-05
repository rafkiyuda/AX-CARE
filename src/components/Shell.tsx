"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ROLES, SITE, TIERS, hasTier, type Tier } from "@/lib/config";
import { t } from "@/lib/i18n";
import { SCENARIOS, openAlerts, startScenario } from "@/lib/sim";
import { act, resetSim, setPaused, startTicker, usePaused, useSim } from "@/lib/store";
import { useUI } from "@/lib/ui";
import type { Scenario } from "@/lib/types";
import { Copilot } from "./Copilot";

const NAV: { href: string; label: string; need?: Tier }[] = [
  { href: "/", label: "Overview" },
  { href: "/station/WELD-01", label: "Stations" },
  { href: "/alerts", label: "Alerts", need: "CARE+" },
  { href: "/quality", label: "Quality", need: "QUALITY+" },
  { href: "/service", label: "Service & parts", need: "CARE" },
  { href: "/value", label: "Value report" },
  { href: "/settings", label: "Settings" },
];

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

function ScenarioMenu() {
  const sim = useSim();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const paused = usePaused();
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="tb-btn" onClick={() => setOpen((o) => !o)}>
        ▶ {t(sim.lang, "Scenario")}
        {sim.scenario ? ` · ${sim.scenario.id}` : ""}
      </button>
      {open && (
        <div className="menu">
          <div className="tiny muted" style={{ padding: "4px 10px 6px" }}>
            Scenario player (F03) · time-lapse plays a long trend in about 30 s
          </div>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`menu-item ${sim.scenario?.id === s.id ? "on" : ""}`}
              onClick={() => {
                if (s.id === "S0") resetSim();
                else act((x) => startScenario(x, s.id as Scenario["id"]));
                setOpen(false);
              }}
            >
              <div className="row" style={{ gap: 6 }}>
                <b>
                  {s.id} {s.label}
                </b>
                <span className="badge b-grey">{s.stationId}</span>
                <span className="spacer" />
                <span className="tiny muted">{s.lapse}</span>
              </div>
              <div className="small muted">{s.what}</div>
            </button>
          ))}
          <div className="row" style={{ padding: "6px 10px" }}>
            <button className="btn btn-sm" onClick={() => setPaused(!paused)}>
              {paused ? "▶ Resume data" : "⏸ Pause data"}
            </button>
            <span className="tiny muted">S0 resets the whole demo.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleMenu() {
  const sim = useSim();
  const router = useRouter();
  return (
    <select
      className="tb-select"
      value={sim.role}
      title={t(sim.lang, "View as")}
      onChange={(e) => {
        const r = ROLES.find((x) => x.id === e.target.value)!;
        act((s) => (s.role = r.id));
        router.push(r.landing);
      }}
    >
      {ROLES.map((r) => (
        <option key={r.id} value={r.id}>
          👤 {r.name} · {r.title}
        </option>
      ))}
    </select>
  );
}

/** AX CARE wordmark, cropped from public/axcare-logo.webp (2000×667, wordmark at x 225–1812, y 213–475). */
export function Brand({ height = 24 }: { height?: number }) {
  return (
    <span className="brand-chip">
      <span className="brand" style={{ height, width: (height * 1587) / 262 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/axcare-logo.webp" alt="AX CARE" />
      </span>
    </span>
  );
}

function TopBar() {
  const sim = useSim();
  const ui = useUI();
  const open = openAlerts(sim).length;
  return (
    <header className="topbar">
      <Link href="/" className="logo" aria-label="AX CARE home">
        <Brand />
      </Link>
      <select className="tb-select" defaultValue={SITE.id} aria-label="Site">
        <option value={SITE.id}>{SITE.name}</option>
      </select>
      <div className="tiers" role="group" aria-label="Tier switcher">
        {TIERS.map((x) => (
          <button key={x} className={sim.tier === x ? "on" : ""} onClick={() => act((s) => (s.tier = x))}>
            {x}
          </button>
        ))}
      </div>
      <span className="pill pill-licence">
        <span className="dot" />
        {sim.tier} active · to {SITE.contractEnd}
      </span>
      <span className="spacer" />
      <RoleMenu />
      {hasTier(sim.tier, "CARE+") && (
        <Link href="/alerts" className="tb-btn" title="Open alerts">
          🔔 {t(sim.lang, "Alerts")} {open > 0 && <span className="count">{open}</span>}
        </Link>
      )}
      <ScenarioMenu />
      <button className="tb-btn" onClick={() => act((s) => (s.lang = s.lang === "EN" ? "KO" : "EN"))} title={t(sim.lang, "Language")}>
        {sim.lang === "EN" ? "EN" : "KO"}
      </button>
      <button className="tb-btn primary" onClick={() => ui.openCopilot()}>
        ✦ {t(sim.lang, "Copilot")}
      </button>
    </header>
  );
}

function Nav() {
  const sim = useSim();
  const path = usePathname();
  return (
    <nav className="nav">
      {NAV.map((n) => {
        const on = n.href === "/" ? path === "/" : path.startsWith(n.href.split("/").slice(0, 2).join("/"));
        return (
          <Link key={n.href} href={n.href} className={on ? "on" : ""}>
            {t(sim.lang, n.label)}
            {n.need && !hasTier(sim.tier, n.need) && <span className="lock">🔒</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function ScenarioBanner() {
  const sim = useSim();
  const sc = sim.scenario;
  if (!sc) return null;
  const pct = ((sc.total - sc.ticksLeft) / sc.total) * 100;
  return (
    <div className="banner">
      <b>
        ▶ {sc.id} {sc.label}
      </b>
      <span>
        on <Link href={`/station/${sc.stationId}`} className="link">{sc.stationId}</Link> · time-lapse {sc.lapse}
      </span>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="muted small">{sc.ticksLeft} s left</span>
    </div>
  );
}

function Toast() {
  const toast = useUI((s) => s.toast);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}

export function Shell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startTicker();
    setReady(true);
  }, []);
  if (!ready)
    return (
      <div className="loading">
        <div style={{ textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/axcare-logo.webp" alt="AX CARE" style={{ width: 320, maxWidth: "80vw" }} />
          <div>Loading · generating 50,000 sample welds…</div>
        </div>
      </div>
    );
  return <Inner>{children}</Inner>;
}

function Inner({ children }: { children: ReactNode }) {
  const sim = useSim();
  return (
    <>
      <TopBar />
      <Nav />
      <ScenarioBanner />
      <main style={{ minHeight: "calc(100vh - 140px)" }}>{children}</main>
      <footer className="footer">
        <b>🔒 {t(sim.lang, "Runs on-premise · data never leaves the plant")}</b>
        <span>{t(sim.lang, "Sample data")} – simulated signals, prototype thresholds (not AXBIS or customer limits)</span>
        <span className="spacer" />
        <span className="mono">{new Date(sim.now).toLocaleString("en-GB", { timeZone: "Asia/Seoul" })} KST</span>
      </footer>
      <Copilot />
      <Toast />
    </>
  );
}
