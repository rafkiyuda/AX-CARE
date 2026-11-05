"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { explainAlert, type AIResult } from "@/lib/ai";
import { PEOPLE } from "@/lib/config";
import { t } from "@/lib/i18n";
import { H, acknowledge, assign, avoidedFor, createWorkOrder, fmtDateTime, fmtTime, histGlobal, resolveAlert } from "@/lib/sim";
import { act, getSim, useSim } from "@/lib/store";
import { useUI } from "@/lib/ui";
import type { Alert, ExplainResult, Severity } from "@/lib/types";
import { SignalChart } from "@/components/charts";
import { ExplainView } from "@/components/ExplainView";
import { Card, Drawer, Gate, SevBadge, StationLink } from "@/components/ui";

const SIGNAL_META: Record<string, { label: string; unit: string; domain: [number, number]; dec: number }> = {
  power: { label: "Laser power", unit: "%", domain: [94, 102], dec: 1 },
  pgm: { label: "PGM", unit: "%", domain: [0, 100], dec: 1 },
  depth: { label: "OCT depth", unit: "mm", domain: [0.95, 1.4], dec: 3 },
  gap: { label: "Gap", unit: "mm", domain: [0, 0.25], dec: 3 },
  plasma: { label: "Plasma", unit: "", domain: [0.3, 0.75], dec: 2 },
  backRefl: { label: "Back-reflection", unit: "", domain: [0, 0.5], dec: 2 },
  optTemp: { label: "Optics temperature", unit: "°C", domain: [26, 44], dec: 1 },
  chillerTemp: { label: "Chiller outlet", unit: "°C", domain: [20, 30], dec: 1 },
};

