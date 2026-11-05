"use client";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RESPONSE_TIME, hasTier } from "@/lib/config";
import { t } from "@/lib/i18n";
import { fmtDay, fmtTime, openAlerts, siteToday } from "@/lib/sim";
import { useSim } from "@/lib/store";
import type { Station } from "@/lib/types";
import { Card, Gauge, Kpi, MiniLock, Sparkline, StatusBadge } from "@/components/ui";

function nextService(st: Station, now: number, hoursWarn: number) {
  const days = Math.max(0, (hoursWarn - st.laserHours) / 20);
  return fmtDay(now + days * 86_400_000);
}

function StationCard({ st }: { st: Station }) {
  const sim = useSim();
  const router = useRouter();
  const care = hasTier(sim.tier, "CARE+");
  return (
    <div className={`card st-card ${st.status}`} onClick={() => router.push(`/station/${st.id}`)}>
      <div className="row" style={{ gap: 6 }}>
        <h3 style={{ flex: 1 }}>{st.id}</h3>
        <StatusBadge s={st.status} />
      </div>
      <div className="tiny muted">
        {st.joint} · {st.laser}
      </div>
      <div className="row" style={{ marginTop: 6, alignItems: "flex-end", gap: 8 }}>
        {care ? (
          <div style={{ textAlign: "center" }}>
            <Gauge value={st.anomaly} />
            <div className="tiny muted" style={{ marginTop: -2 }}>
              anomaly · {st.driver}
            </div>
          </div>
        ) : (
          <div style={{ width: 96 }}>
            <MiniLock need="CARE+" label="Anomaly" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tiny muted">Depth, last 50 welds</div>
          <Sparkline data={st.recent.map((w) => w.depthMm)} lo={1.15} hi={1.3} width={130} height={34} />
        </div>
      </div>
      <div className="meta">
        <span>
          {t(sim.lang, "Health")} <b>{st.health}%</b>
        </span>
        <span>
          PGM <b style={{ color: st.current.pgm >= sim.thresholds.pgmWarn ? "var(--red)" : undefined }}>{st.current.pgm.toFixed(1)}%</b>
        </span>
        <span>
          Power <b>{st.current.power.toFixed(1)}%</b>
        </span>
        <span>
          {t(sim.lang, "Next service")} <b>{nextService(st, sim.now, sim.thresholds.hoursWarn)}</b>
        </span>
      </div>
    </div>
  );
}

export default function Overview() {
  const sim = useSim();
  const L = (s: string) => t(sim.lang, s);
  const today = siteToday(sim);
  const uptime = sim.uptime30.reduce((s, d) => s + d.pct, 0) / sim.uptime30.length;
  const care = hasTier(sim.tier, "CARE+");
  const open = openAlerts(sim);
  const siteAnom = sim.stations.reduce((s, x) => s + x.anomaly, 0) / sim.stations.length;
  const online = sim.stations.length;
  const hours = [...sim.hours.values()].sort((a, b) => a.hour - b.hour).map((h) => ({ hour: fmtTime(h.hour), welds: h.n }));
  const yields = sim.stations
    .map((s) => ({ id: s.id, y: s.today.n ? (s.today.ok / s.today.n) * 100 : 100 }))
    .sort((a, b) => a.y - b.y);
  const yMin = Math.floor(Math.min(...yields.map((y) => y.y)) - 0.5);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{L("Overview")}</h1>
          <div className="sub">Plant A · Module Line 2 · 6 laser welding stations · live, refresh every 1 s</div>
        </div>
      </div>
      <div className="grid g6">
        <Kpi label={L("Machines online")} value={`${online} / 6`} foot="All stations reporting" />
        <Kpi label={L("Line uptime (30 d)")} value={uptime.toFixed(1)} unit="%" foot="Target 98%" tip={"Mean of daily uptime over the last 30 days\n= Σ daily uptime % / 30"} />
        <Kpi
          label={L("Open predictive alerts")}
          value={care ? open.length : "—"}
          foot={care ? `${open.filter((a) => a.severity === "critical").length} critical` : "🔒 CARE+"}
        />
        <Kpi
          label={L("Welds within spec today")}
          value={today.okPct.toFixed(2)}
          unit="%"
          foot={`${today.n.toLocaleString("en-US")} welds · ${today.check} CHECK · ${today.ng} NG`}
          tip={"OK welds / all welds today\nOK = quality score ≥ 85"}
        />
        <Kpi label={L("Site anomaly index")} value={care ? Math.round(siteAnom) : "—"} foot={care ? "Mean of 6 stations · normal < 40" : "🔒 CARE+"} tip={"Mean of station anomaly scores (0–100)"} />
        <Kpi label={L("Contract response time")} value={<span style={{ fontSize: 17 }}>{RESPONSE_TIME[sim.tier]}</span>} foot={`${sim.tier} licence`} />
      </div>

      <div className="grid g6 mt">
        {sim.stations.map((st) => (
          <StationCard key={st.id} st={st} />
        ))}
      </div>

      <div className="grid g3 mt">
        <Card title={L("Uptime by day, last 30 days")}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={sim.uptime30} margin={{ left: -18, right: 8, top: 6 }}>
              <CartesianGrid vertical={false} stroke="#eef1f4" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
              <YAxis domain={[95, 100]} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <ReferenceLine y={98} stroke="var(--red)" strokeDasharray="4 3" label={{ value: "target 98%", fontSize: 10, fill: "var(--red)", position: "insideBottomRight" }} />
              <Bar dataKey="pct" isAnimationActive={false}>
                {sim.uptime30.map((d, i) => (
                  <Cell key={i} fill={d.pct < 98 ? "var(--red-2)" : "var(--navy)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title={L("Welds per hour today")}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={hours} margin={{ left: -10, right: 8, top: 6 }}>
              <CartesianGrid vertical={false} stroke="#eef1f4" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="welds" fill="var(--navy)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="tiny muted">Current hour is still filling.</div>
        </Card>
        <Card title={L("Yield by station today")}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={yields} layout="vertical" margin={{ left: 4, right: 30, top: 6 }}>
              <CartesianGrid horizontal={false} stroke="#eef1f4" />
              <XAxis type="number" domain={[Math.min(yMin, 98), 100]} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="id" tick={{ fontSize: 11 }} width={62} />
              <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
              <Bar dataKey="y" isAnimationActive={false} label={{ position: "right", fontSize: 10, formatter: (v: number) => v.toFixed(1) }}>
                {yields.map((d, i) => (
                  <Cell key={i} fill={d.y < 99 ? "var(--amber)" : "var(--green)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
