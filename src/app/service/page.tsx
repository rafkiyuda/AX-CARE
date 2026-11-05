"use client";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { DAY, H, closeWorkOrder, fmtDateTime, fmtTime, orderText, pad, partName } from "@/lib/sim";
import { act, useSim } from "@/lib/store";
import { useUI } from "@/lib/ui";
import type { PartKind, WorkOrder } from "@/lib/types";
import { Card, Gate, Kpi, Progress, StationLink } from "@/components/ui";

function Calendar() {
  const sim = useSim();
  const first = Date.parse("2026-11-01T00:00:00+09:00");
  const startDow = (new Date(first + 9 * H).getUTCDay() + 6) % 7; // Monday first
  const cells: { day: number | null; t: number }[] = [];
  for (let i = 0; i < startDow; i++) cells.push({ day: null, t: 0 });
  for (let d = 1; d <= 30; d++) cells.push({ day: d, t: first + (d - 1) * DAY });
  while (cells.length % 7) cells.push({ day: null, t: 0 });
  const todayN = new Date(sim.now + 9 * H).getUTCDate();
  return (
    <div className="cal">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div key={d} className="dow">
          {d}
        </div>
      ))}
      {cells.map((c, i) => {
        const evs = c.day ? sim.calendar.filter((e) => e.t >= c.t && e.t < c.t + DAY).sort((a, b) => a.t - b.t) : [];
        return (
          <div key={i} className={`day ${c.day ? "" : "out"} ${c.day === todayN ? "today" : ""}`}>
            <div style={{ fontWeight: 650 }}>{c.day ?? ""}</div>
            {evs.map((e) => (
              <div key={e.id} className={`ev ${e.kind} ${e.done ? "done" : ""}`} title={`${fmtDateTime(e.t)} ${e.title}`}>
                {fmtTime(e.t)} {e.title}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function WorkOrderRow({ wo }: { wo: WorkOrder }) {
  const sim = useSim();
  const ui = useUI();
  const [open, setOpen] = useState(!wo.closed);
  const done = wo.checklist.filter((c) => c.done).length;
  return (
    <div className="card" style={{ padding: 10, boxShadow: "none" }}>
      <div className="row" style={{ cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span className="mono small">{wo.id}</span>
        <b style={{ flex: 1 }}>{wo.title}</b>
        <span className={`badge ${wo.closed ? "b-ok" : "b-check"}`}>{wo.closed ? `closed ${fmtTime(wo.closed)}` : `due ${fmtDateTime(wo.due)}`}</span>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="small muted">
            {wo.assignee} · created {fmtTime(wo.created)} {wo.alertId && <>· alert {wo.alertId}</>} · <StationLink id={wo.stationId} />
          </div>
          <div className="col" style={{ gap: 4, marginTop: 6 }}>
            {wo.checklist.map((c, i) => (
              <label key={i} className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={c.done} disabled={!!wo.closed} onChange={() => act((s) => (s.workOrders.find((w) => w.id === wo.id)!.checklist[i].done = !c.done))} />
                <span style={{ textDecoration: c.done ? "line-through" : undefined }}>{c.text}</span>
              </label>
            ))}
          </div>
          {!wo.closed && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="small muted">
                {done}/{wo.checklist.length} steps
              </span>
              <span className="spacer" />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  act((s) => closeWorkOrder(s, s.workOrders.find((w) => w.id === wo.id)!));
                  ui.showToast(`${wo.id} closed${wo.alertId ? ` · alert ${wo.alertId} resolved and logged` : ""}`);
                }}
              >
                ✓ Complete and close
              </button>
            </div>
          )}
        </div>
      )}
      {sim.tier === "RETROFIT" && <div className="tiny muted">Work orders need CARE.</div>}
    </div>
  );
}

export default function ServicePage() {
  const sim = useSim();
  const L = (s: string) => t(sim.lang, s);
  const [part, setPart] = useState<PartKind | "all">("all");
  const cons = sim.consumables.filter((c) => part === "all" || c.part === part).sort((a, b) => b.used - a.used);
  const visits = sim.calendar.filter((e) => e.kind === "visit");
  const openWo = sim.workOrders.filter((w) => !w.closed);
  const closedWo = sim.workOrders.filter((w) => w.closed);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{L("Service & parts")}</h1>
          <div className="sub">Consumables reorder automatically at {sim.thresholds.reorderPct}% used · AXBIS service team with 33 operations and service staff</div>
        </div>
      </div>
      <Gate need="CARE" title="the service contract">
        <div className="grid g4">
          <Kpi label="Visits used" value={`${3 + visits.filter((v) => v.done && v.t > Date.parse("2026-11-04T00:00:00+09:00")).length} / 6`} foot="Included per year" />
          <Kpi label="Remote sessions" value={sim.remoteSessions} foot="This contract year" />
          <Kpi label="Parts delivered" value={sim.ledger.reduce((s, m) => s + m.parts, 0)} foot={`This contract · ${sim.partsDelivered} today`} />
          <Kpi label="Response time met" value="100" unit="%" foot={`${sim.tier === "CARE" ? "Next business day" : "4 h remote / 24 h on-site"} · 12 of 12`} />
        </div>

        <div className="grid g-2-1 mt">
          <Card
            title={L("Consumables")}
            right={
              <div className="seg">
                {(["all", "window", "nozzle", "filter"] as const).map((p) => (
                  <button key={p} className={part === p ? "on" : ""} onClick={() => setPart(p)}>
                    {p === "all" ? "all" : partName(p)}
                  </button>
                ))}
              </div>
            }
          >
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Station</th>
                    <th>% used</th>
                    <th></th>
                    <th>Stock</th>
                    <th>Reorder point</th>
                    <th>Auto-order status</th>
                  </tr>
                </thead>
                <tbody>
                  {cons.map((c) => (
                    <tr key={c.id}>
                      <td>{partName(c.part)}</td>
                      <td>
                        <StationLink id={c.stationId} />
                      </td>
                      <td className="num">{Math.round(c.used)}%</td>
                      <td style={{ width: 110 }}>
                        <Progress pct={c.used} warn={70} crit={sim.thresholds.reorderPct} />
                      </td>
                      <td className="num">{sim.stock[c.part]}</td>
                      <td className="num">{sim.reorderPoint[c.part]}</td>
                      <td className="small">
                        {c.order.status === "ordered" ? (
                          <span className="badge b-info">
                            {orderText(c)} · {c.order.po}
                          </span>
                        ) : c.order.status === "delivered" ? (
                          <span className="badge b-ok">{orderText(c)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={`${L("Work orders")} · ${openWo.length} open`}>
            <div className="col" style={{ maxHeight: 520, overflow: "auto" }}>
              {[...openWo, ...closedWo].map((w) => (
                <WorkOrderRow key={w.id} wo={w} />
              ))}
              {!sim.workOrders.length && <div className="empty">No work orders yet. Create one from a station or an alert.</div>}
            </div>
          </Card>
        </div>

        <Card
          className="mt"
          title={`${L("Maintenance calendar")} · November 2026`}
          right={
            <div className="row tiny">
              <span className="ev visit">visit</span>
              <span className="ev remote">remote</span>
              <span className="ev workorder">work order</span>
              <span className="ev doe">DOE (L.A.C.)</span>
            </div>
          }
        >
          <Calendar />
        </Card>

        <Card className="mt" title="Activity log">
          <div className="col" style={{ gap: 2, maxHeight: 220, overflow: "auto" }}>
            {sim.log.map((l, i) => (
              <div key={i} className="small">
                <span className="mono muted">
                  {pad(new Date(l.t + 9 * H).getUTCHours(), 2)}:{pad(new Date(l.t + 9 * H).getUTCMinutes(), 2)}:{pad(new Date(l.t + 9 * H).getUTCSeconds(), 2)}
                </span>{" "}
                {l.text}
              </div>
            ))}
            {!sim.log.length && <div className="muted small">Nothing yet.</div>}
          </div>
        </Card>
      </Gate>
    </div>
  );
}
