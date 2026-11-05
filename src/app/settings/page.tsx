"use client";
import { useEffect, useState } from "react";
import { aiStatus } from "@/lib/ai";
import { DEFAULT_THRESHOLDS, THRESHOLD_ROWS, TIERS, TIER_INFO, hasTier, type Thresholds } from "@/lib/config";
import { t } from "@/lib/i18n";
import { act, resetSim, useSim } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { Card, MiniLock } from "@/components/ui";

export default function SettingsPage() {
  const sim = useSim();
  const ui = useUI();
  const [ai, setAi] = useState<{ configured: boolean; pro: string; flash: string } | null>(null);
  const [mes, setMes] = useState({ opc: true, rest: false, endpoint: "opc.tcp://axcare.plant-a.local:4840", rest_url: "https://mes.plant-a.local/api/v1/welds" });
  const [retention, setRetention] = useState("3y");
  useEffect(() => {
    aiStatus().then(setAi);
  }, []);
  const setTh = (k: keyof Thresholds, v: number) => act((s) => (s.thresholds = { ...s.thresholds, [k]: isFinite(v) ? v : s.thresholds[k] }));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t(sim.lang, "Settings")}</h1>
          <div className="sub">Plant server configuration · changes apply immediately to the rules engine</div>
        </div>
      </div>
      <div className="grid g2">
        <Card title="Licence tier">
          <div className="col">
            {TIERS.map((x) => (
              <label key={x} className="row" style={{ alignItems: "flex-start", cursor: "pointer" }}>
                <input type="radio" name="tier" checked={sim.tier === x} onChange={() => act((s) => (s.tier = x))} style={{ marginTop: 4 }} />
                <div>
                  <b>{x}</b> <span className="tiny muted">· {TIER_INFO[x].price}</span>
                  <div className="small muted">{TIER_INFO[x].unlocks}</div>
                </div>
              </label>
            ))}
          </div>
        </Card>
        <div className="col" style={{ gap: 14 }}>
          <Card title="AI (Gemini)">
            {ai === null ? (
              <div className="muted small">Checking…</div>
            ) : ai.configured ? (
              <div className="col small">
                <div>
                  <span className="badge b-ok">● AI online</span> key set on the server (GEMINI_API_KEY)
                </div>
                <div>
                  Copilot and shift report: <span className="mono">{ai.pro}</span>
                </div>
                <div>
                  Alert explainer: <span className="mono">{ai.flash}</span>
                </div>
                <div className="tiny muted">12 s timeout, 10 calls a minute, cache by prompt and context hash. Templates take over on any failure.</div>
              </div>
            ) : (
              <div className="col small">
                <div>
                  <span className="badge b-grey">● AI offline – using templates</span>
                </div>
                <div className="muted">
                  Set <span className="mono">GEMINI_API_KEY</span> in <span className="mono">.env.local</span> and restart the server. Rules and statistics keep working without it.
                </div>
              </div>
            )}
          </Card>
          <Card title="Language and data">
            <div className="col small">
              <label className="row">
                <span style={{ flex: 1 }}>{t(sim.lang, "Language")}</span>
                <div className="seg">
                  {(["EN", "KO"] as const).map((l) => (
                    <button key={l} className={sim.lang === l ? "on" : ""} onClick={() => act((s) => (s.lang = l))}>
                      {l === "EN" ? "English" : "한국어"}
                    </button>
                  ))}
                </div>
              </label>
              <label className="row">
                <span style={{ flex: 1 }}>Data retention</span>
                <select className="input" value={retention} onChange={(e) => setRetention(e.target.value)}>
                  <option value="1y">On-premise, 1 year</option>
                  <option value="3y">On-premise, 3 years</option>
                  <option value="10y">On-premise, 10 years (battery passport)</option>
                </select>
              </label>
              <div className="tiny muted">🔒 Runs on the plant server. Weld data never leaves the plant; only a compact snapshot goes to the AI when you ask it something.</div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => { resetSim(); ui.showToast("Demo reset to normal (S0)"); }}>
                  Reset demo data
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card
        className="mt"
        title="Thresholds per signal (rules engine)"
        right={
          <button className="btn btn-sm" onClick={() => act((s) => (s.thresholds = { ...DEFAULT_THRESHOLDS }))}>
            Restore defaults
          </button>
        }
      >
        {hasTier(sim.tier, "CARE+") ? (
          <table className="t">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Unit</th>
                <th>Warning</th>
                <th>Critical</th>
              </tr>
            </thead>
            <tbody>
              {THRESHOLD_ROWS.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="muted">{r.unit}</td>
                  <td>
                    {r.note === "band" ? <span className="tiny muted">low </span> : null}
                    <input className="input" type="number" step="any" style={{ width: 100 }} value={sim.thresholds[r.warn]} onChange={(e) => setTh(r.warn, parseFloat(e.target.value))} />
                  </td>
                  <td>
                    {r.crit ? (
                      <>
                        {r.note === "band" ? <span className="tiny muted">high </span> : null}
                        <input className="input" type="number" step="any" style={{ width: 100 }} value={sim.thresholds[r.crit]} onChange={(e) => setTh(r.crit!, parseFloat(e.target.value))} />
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <MiniLock need="CARE+" label="Editing predictive thresholds needs CARE+" />
        )}
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Prototype values, not AXBIS or customer limits.
        </div>
      </Card>

      <Card className="mt" title="MES connection (mock)">
        {hasTier(sim.tier, "QUALITY+") ? (
          <div className="col small">
            <label className="row">
              <input type="checkbox" checked={mes.opc} onChange={(e) => setMes({ ...mes, opc: e.target.checked })} />
              <span style={{ width: 120 }}>OPC UA server</span>
              <input className="input mono" style={{ flex: 1 }} value={mes.endpoint} onChange={(e) => setMes({ ...mes, endpoint: e.target.value })} />
            </label>
            <label className="row">
              <input type="checkbox" checked={mes.rest} onChange={(e) => setMes({ ...mes, rest: e.target.checked })} />
              <span style={{ width: 120 }}>REST push</span>
              <input className="input mono" style={{ flex: 1 }} value={mes.rest_url} onChange={(e) => setMes({ ...mes, rest_url: e.target.value })} />
            </label>
            <div className="row">
              <span className="muted">Publishes per weld: weldId, moduleId, cellId, stationId, ts, recipe, depthMm, gapMm, plasma, backRefl, score, verdict.</span>
              <span className="spacer" />
              <button className="btn btn-sm" onClick={() => ui.showToast("Mock: connection test OK (no data sent – prototype)")}>
                Test connection
              </button>
            </div>
          </div>
        ) : (
          <MiniLock need="QUALITY+" label="MES export (OPC UA / REST)" />
        )}
      </Card>
    </div>
  );
}
