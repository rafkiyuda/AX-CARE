"use client";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDateTime, fmtTimeS } from "@/lib/sim";

export interface Band {
  from: number;
  to: number;
  kind: "warn" | "crit";
}

const tickTime = (long: boolean) => (t: number) => {
  const d = new Date(t + 9 * 3600_000);
  return long ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCHours()).padStart(2, "0")}h` : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** One signal chart with warning/critical bands shaded (PRD 7.2). */
export function SignalChart({
  data,
  dataKey,
  label,
  unit,
  domain,
  bands,
  target,
  long,
  height = 120,
  decimals = 2,
}: {
  data: { t: number; [k: string]: number }[];
  dataKey: string;
  label: string;
  unit: string;
  domain: [number, number];
  bands: Band[];
  target?: number;
  long?: boolean;
  height?: number;
  decimals?: number;
}) {
  const last = data[data.length - 1]?.[dataKey];
  return (
    <div>
      <div className="row small" style={{ gap: 6, marginBottom: 2 }}>
        <b>{label}</b>
        <span className="muted">{unit}</span>
        <span className="spacer" />
        <span className="mono">{last !== undefined ? last.toFixed(decimals) : "–"}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ left: -14, right: 6, top: 2, bottom: 0 }} syncId="signals">
          <CartesianGrid stroke="#eef1f4" vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickTime(!!long)} tick={{ fontSize: 10 }} minTickGap={40} />
          <YAxis domain={domain} tick={{ fontSize: 10 }} allowDataOverflow width={52} tickFormatter={(v: number) => v.toFixed(decimals > 1 ? 2 : decimals)} />
          {bands.map((b, i) => (
            <ReferenceArea key={i} y1={b.from} y2={b.to} fill={b.kind === "crit" ? "#e83340" : "#f0b429"} fillOpacity={b.kind === "crit" ? 0.14 : 0.13} ifOverflow="hidden" />
          ))}
          {target !== undefined && <ReferenceLine y={target} stroke="#7a8693" strokeDasharray="3 3" />}
          <Tooltip labelFormatter={(t: number) => (long ? fmtDateTime(t) : fmtTimeS(t))} formatter={(v: number) => [v.toFixed(decimals + 1), label]} />
          <Line dataKey={dataKey} stroke="var(--navy)" dot={false} strokeWidth={1.4} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** History + linear forecast with a ± band, for the remaining-life cards (PRD 8.2). */
export function ForecastChart({
  hist,
  limit,
  forecast,
  unit,
  domain,
  long,
}: {
  hist: { t: number; v: number }[];
  limit: number;
  forecast: { t: number; f: number; lo: number; hi: number }[];
  unit: string;
  domain: [number, number];
  long?: boolean;
}) {
  const data = [...hist.map((h) => ({ t: h.t, v: h.v })), ...forecast.map((f) => ({ t: f.t, f: f.f, band: [f.lo, f.hi] as [number, number] }))];
  return (
    <ResponsiveContainer width="100%" height={130}>
      <ComposedChart data={data} margin={{ left: -14, right: 6, top: 6, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f4" vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickTime(!!long)} tick={{ fontSize: 10 }} minTickGap={36} />
        <YAxis domain={domain} tick={{ fontSize: 10 }} allowDataOverflow width={44} />
        <ReferenceLine y={limit} stroke="var(--red)" strokeDasharray="4 3" label={{ value: `limit ${limit}${unit}`, fontSize: 10, fill: "var(--red)", position: "insideTopLeft" }} />
        <Area dataKey="band" stroke="none" fill="#2f6db3" fillOpacity={0.15} isAnimationActive={false} connectNulls />
        <Line dataKey="v" stroke="var(--navy)" dot={false} strokeWidth={1.3} isAnimationActive={false} />
        <Line dataKey="f" stroke="#2f6db3" strokeDasharray="5 3" dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls />
        <Tooltip labelFormatter={(t: number) => fmtDateTime(t)} formatter={(v: number | number[]) => (Array.isArray(v) ? `${v[0].toFixed(1)}–${v[1].toFixed(1)}` : v.toFixed(2))} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
