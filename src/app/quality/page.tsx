"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { t } from "@/lib/i18n";
import { SITE } from "@/lib/config";
import { effectiveVerdict, fmtDateTime, fmtTime, fmtTimeS, reinspect, searchWelds, worstVerdict } from "@/lib/sim";
import { act, useSim } from "@/lib/store";
import { download, useUI } from "@/lib/ui";
import type { Sim, Weld } from "@/lib/types";
import { Card, Gate, StationLink, Tip, VerdictBadge } from "@/components/ui";

const CSV_HEAD = "weldId,moduleId,cellId,stationId,ts,recipe,depthMm,gapMm,plasma,backRefl,score,verdict,cause,reinspected";

function toCsv(welds: Weld[]) {
  return [CSV_HEAD, ...welds.map((w) => [w.weldId, w.moduleId, w.cellId, w.stationId, new Date(w.ts).toISOString(), w.recipe, w.depthMm, w.gapMm, w.plasma, w.backRefl, w.score, w.verdict, w.cause ?? "", w.reinspected ?? ""].join(","))].join("\n");
}
function toJson(moduleId: string, welds: Weld[]) {
  return JSON.stringify(
    {
      moduleId,
      site: SITE.name,
      exported: new Date().toISOString(),
      worstVerdict: worstVerdict(welds),
      welds: welds.map((w) => ({ weldId: w.weldId, moduleId: w.moduleId, cellId: w.cellId, stationId: w.stationId, ts: new Date(w.ts).toISOString(), recipe: w.recipe, depthMm: w.depthMm, gapMm: w.gapMm, plasma: w.plasma, backRefl: w.backRefl, score: w.score, verdict: effectiveVerdict(w) })),
    },
    null,
    2,
  );
}