function AlertDrawer({ a, onClose }: { a: Alert; onClose: () => void }) {
  const sim = useSim();
  const ui = useUI();
  const [ex, setEx] = useState<AIResult<ExplainResult> | null>(null);
  const [busy, setBusy] = useState(false);
  const st = sim.stations.find((s) => s.id === a.stationId)!;
  const meta = SIGNAL_META[a.signal];
  const th = sim.thresholds;
  const hist = histGlobal(st, sim).filter((p) => p.t >= sim.now - 12 * H);
  const data = [...hist, ...st.samples.filter((_, i) => i % 30 === 0), st.current] as unknown as { t: number; [k: string]: number }[];
  const bands =
    a.signal === "pgm"
      ? [{ from: th.pgmWarn, to: th.pgmCrit, kind: "warn" as const }, { from: th.pgmCrit, to: 100, kind: "crit" as const }]
      : a.signal === "power"
        ? [{ from: th.powerCrit, to: th.powerWarn, kind: "warn" as const }, { from: 90, to: th.powerCrit, kind: "crit" as const }]
        : a.signal === "chillerTemp"
          ? [{ from: th.chillWarn, to: th.chillCrit, kind: "warn" as const }, { from: th.chillCrit, to: 40, kind: "crit" as const }]
          : a.signal === "optTemp"
            ? [{ from: th.optWarn, to: th.optCrit, kind: "warn" as const }, { from: th.optCrit, to: 50, kind: "crit" as const }]
            : a.signal === "depth"
              ? [{ from: th.depthCritLow, to: th.depthWarnLow, kind: "warn" as const }, { from: 0.8, to: th.depthCritLow, kind: "crit" as const }]
              : [];
  const av = avoidedFor(a.type);
  const ai = ex ?? (a.ai ? { data: a.ai, source: a.ai.source, model: a.ai.model, context: { note: "cached explanation" } } : null);

  return (
    <Drawer
      onClose={onClose}
      width={620}
      title={
        <div>
          <div className="row" style={{ gap: 8 }}>
            <SevBadge s={a.severity} />
            <span className="mono small muted">{a.id}</span>
            <span className={`badge ${a.status === "resolved" ? "b-ok" : a.status === "acknowledged" ? "b-info" : "b-grey"}`}>{a.status}</span>
          </div>
          <h2 style={{ marginTop: 4 }}>
            {a.title} · {a.stationId}
          </h2>
        </div>
      }
      footer={
        <div className="row">
          <button className="btn" disabled={a.status !== "open"} onClick={() => act((s) => acknowledge(s, s.alerts.find((x) => x.id === a.id)!))}>
            {t(sim.lang, "Acknowledge")}
          </button>
          <select className="input" value={a.assignee ?? ""} disabled={a.status === "resolved"} onChange={(e) => act((s) => assign(s, s.alerts.find((x) => x.id === a.id)!, e.target.value))}>
            <option value="" disabled>
              {t(sim.lang, "Assign")}…
            </option>
            {Object.values(PEOPLE).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button
            className="btn"
            disabled={a.status === "resolved" || !!a.workOrderId}
            onClick={() => {
              const wo = act((s) => createWorkOrder(s, a.stationId, s.alerts.find((x) => x.id === a.id)));
              ui.showToast(`${wo.id} created`);
            }}
          >
            🛠 {a.workOrderId ? a.workOrderId : t(sim.lang, "Create work order")}
          </button>
          <span className="spacer" />
          <button
            className="btn btn-primary"
            disabled={a.status === "resolved"}
            onClick={() => {
              act((s) => resolveAlert(s, s.alerts.find((x) => x.id === a.id)!));
              ui.showToast(`Resolved · ${av.h} h downtime avoided written to the value ledger`);
            }}
          >
            ✓ {t(sim.lang, "Resolve")}
          </button>
        </div>
      }
    >
      <div className="grid g2" style={{ gap: 10 }}>
        <div>
          <div className="tiny muted">Rule triggered</div>
          <div className="mono small">{a.rule}</div>
        </div>
        <div>
          <div className="tiny muted">Value now</div>
          <b className="num">{a.value}</b>
        </div>
        <div>
          <div className="tiny muted">{t(sim.lang, "Detected")}</div>
          {fmtDateTime(a.detected)}
        </div>
        <div>
          <div className="tiny muted">{t(sim.lang, "Predicted failure")}</div>
          {a.predictedFailure ? fmtDateTime(a.predictedFailure) : "—"}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="tiny muted">{t(sim.lang, "Remaining life")}</div>
          {a.remainingLife ?? "—"}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12, padding: 10 }}>
        <SignalChart data={data} dataKey={a.signal} label={`${meta.label} around the event (12 h)`} unit={meta.unit} domain={meta.domain} bands={bands} decimals={meta.dec} long height={150} />
      </div>

      <h3 style={{ marginTop: 14 }}>Recommended action</h3>
      <p style={{ margin: "4px 0" }}>{a.action}</p>
      <h3 style={{ marginTop: 12 }}>Auto-actions taken</h3>
      {a.autoActions.length ? (
        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
          {a.autoActions.map((x, i) => (
            <li key={i}>⚡ {x}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small" style={{ margin: "4px 0" }}>
          None for this alert type{sim.tier === "RETROFIT" ? " (auto-reorder needs CARE)" : ""}.
        </p>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <h3 style={{ flex: 1 }}>AI explanation</h3>
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await explainAlert(getSim(), a);
            act((s) => {
              const x = s.alerts.find((y) => y.id === a.id);
              if (x) x.ai = r.data;
            });
            setEx(r);
            setBusy(false);
          }}
        >
          ✦ {busy ? "Explaining…" : ai ? "Explain again" : "Explain this alert"}
        </button>
      </div>
      {ai && (
        <div style={{ marginTop: 8 }}>
          <ExplainView res={ai} />
        </div>
      )}

      <h3 style={{ marginTop: 14, marginBottom: 6 }}>Timeline</h3>
      <ul className="timeline">
        {a.timeline.map((e, i) => (
          <li key={i}>
            <span className="mono muted">{fmtTime(e.t)}</span> {e.label}
          </li>
        ))}
      </ul>
      <p className="tiny muted">
        Resolving writes to the value ledger: {av.h} h downtime avoided and {av.ng} NG welds avoided (estimate for this alert type).
      </p>
    </Drawer>
  );
}

function AlertsInner() {
  const sim = useSim();
  const params = useSearchParams();
  const [sev, setSev] = useState<Severity | "all">("all");
  const [station, setStation] = useState("all");
  const [status, setStatus] = useState<"active" | "all" | "resolved">("active");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const id = params.get("id");
    if (id) setSel(id);
  }, [params]);
  const L = (s: string) => t(sim.lang, s);
  const rows = sim.alerts.filter(
    (a) =>
      (sev === "all" || a.severity === sev) &&
      (station === "all" || a.stationId === station) &&
      (status === "all" || (status === "active" ? a.status !== "resolved" : a.status === "resolved")),
  );
  const selected = sim.alerts.find((a) => a.id === sel);
  const counts = { critical: 0, warning: 0, info: 0 };
  sim.alerts.filter((a) => a.status !== "resolved").forEach((a) => counts[a.severity]++);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{L("Alerts")}</h1>
          <div className="sub">
            Rules + statistics run on the plant server · {counts.critical} critical · {counts.warning} warning · {counts.info} info open
          </div>
        </div>
      </div>
      <Gate need="CARE+" title="predictive alerts">
        <Card
          title={
            <div className="row">
              <div className="seg">
                {(["active", "all", "resolved"] as const).map((s) => (
                  <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="seg">
                {(["all", "critical", "warning", "info"] as const).map((s) => (
                  <button key={s} className={sev === s ? "on" : ""} onClick={() => setSev(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <select className="input" value={station} onChange={(e) => setStation(e.target.value)}>
                <option value="all">All stations</option>
                {sim.stations.map((s) => (
                  <option key={s.id}>{s.id}</option>
                ))}
              </select>
            </div>
          }
        >
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>{L("Severity")}</th>
                  <th>{L("Station")}</th>
                  <th>Alert type</th>
                  <th>Value</th>
                  <th>{L("Detected")}</th>
                  <th>{L("Predicted failure")}</th>
                  <th>{L("Remaining life")}</th>
                  <th>{L("Status")}</th>
                  <th>{L("Assignee")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={`click ${sel === a.id ? "sel" : ""}`} onClick={() => setSel(a.id)}>
                    <td>
                      <SevBadge s={a.severity} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <StationLink id={a.stationId} />
                    </td>
                    <td>
                      <b>{a.title}</b>
                      <div className="tiny muted mono">{a.rule}</div>
                    </td>
                    <td className="num">{a.value}</td>
                    <td>{fmtTime(a.detected)}</td>
                    <td>{a.predictedFailure ? fmtDateTime(a.predictedFailure) : "—"}</td>
                    <td className="small">{a.remainingLife ?? "—"}</td>
                    <td>
                      <span className={`badge ${a.status === "resolved" ? "b-ok" : a.status === "acknowledged" ? "b-info" : "b-grey"}`}>{a.status}</span>
                    </td>
                    <td className="small">{a.assignee ?? "—"}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={9} className="empty">
                      No alerts match. Run a scenario (▶ Scenario in the top bar) to see predictive alerts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </Gate>
      {selected && <AlertDrawer a={selected} onClose={() => setSel(null)} />}
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense>
      <AlertsInner />
    </Suspense>
  );
}
