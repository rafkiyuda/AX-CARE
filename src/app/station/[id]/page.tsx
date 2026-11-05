"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { explainAlert, type AIResult } from "@/lib/ai";
import { hasTier } from "@/lib/config";
import { t } from "@/lib/i18n";
import { DAY, H, createWorkOrder, fmtTime, histGlobal, orderText, partName, requestDoe, rulText } from "@/lib/sim";
import { act, getSim, useSim } from "@/lib/store";
import { useUI } from "@/lib/ui";
import type { ExplainResult, Station } from "@/lib/types";
import { ForecastChart, SignalChart } from "@/components/charts";
import { ExplainView } from "@/components/ExplainView";
import { Card, MiniLock, Progress, StatusBadge, Tip } from "@/components/ui";

function RulCards({ st }: { st: Station }) {
  const sim = useSim();
  const hist = histGlobal(st, sim);
  const now = sim.now;
  const th = sim.thresholds;
  // window
  const w = st.rulWindow;
  const wHist = hist.filter((p) => p.t >= now - 6 * H).map((p) => ({ t: p.t, v: p.pgm }));
  wHist.push({ t: now, v: st.current.pgm });
  const wf: { t: number; f: number; lo: number; hi: number }[] = [];
  if (w && !w.infinite) {
    const end = Math.min(w.value, 24);
    for (let i = 0; i <= 12; i++) {
      const h = (end * i) / 12;
      const f = w.value <= 24 ? th.pgmCrit - w.slope * (w.value - h) : w.a + w.slope * h;
      const e = 2 * w.sd + Math.abs(w.slope) * h * 0.12;
      wf.push({ t: now + h * H, f, lo: f - e, hi: f + e });
    }
  }
  // laser
  const l = st.rulLaser;
  const lHist = hist.filter((_, i) => i % 3 === 0).map((p) => ({ t: p.t, v: p.power }));
  lHist.push({ t: now, v: st.current.power });
  const lf: { t: number; f: number; lo: number; hi: number }[] = [];
  if (l && !l.infinite) {
    const end = Math.min(l.value, 30);
    for (let i = 0; i <= 12; i++) {
      const d = (end * i) / 12;
      const f = l.value <= 30 ? th.powerCrit - l.slope * (l.value - d) : l.a + l.slope * d;
      const e = 2 * l.sd + Math.abs(l.slope) * d * 0.15;
      lf.push({ t: now + d * DAY, f, lo: f - e, hi: f + e });
    }
  }
  return (
    <>
      <Card
        title={`${t(sim.lang, "Remaining life")} · ${t(sim.lang, "Protective window")}`}
        right={<Tip text={"Least-squares fit on the last 6 h of PGM\nhours left = (85% − now) / slope\n± from residual standard deviation"}><span className="formula small">how</span></Tip>}
      >
        <div style={{ fontSize: 20, fontWeight: 700 }}>Window life left: {rulText(w, "h")}</div>
        <div className="small muted">
          PGM {st.current.pgm.toFixed(1)}% · slope {w ? w.slope.toFixed(2) : "–"} %/h · limit {th.pgmCrit}%
        </div>
        <ForecastChart hist={wHist} forecast={wf} limit={th.pgmCrit} unit="%" domain={[0, 100]} />
      </Card>
      <Card
        title={`${t(sim.lang, "Remaining life")} · ${t(sim.lang, "Laser source")}`}
        right={<Tip text={"Least-squares fit on the last 7 days of laser power\ndays left = (now − 96%) / −slope"}><span className="formula small">how</span></Tip>}
      >
        <div style={{ fontSize: 20, fontWeight: 700 }}>To 96% power: {rulText(l, "d")}</div>
        <div className="small muted">
          Power {st.current.power.toFixed(2)}% · slope {st.powerSlopeDay.toFixed(2)} %/day · warning below {th.powerSlopeWarn} %/day
        </div>
        <ForecastChart hist={lHist} forecast={lf} limit={th.powerCrit} unit="%" domain={[94, 102]} long />
      </Card>
    </>
  );
}

