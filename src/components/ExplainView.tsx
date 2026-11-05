"use client";
import type { AIResult } from "@/lib/ai";
import type { ExplainResult } from "@/lib/types";
import { AIFooter, VText, useNums } from "./ai";

export function ExplainView({ res }: { res: AIResult<ExplainResult> }) {
  const nums = useNums(res.context);
  const d = res.data;
  return (
    <div className="ai-box">
      <div className="row">
        <b>✦ Alert explanation</b>
        <span className={`badge ${d.confidence === "high" ? "b-ok" : d.confidence === "medium" ? "b-check" : "b-grey"}`}>confidence: {d.confidence}</span>
      </div>
      <h4>Likely cause</h4>
      <div>
        <VText text={d.likely_cause} nums={nums} />
      </div>
      <h4>Risk if ignored</h4>
      <div>
        <VText text={d.risk_if_ignored} nums={nums} />
      </div>
      {d.time_to_impact && (
        <>
          <h4>Time to impact</h4>
          <div>
            <VText text={d.time_to_impact} nums={nums} />
          </div>
        </>
      )}
      <h4>Recommended actions</h4>
      <ul>
        {d.recommended_actions.map((a, i) => (
          <li key={i}>
            <VText text={a} nums={nums} />
          </li>
        ))}
      </ul>
      {d.parts_needed && d.parts_needed.length > 0 && (
        <>
          <h4>Parts needed</h4>
          <div>{d.parts_needed.join(", ")}</div>
        </>
      )}
      <AIFooter source={res.source} model={res.model} note={res.note} context={res.context} />
    </div>
  );
}
