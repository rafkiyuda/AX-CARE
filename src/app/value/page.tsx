"use client";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { t } from "@/lib/i18n";
import { costPerHourM, feeMonthM, fmtTime } from "@/lib/sim";
import { act, useSim } from "@/lib/store";
import { Card, Kpi, Tip } from "@/components/ui";

const M = (x: number) => `₩${x.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} M`;

export default function ValuePage() {
  const sim = useSim();
  const v = sim.value;
  const cph = costPerHourM(sim);
  const fee = feeMonthM(sim);
  const rows = sim.ledger.map((m) => {
    const dt = m.downtimeH * cph;
    const sc = (m.ngAvoided * v.scrapKrw) / 1e6;
    return { ...m, dt, sc, value: dt + sc, fee };
  });
  const cur = rows[rows.length - 1];
  const total = rows.reduce((s, r) => s + r.value, 0);
  const feeTotal = fee * rows.length;
  const parts = rows.reduce((s, r) => s + r.parts, 0);
  const setV = (k: keyof typeof v, x: number) => act((s) => (s.value = { ...s.value, [k]: isFinite(x) ? x : 0 }));
  const cphFormula = `Cost per downtime hour\n= US$2.3M/h (Siemens 2024, large car plant)\n× line scale ${v.lineScalePct}% × ₩${v.fxKrw}/US$\n= ₩${cph.toFixed(1)} M per hour`;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t(sim.lang, "Value report")}</h1>
          <div className="sub">Buyer view · what the AX CARE subscription returned against its fee · hover any number for its formula</div>
        </div>
      </div>
      <div className="grid g4">
        <Kpi
          label="Downtime avoided (contract)"
          value={rows.reduce((s, r) => s + r.downtimeH, 0).toFixed(1)}
          unit="h"
          tip={"Σ hours avoided per resolved alert, estimated by alert type\n(e.g. window 3 h, power drift 6 h, chiller 5 h)"}
          foot={`${cur.downtimeH.toFixed(1)} h in ${cur.label}`}
        />
        <Kpi label="NG welds avoided" value={rows.reduce((s, r) => s + r.ngAvoided, 0).toLocaleString("en-US")} tip={"Σ NG welds avoided per resolved alert, estimated by alert type"} foot={`${cur.ngAvoided} in ${cur.label}`} />
        <Kpi label="Parts delivered" value={parts} foot="Windows, nozzles, filters" />
        <Kpi
          label="Value vs fee (contract to date)"
          value={`${(total / feeTotal).toFixed(1)}×`}
          tip={`Σ monthly value / Σ monthly fee\n= ${M(total)} / ${M(feeTotal)}`}
          foot={`${M(total)} value · ${M(feeTotal)} fee`}
        />
      </div>

      <div className="grid g-2-1 mt">
        <Card title="Monthly value vs fee">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={rows} margin={{ left: 10, right: 10, top: 10 }}>
              <CartesianGrid vertical={false} stroke="#eef1f4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(x: number) => `₩${x}M`} width={64} />
              <Tooltip formatter={(x: number, n: string) => [M(x), n]} />
              <Legend />
              <Bar dataKey="dt" stackId="v" name="Downtime avoided" fill="var(--navy)" isAnimationActive={false} />
              <Bar dataKey="sc" stackId="v" name="Scrap avoided" fill="#7d9cc4" isAnimationActive={false} />
              <Line dataKey="fee" name="Contract fee" stroke="var(--red)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Assumptions (editable)">
          <div className="col small">
            <label className="row">
              <span style={{ flex: 1 }}>
                <Tip text={"Share of a large car plant's US$2.3M/h downtime cost\n(Siemens, True Cost of Downtime 2024) that applies to this line"}>
                  <span className="formula">Line scale of benchmark</span>
                </Tip>
              </span>
              <input className="input" type="number" step="0.1" style={{ width: 90 }} value={v.lineScalePct} onChange={(e) => setV("lineScalePct", parseFloat(e.target.value))} /> %
            </label>
            <label className="row">
              <span style={{ flex: 1 }}>Exchange rate</span>
              <input className="input" type="number" style={{ width: 90 }} value={v.fxKrw} onChange={(e) => setV("fxKrw", parseFloat(e.target.value))} /> ₩/US$
            </label>
            <div className="row">
              <span style={{ flex: 1 }}>Cost per downtime hour</span>
              <Tip text={cphFormula}>
                <b className="formula">{M(cph)}</b>
              </Tip>
            </div>
            <label className="row">
              <span style={{ flex: 1 }}>Scrap / rework cost per NG weld</span>
              <input className="input" type="number" step="1000" style={{ width: 90 }} value={v.scrapKrw} onChange={(e) => setV("scrapKrw", parseFloat(e.target.value))} /> ₩
            </label>
            <label className="row">
              <span style={{ flex: 1 }}>Licence fee per machine / year (illustrative)</span>
              <input className="input" type="number" style={{ width: 90 }} value={v.feePerMachineYearM} onChange={(e) => setV("feePerMachineYearM", parseFloat(e.target.value))} /> ₩M
            </label>
            <div className="row">
              <span style={{ flex: 1 }}>Monthly fee, 6 machines</span>
              <Tip text={`₩${v.feePerMachineYearM}M × 6 machines / 12 months`}>
                <b className="formula">{M(fee)}</b>
              </Tip>
            </div>
            <div className="tiny muted">Prices are placeholders until the team sets numbers.</div>
          </div>
        </Card>
      </div>

      <Card className="mt" title="Value ledger by month">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Month</th>
                <th>Downtime avoided</th>
                <th>× cost / h</th>
                <th>NG welds avoided</th>
                <th>Parts delivered</th>
                <th>Response time met</th>
                <th>Value</th>
                <th>Fee</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>
                    <b>{r.label}</b>
                  </td>
                  <td className="num">{r.downtimeH.toFixed(1)} h</td>
                  <td>
                    <Tip text={`${r.downtimeH.toFixed(1)} h × ${M(cph)}/h = ${M(r.dt)}`}>
                      <span className="formula">{M(r.dt)}</span>
                    </Tip>
                  </td>
                  <td>
                    <Tip text={`${r.ngAvoided} × ₩${v.scrapKrw.toLocaleString("en-US")} = ${M(r.sc)}`}>
                      <span className="formula">{r.ngAvoided.toLocaleString("en-US")}</span>
                    </Tip>
                  </td>
                  <td className="num">{r.parts}</td>
                  <td className="num">{r.responseMet}%</td>
                  <td>
                    <Tip text={`Downtime ${M(r.dt)} + scrap ${M(r.sc)}`}>
                      <b className="formula">{M(r.value)}</b>
                    </Tip>
                  </td>
                  <td className="num">{M(r.fee)}</td>
                  <td>
                    <Tip text={`${M(r.value)} − ${M(r.fee)}`}>
                      <b className="formula" style={{ color: r.value >= r.fee ? "var(--green)" : "var(--red)" }}>
                        {M(r.value - r.fee)}
                      </b>
                    </Tip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt" title={`This month's entries (from resolved alerts)`}>
        {cur.events.length ? (
          <table className="t">
            <tbody>
              {cur.events.map((e, i) => (
                <tr key={i}>
                  <td className="mono small">{fmtTime(e.t)}</td>
                  <td>{e.text}</td>
                  <td className="num">{e.hours} h</td>
                  <td className="num">{e.ng} NG</td>
                  <td className="num">{M(e.hours * cph + (e.ng * v.scrapKrw) / 1e6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="muted small">Resolve an alert to see it written here.</div>
        )}
      </Card>
      <p className="tiny muted">Monthly value = downtime hours avoided × cost per hour + NG welds avoided × scrap cost · sample data</p>
    </div>
  );
}