export default function StationPage() {
  const sim = useSim();
  const ui = useUI();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [mode, setMode] = useState<"live" | "hist">("live");
  const [explain, setExplain] = useState<AIResult<ExplainResult> | null>(null);
  const [busy, setBusy] = useState(false);
  const st = sim.stations.find((s) => s.id === params.id);
  if (!st) return <div className="page empty">Unknown station {params.id}</div>;
  const L = (s: string) => t(sim.lang, s);
  const th = sim.thresholds;
  const care = hasTier(sim.tier, "CARE");
  const carePlus = hasTier(sim.tier, "CARE+");
  const quality = hasTier(sim.tier, "QUALITY+");
  const live = st.samples.filter((_, i) => i % 2 === 0);
  const data = (mode === "live" ? live : histGlobal(st, sim)) as unknown as { t: number; [k: string]: number }[];
  const long = mode === "hist";
  const openAlert = sim.alerts.find((a) => a.stationId === st.id && a.status !== "resolved");
  const trend = st.anomalyTrend > 2 ? "▲" : st.anomalyTrend < -2 ? "▼" : "▶";
  const cons = sim.consumables.filter((c) => c.stationId === st.id);

  async function onExplain() {
    if (!openAlert) {
      ui.openCopilot(`Why is ${st!.id} behaving like this? Summarise its health.`);
      return;
    }
    setBusy(true);
    const r = await explainAlert(getSim(), openAlert);
    act((s) => {
      const a = s.alerts.find((x) => x.id === openAlert.id);
      if (a) a.ai = r.data;
    });
    setExplain(r);
    setBusy(false);
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {sim.stations.map((s) => (
          <Link key={s.id} href={`/station/${s.id}`} className={`btn btn-sm ${s.id === st.id ? "btn-primary" : ""}`}>
            <span className={`dot ${s.status}`} /> {s.id}
          </Link>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 18 }}>
          <div>
            <h1>{st.id}</h1>
            <div className="small muted">
              {st.laser} · {st.joint} joint · recipe <span className="mono">{st.recipe}</span>
            </div>
          </div>
          <StatusBadge s={st.status} />
          <div>
            <div className="tiny muted">{L("Anomaly score")}</div>
            {carePlus ? (
              <div style={{ fontSize: 24, fontWeight: 700 }} className="num">
                {Math.round(st.anomaly)} <span style={{ fontSize: 15, color: st.anomalyTrend > 2 ? "var(--red)" : "var(--ink-3)" }}>{trend}</span>
                <span className="small muted" style={{ fontWeight: 500 }}> driven by {st.driver}</span>
              </div>
            ) : (
              <span className="small muted">🔒 CARE+</span>
            )}
          </div>
          <div>
            <div className="tiny muted">{L("Health")}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }} className="num">
              {st.health}%
            </div>
          </div>
          <div>
            <div className="tiny muted">Laser-on hours since service</div>
            <div style={{ fontSize: 18, fontWeight: 650 }} className="num">
              {Math.round(st.laserHours).toLocaleString("en-US")} h
            </div>
          </div>
          <span className="spacer" />
          <div className="row">
            <button className="btn" disabled={!carePlus || busy} onClick={onExplain} title={carePlus ? "" : "CARE+"}>
              ✦ {busy ? "Explaining…" : L("Explain with AI")} {!carePlus && "🔒"}
            </button>
            <button
              className="btn btn-primary"
              disabled={!care}
              onClick={() => {
                const wo = act((s) => createWorkOrder(s, st.id));
                ui.showToast(`${wo.id} created – see Service & parts`);
              }}
            >
              🛠 {L("Create work order")} {!care && "🔒"}
            </button>
            <button
              className="btn"
              disabled={!quality}
              onClick={() => {
                const wo = act((s) => requestDoe(s, st.id));
                ui.showToast(`DOE re-tune requested from the AXBIS L.A.C. (${wo.id})`);
              }}
            >
              ⚗ {L("Request DOE re-tune")} {!quality && "🔒"}
            </button>
          </div>
        </div>
        {openAlert && carePlus && (
          <div className="row small" style={{ marginTop: 10, background: openAlert.severity === "critical" ? "var(--red-bg)" : "var(--amber-bg)", padding: "6px 10px", borderRadius: 7 }}>
            <b>{openAlert.title}</b> · {openAlert.rule} · now {openAlert.value}
            {openAlert.remainingLife && <> · {openAlert.remainingLife}</>}
            <span className="spacer" />
            <button className="link" onClick={() => router.push(`/alerts?id=${openAlert.id}`)}>
              Open alert →
            </button>
          </div>
        )}
        {explain && (
          <div style={{ marginTop: 12 }}>
            <ExplainView res={explain} />
          </div>
        )}
      </div>

      <div className="grid g-2-1">
        <Card
          title="Live signals"
          right={
            <div className="seg">
              <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>
                Last 10 min
              </button>
              <button className={mode === "hist" ? "on" : ""} onClick={() => setMode("hist")}>
                History 7 days
              </button>
            </div>
          }
        >
          <div className="col" style={{ gap: 4 }}>
            <SignalChart data={data} dataKey="power" label="Laser power (LPM)" unit="% of setpoint" domain={[94, 102]} decimals={1} long={long} target={100}
              bands={[{ from: th.powerCrit, to: th.powerWarn, kind: "warn" }, { from: 90, to: th.powerCrit, kind: "crit" }]} />
            <SignalChart data={data} dataKey="pgm" label="Protective window (PGM)" unit="% contamination" domain={[0, 100]} decimals={1} long={long}
              bands={[{ from: th.pgmWarn, to: th.pgmCrit, kind: "warn" }, { from: th.pgmCrit, to: 100, kind: "crit" }]} />
            <SignalChart data={data} dataKey="depth" label="Weld depth (OCT)" unit="mm · target 1.20" domain={[0.95, 1.4]} decimals={3} long={long} target={1.2}
              bands={[{ from: th.depthCritLow, to: th.depthWarnLow, kind: "warn" }, { from: th.depthWarnHigh, to: 1.5, kind: "warn" }, { from: 0.8, to: th.depthCritLow, kind: "crit" }]} />
            <SignalChart data={data} dataKey="plasma" label="Plasma intensity" unit="normalised" domain={[0.3, 0.75]} decimals={2} long={long}
              bands={[{ from: 0.2, to: th.plasmaLow, kind: "warn" }, { from: th.plasmaHigh, to: 0.9, kind: "warn" }]} />
            <SignalChart data={data} dataKey="optTemp" label="Optics temperature" unit="°C" domain={[26, 44]} decimals={1} long={long}
              bands={[{ from: th.optWarn, to: th.optCrit, kind: "warn" }, { from: th.optCrit, to: 50, kind: "crit" }]} />
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Shaded: amber = warning band, red = critical band. Chiller outlet now {st.current.chillerTemp.toFixed(1)} °C · back-reflection {st.current.backRefl.toFixed(2)} · gap{" "}
            {(st.recent[st.recent.length - 1]?.gapMm ?? 0).toFixed(3)} mm
          </div>
        </Card>

        <div className="col" style={{ gap: 14 }}>
          {carePlus ? <RulCards st={st} /> : <MiniLock need="CARE+" label="Remaining-life forecast for the protective window and laser source" />}
          <Card title={L("Last 20 welds")} right={<Link href="/quality" className="link small">Quality records →</Link>}>
            <div className="weld-strip">
              {st.recent.slice(-20).map((w) => (
                <Tip key={w.weldId} text={`${w.weldId} · ${w.moduleId}\nDepth ${w.depthMm.toFixed(3)} mm · gap ${w.gapMm.toFixed(3)} mm\nScore ${w.score} · ${w.verdict}${w.cause ? ` (${w.cause})` : ""}\n${fmtTime(w.ts)}`}>
                  <div className={`wsq ${w.verdict}`} />
                </Tip>
              ))}
            </div>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              Today: {st.today.n.toLocaleString("en-US")} welds · {st.today.check} CHECK · {st.today.ng} NG · module {st.recent[st.recent.length - 1]?.moduleId}
            </div>
          </Card>
          <Card title={L("Consumables")}>
            <table className="t">
              <tbody>
                {cons.map((c) => (
                  <tr key={c.id}>
                    <td>{partName(c.part)}</td>
                    <td style={{ width: 90 }}>
                      <Progress pct={c.used} warn={70} crit={th.reorderPct} />
                    </td>
                    <td className="num">{Math.round(c.used)}%</td>
                    <td className="small muted">{care ? orderText(c) : "🔒 CARE"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}