function certificate(sim: Sim, moduleId: string, welds: Weld[]) {
  const ok = welds.filter((w) => effectiveVerdict(w) === "OK").length;
  const check = welds.filter((w) => effectiveVerdict(w) === "CHECK").length;
  const ng = welds.filter((w) => effectiveVerdict(w) === "NG").length;
  const rows = welds
    .map((w) => `<tr><td>${w.weldId}</td><td>${w.cellId}</td><td>${w.stationId}</td><td>${fmtTimeS(w.ts)}</td><td>${w.depthMm.toFixed(3)}</td><td>${w.gapMm.toFixed(3)}</td><td>${w.score}</td><td><b>${effectiveVerdict(w)}</b>${w.reinspected ? " (re-inspected)" : ""}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Weld quality certificate ${moduleId}</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;color:#0b1212;margin:32px}h1{font-size:22px;margin:0}table{border-collapse:collapse;width:100%;font-size:11px;margin-top:14px}td,th{border:1px solid #ccd;padding:3px 6px;text-align:left}th{background:#f3f5f8}.bar{background:#2b3e56;color:#fff;padding:10px 14px;border-radius:6px;display:flex;justify-content:space-between}.sig{margin-top:40px;display:flex;gap:60px}.sig div{border-top:1px solid #000;width:240px;padding-top:4px;font-size:12px}.small{font-size:11px;color:#556}</style></head>
<body><img src="${window.location.origin}/axcare-logo.webp" alt="AX CARE" style="height:60px;margin:-10px 0 6px -24px"/><div class="bar"><b>Weld quality certificate</b><span>${SITE.name}</span></div>
<h1 style="margin-top:16px">${moduleId}</h1>
<p>Number of welds: <b>${welds.length}</b> · OK ${ok} · CHECK ${check} · NG ${ng} · Worst verdict: <b>${worstVerdict(welds)}</b><br/>
Welded ${fmtDateTime(welds[0]?.ts ?? sim.now)} – ${fmtTime(welds[welds.length - 1]?.ts ?? sim.now)} · recipes ${[...new Set(welds.map((w) => w.recipe))].join(", ")}<br/>
Score: start 100, minus penalties for depth outside 1.15–1.30 mm, gap, plasma band, back-reflection and PGM &gt; 70%. OK ≥ 85, CHECK 70–84, NG &lt; 70.</p>
<table><thead><tr><th>Weld</th><th>Cell</th><th>Station</th><th>Time</th><th>Depth mm</th><th>Gap mm</th><th>Score</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sig"><div>Quality engineer (name, signature, date)</div><div>Customer acceptance</div></div>
<p class="small">Generated on the plant server · data never leaves the plant · SAMPLE DATA (prototype)</p>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

function ModuleView({ moduleId, welds, highlight }: { moduleId: string; welds: Weld[]; highlight?: string }) {
  const sim = useSim();
  const ui = useUI();
  const [sel, setSel] = useState<string | null>(highlight ?? null);
  const sorted = [...welds].sort((a, b) => a.weldId.localeCompare(b.weldId));
  const worst = worstVerdict(welds);
  const mod = sim.modules.get(moduleId);
  const complete = welds.length >= 36;
  return (
    <Card
      title={
        <div className="row">
          <h2>{moduleId}</h2>
          <VerdictBadge v={worst} />
          <span className="small muted">
            {mod?.batch} · {welds.length} / 36 welds{complete ? "" : " (in production)"} · {welds.filter((w) => effectiveVerdict(w) === "OK").length} OK
          </span>
        </div>
      }
      right={
        <div className="row">
          <button
            className="btn btn-sm"
            onClick={() => {
              download(`${moduleId}.csv`, toCsv(sorted), "text/csv");
              act((s) => (s.modules.get(moduleId)!.exported = "CSV"));
              ui.showToast(`${moduleId}.csv exported for the MES`);
            }}
          >
            ⬇ CSV
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              download(`${moduleId}.json`, toJson(moduleId, sorted), "application/json");
              act((s) => (s.modules.get(moduleId)!.exported = "JSON"));
              ui.showToast(`${moduleId}.json exported for the MES`);
            }}
          >
            ⬇ JSON
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => certificate(sim, moduleId, sorted)}>
            🖨 PDF certificate
          </button>
        </div>
      }
    >
      <div className="wgrid">
        {sorted.map((w) => (
          <Tip key={w.weldId} text={`${w.weldId} · ${w.cellId} · ${w.stationId}\nDepth ${w.depthMm.toFixed(3)} mm · gap ${w.gapMm.toFixed(3)} mm\nPlasma ${w.plasma.toFixed(2)} · score ${w.score} · ${effectiveVerdict(w)}`}>
            <div className={`wsq ${effectiveVerdict(w)}`} style={{ outline: sel === w.weldId ? "2px solid var(--ink)" : undefined }} onClick={() => setSel(w.weldId)}>
              {w.weldId.slice(-2)}
            </div>
          </Tip>
        ))}
      </div>
      <div className="table-wrap" style={{ marginTop: 10, maxHeight: 340 }}>
        <table className="t">
          <thead>
            <tr>
              <th>Weld</th>
              <th>Cell</th>
              <th>Station</th>
              <th>Depth mm</th>
              <th>Gap mm</th>
              <th>Plasma</th>
              <th>Score</th>
              <th>Verdict</th>
              <th>Recipe</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((w) => (
              <tr key={w.weldId} className={sel === w.weldId ? "sel" : ""} onClick={() => setSel(w.weldId)}>
                <td className="mono">{w.weldId}</td>
                <td className="mono">{w.cellId}</td>
                <td>
                  <StationLink id={w.stationId} />
                </td>
                <td style={{ color: w.depthMm < 1.15 || w.depthMm > 1.3 ? "var(--red)" : undefined }}>{w.depthMm.toFixed(3)}</td>
                <td style={{ color: w.gapMm > 0.05 ? "var(--red)" : undefined }}>{w.gapMm.toFixed(3)}</td>
                <td>{w.plasma.toFixed(2)}</td>
                <td>{w.score}</td>
                <td>
                  <VerdictBadge v={effectiveVerdict(w)} /> {w.reinspected && <span className="tiny muted">re-inspected</span>} {w.cause && <span className="tiny muted">{w.cause}</span>}
                </td>
                <td className="small">{w.recipe}</td>
                <td className="mono small">{fmtTimeS(w.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Charts() {
  const sim = useSim();
  const v = Math.floor(sim.tickN / 10); // charts refresh every 10 s
  const depth = useMemo(
    () => sim.depthBins.map((n, i) => ({ mm: +(0.9 + i * 0.02 + 0.01).toFixed(2), n })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v],
  );
  const hours = useMemo(() => {
    const arr = [...sim.hours.values()].sort((a, b) => a.hour - b.hour);
    const means = arr.map((h) => h.sum / h.n);
    const mu = means.reduce((s, x) => s + x, 0) / Math.max(1, means.length);
    const sd = Math.sqrt(means.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, means.length - 1)) || 0.1;
    return { rows: arr.map((h) => ({ hour: fmtTime(h.hour), mean: +(h.sum / h.n).toFixed(2) })), mu, ucl: mu + 3 * sd, lcl: mu - 3 * sd };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  const pareto = useMemo(() => {
    const rows = Object.entries(sim.causes)
      .map(([cause, c]) => ({ cause, check: c.check, ng: c.ng, total: c.check + c.ng }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <div className="grid g3 mt">
      <Card title="Depth distribution today">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={depth} margin={{ left: -10, right: 6, top: 6 }}>
            <CartesianGrid vertical={false} stroke="#eef1f4" />
            <XAxis dataKey="mm" tick={{ fontSize: 10 }} interval={4} />
            <YAxis tick={{ fontSize: 10 }} scale="sqrt" />
            <ReferenceArea x1={1.17} x2={1.29} fill="#2e8b57" fillOpacity={0.08} />
            <Tooltip formatter={(n: number) => [n, "welds"]} labelFormatter={(l) => `${l} mm`} />
            <Bar dataKey="n" isAnimationActive={false}>
              {depth.map((d, i) => (
                <Cell key={i} fill={d.mm < 1.15 || d.mm > 1.3 ? "var(--red-2)" : "var(--navy)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="tiny muted">Target band 1.15–1.30 mm shaded · √ scale</div>
      </Card>
      <Card title="Score trend by hour (control chart)">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={hours.rows} margin={{ left: -10, right: 6, top: 6 }}>
            <CartesianGrid vertical={false} stroke="#eef1f4" />
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
            <YAxis domain={[Math.floor(hours.lcl - 1), Math.ceil(hours.ucl + 1)]} tick={{ fontSize: 10 }} />
            <ReferenceLine y={hours.mu} stroke="var(--navy)" label={{ value: "mean", fontSize: 10, position: "insideTopRight" }} />
            <ReferenceLine y={hours.ucl} stroke="var(--red)" strokeDasharray="4 3" label={{ value: "+3σ", fontSize: 10, position: "insideTopRight" }} />
            <ReferenceLine y={hours.lcl} stroke="var(--red)" strokeDasharray="4 3" label={{ value: "−3σ", fontSize: 10, position: "insideBottomRight" }} />
            <Tooltip />
            <Line dataKey="mean" stroke="var(--blue)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="tiny muted">Mean weld score per hour; limits from the spread of hourly means</div>
      </Card>
      <Card title="Pareto of CHECK and NG causes">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={pareto} margin={{ left: -10, right: 6, top: 6 }}>
            <CartesianGrid vertical={false} stroke="#eef1f4" />
            <XAxis dataKey="cause" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="check" stackId="a" fill="#f0b429" name="CHECK" isAnimationActive={false} />
            <Bar dataKey="ng" stackId="a" fill="var(--red-2)" name="NG" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function ReinspectQueue() {
  const sim = useSim();
  const [stationF, setStationF] = useState("all");
  const q = sim.checkQueue.filter((w) => stationF === "all" || w.stationId === stationF);
  const rows = q.slice(-60).reverse();
  return (
    <Card
      title={`${t(sim.lang, "Re-inspection queue")} · ${sim.checkQueue.length} CHECK welds`}
      right={
        <select className="input" value={stationF} onChange={(e) => setStationF(e.target.value)}>
          <option value="all">All stations</option>
          {sim.stations.map((s) => (
            <option key={s.id}>{s.id}</option>
          ))}
        </select>
      }
    >
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="t">
          <thead>
            <tr>
              <th>Weld</th>
              <th>Module</th>
              <th>Station</th>
              <th>Cause</th>
              <th>Score</th>
              <th>Time</th>
              <th>Re-inspected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.weldId}>
                <td className="mono">{w.weldId}</td>
                <td className="mono small">{w.moduleId}</td>
                <td>{w.stationId}</td>
                <td className="small">{w.cause}</td>
                <td>{w.score}</td>
                <td className="mono small">{fmtTime(w.ts)}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => act((s) => reinspect(s, w, "OK"))}>
                      OK
                    </button>
                    <button className="btn btn-sm btn-red" onClick={() => act((s) => reinspect(s, w, "NG"))}>
                      NG
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="empty">
                  Queue is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {q.length > 60 && <div className="tiny muted">Showing the 60 most recent of {q.length}.</div>}
    </Card>
  );
}

export default function QualityPage() {
  const sim = useSim();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("MOD-2611-0482");
  const { res, ms } = useMemo(() => {
    const t0 = performance.now();
    const r = searchWelds(sim, submitted);
    return { res: r, ms: performance.now() - t0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, sim.tickN]);
  const recentMods = [...sim.modules.values()].slice(-400).filter((m) => worstVerdict(m.welds) !== "OK").slice(-6).reverse();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t(sim.lang, "Quality")} & traceability</h1>
          <div className="sub">
            {sim.welds.length.toLocaleString("en-US")} weld records on the plant server · every weld scored 0–100 (OK ≥ 85 · CHECK 70–84 · NG &lt; 70)
          </div>
        </div>
      </div>
      <Gate need="QUALITY+" title="per-weld quality records">
        <Card>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(q || submitted);
            }}
          >
            <input className="input search" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t(sim.lang, "Search module, cell or weld ID")} – e.g. MOD-2611-0482, C-0482-09, W-0482-17`} />
            <button className="btn btn-primary" style={{ padding: "10px 18px" }}>
              Search
            </button>
          </form>
          <div className="row small muted" style={{ marginTop: 8 }}>
            {res.kind !== "none" ? (
              <span>
                Found {res.kind} <b className="mono">{submitted.toUpperCase()}</b> · {res.welds.length} weld{res.welds.length > 1 ? "s" : ""} in {ms < 1 ? "< 1" : ms.toFixed(1)} ms across {sim.welds.length.toLocaleString("en-US")} welds
              </span>
            ) : (
              <span>No match for “{submitted}”.</span>
            )}
            <span className="spacer" />
            <span>Recent modules with CHECK/NG:</span>
            {recentMods.map((m) => (
              <button key={m.moduleId} className="chip mono" onClick={() => { setQ(m.moduleId); setSubmitted(m.moduleId); }}>
                {m.moduleId} <VerdictBadge v={worstVerdict(m.welds)} />
              </button>
            ))}
          </div>
        </Card>
        {res.moduleId && (
          <div className="mt">
            <ModuleView key={res.moduleId} moduleId={res.moduleId} welds={sim.modules.get(res.moduleId)!.welds} highlight={res.kind === "weld" ? res.welds[0].weldId : undefined} />
          </div>
        )}
        <Charts />
        <div className="mt">
          <ReinspectQueue />
        </div>
      </Gate>
    </div>
  );
}
