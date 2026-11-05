"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { askCopilot, shiftReport, type AIResult, type ChatAction, type ChatAnswer } from "@/lib/ai";
import { hasTier } from "@/lib/config";
import { createWorkOrder } from "@/lib/sim";
import { act, getSim, useSim } from "@/lib/store";
import { download, useUI } from "@/lib/ui";
import { AIFooter, Markdown, VText, useNums } from "./ai";
import { Drawer, MiniLock } from "./ui";

type Msg =
  | { role: "user"; text: string }
  | { role: "ai"; kind: "chat"; res: AIResult<ChatAnswer> }
  | { role: "ai"; kind: "report"; res: AIResult<string> }
  | { role: "pending" };

const SUGGESTED = ["What needs attention this shift?", "Why did WELD-05 drift?", "Write the shift report", "Which modules are at risk?"];

function screenName(path: string) {
  if (path === "/") return "Site overview";
  if (path.startsWith("/station/")) return `Station ${path.split("/")[2]}`;
  return path.slice(1).replace(/^\w/, (c) => c.toUpperCase());
}

function ChatBubble({ res, onAction }: { res: AIResult<ChatAnswer>; onAction: (a: ChatAction) => void }) {
  const nums = useNums(res.context);
  const d = res.data;
  return (
    <div className="ai-box">
      <h4 style={{ marginTop: 0 }}>Summary</h4>
      <div>
        <VText text={d.summary} nums={nums} />
      </div>
      {d.evidence.length > 0 && (
        <>
          <h4>Evidence</h4>
          <ul>
            {d.evidence.map((e, i) => (
              <li key={i}>
                <VText text={e} nums={nums} />
              </li>
            ))}
          </ul>
        </>
      )}
      {d.actions.length > 0 && (
        <>
          <h4>Recommended actions</h4>
          <div className="chips">
            {d.actions.map((a, i) => (
              <button key={i} className="btn btn-sm" onClick={() => onAction(a)}>
                {a.type === "work_order" ? "🛠" : a.type === "open_station" ? "↗" : "→"} {a.label}
              </button>
            ))}
          </div>
        </>
      )}
      <AIFooter source={res.source} model={res.model} note={res.note} context={res.context} />
    </div>
  );
}

function ReportBubble({ res }: { res: AIResult<string> }) {
  const nums = useNums(res.context);
  const ui = useUI();
  return (
    <div className="ai-box">
      <Markdown md={res.data} nums={nums} />
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(res.data);
            ui.showToast("Shift report copied");
          }}
        >
          Copy
        </button>
        <button className="btn btn-sm" onClick={() => download("AX-CARE-shift-report.md", res.data, "text/markdown")}>
          Download .md
        </button>
      </div>
      <AIFooter source={res.source} model={res.model} note={res.note} context={res.context} />
    </div>
  );
}

export function Copilot() {
  const sim = useSim();
  const ui = useUI();
  const path = usePathname();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const stationId = path.startsWith("/station/") ? path.split("/")[2] : null;
  const full = hasTier(sim.tier, "QUALITY+");
  const allowed = hasTier(sim.tier, "CARE+");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setInput("");
    setBusy(true);
    if (/shift report|교대|리포트/i.test(q)) {
      setMsgs((m) => [...m, { role: "user", text: q }, { role: "pending" }]);
      const res = await shiftReport(getSim());
      setMsgs((m) => [...m.filter((x) => x.role !== "pending"), { role: "ai", kind: "report", res }]);
    } else {
      setMsgs((m) => [...m, { role: "user", text: q }, { role: "pending" }]);
      const res = await askCopilot(getSim(), q, screenName(path), stationId, !full);
      setMsgs((m) => [...m.filter((x) => x.role !== "pending"), { role: "ai", kind: "chat", res }]);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (ui.copilotOpen && ui.copilotPrompt) {
      const p = ui.copilotPrompt;
      useUI.setState({ copilotPrompt: null });
      if (allowed) ask(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.copilotOpen, ui.copilotPrompt]);

  function onAction(a: ChatAction) {
    if (a.type === "work_order" && a.stationId) {
      const wo = act((s) => createWorkOrder(s, a.stationId!));
      ui.showToast(`${wo.id} created for ${a.stationId}`);
    } else if (a.type === "open_station" && a.stationId) router.push(`/station/${a.stationId}`);
    else if (a.type === "open_alerts") router.push("/alerts");
    else if (a.type === "open_quality") router.push("/quality");
  }

  if (!ui.copilotOpen) return null;
  return (
    <Drawer
      onClose={ui.closeCopilot}
      title={
        <div>
          <h2>✦ AX CARE Copilot</h2>
          <div className="tiny muted">
            Knows: {screenName(path)}
            {stationId ? ` · ${stationId}` : ""} · {full ? "full data (QUALITY+)" : "preview (CARE+)"}
          </div>
        </div>
      }
      footer={
        allowed ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input className="input" style={{ flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about stations, alerts, quality… (EN / 한국어)" disabled={busy} />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>
              Ask
            </button>
          </form>
        ) : undefined
      }
    >
      {!allowed ? (
        <MiniLock need="CARE+" label="The AI copilot starts as a preview in CARE+ and has full data in QUALITY+." />
      ) : (
        <>
          {!full && (
            <div className="banner" style={{ borderRadius: 8, marginBottom: 12 }}>
              Preview: station signals and alerts only. Weld records and modules at risk need QUALITY+.
            </div>
          )}
          {msgs.length === 0 && (
            <div className="muted small" style={{ marginBottom: 10 }}>
              Answers use only a compact JSON snapshot of this plant&apos;s data. Data stays on the plant server; only the snapshot goes to the model.
            </div>
          )}
          {msgs.map((m, i) => (
            <div className="chat-msg" key={i}>
              {m.role === "user" && <div className="chat-user">{m.text}</div>}
              {m.role === "pending" && <div className="muted small">✦ Thinking… (falls back to a template after 12 s)</div>}
              {m.role === "ai" && m.kind === "chat" && <ChatBubble res={m.res} onAction={onAction} />}
              {m.role === "ai" && m.kind === "report" && <ReportBubble res={m.res} />}
            </div>
          ))}
          <div ref={endRef} />
          <div className="chips" style={{ marginTop: 8 }}>
            {SUGGESTED.map((s) => (
              <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}
