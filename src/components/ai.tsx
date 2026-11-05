"use client";
import { useMemo, useState, type ReactNode } from "react";
import { contextNumbers, isVerified, splitNumbers } from "@/lib/ai";
import { Modal } from "./ui";

/** Renders text and greys out any number that is not in the context sent to the AI (PRD 8.5). */
export function VText({ text, nums }: { text: string; nums: number[] }) {
  const parts = splitNumbers(text);
  return (
    <>
      {parts.map((p, i) =>
        p.num && !isVerified(p.text, nums) ? (
          <span key={i} className="unverified" title="unverified – not found in the data sent to the AI">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function useNums(context: unknown) {
  return useMemo(() => contextNumbers(context), [context]);
}

export function AIFooter({ source, model, note, context }: { source: "gemini" | "template"; model?: string; note?: string; context: unknown }) {
  const [show, setShow] = useState(false);
  return (
    <div className="row small" style={{ marginTop: 8 }}>
      <span className="ai-label">✦ AI-generated</span>
      <span className="muted tiny">{source === "gemini" ? `Gemini · ${model}` : "Template answer (rules + statistics)"}</span>
      {note && <span className="muted tiny">· {note}</span>}
      <span className="spacer" />
      <button className="link small" onClick={() => setShow(true)}>
        Show data used
      </button>
      {show && (
        <Modal title="Data used for this answer (JSON context)" onClose={() => setShow(false)}>
          <pre className="json">{JSON.stringify(context, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}

/** Tiny Markdown renderer: headings, bold, bullet lists, tables, paragraphs. Numbers are verified. */
export function Markdown({ md, nums }: { md: string; nums: number[] }) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const inline = (s: string, k: number) => {
    const segs = s.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={k}>
        {segs.map((g, j) =>
          g.startsWith("**") && g.endsWith("**") ? (
            <b key={j}>
              <VText text={g.slice(2, -2)} nums={nums} />
            </b>
          ) : (
            <VText key={j} text={g} nums={nums} />
          ),
        )}
      </span>
    );
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(
        <table key={`t${i}`}>
          <thead>
            <tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(1).map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, j)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*[-*] /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ""));
      out.push(
        <ul key={`u${i}`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, j)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const lvl = Math.min(3, h[1].length + (h[1].length === 1 ? 1 : 0));
      out.push(lvl <= 2 ? <h2 key={i}>{inline(h[2], 0)}</h2> : <h3 key={i}>{inline(h[2], 0)}</h3>);
    } else if (l.trim()) out.push(<p key={i}>{inline(l, 0)}</p>);
    i++;
  }
  return <div className="md">{out}</div>;
}
