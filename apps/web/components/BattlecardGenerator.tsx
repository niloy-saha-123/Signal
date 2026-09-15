// Triggered from CommandBar or a vulnerability alert — mounting this component is the
// trigger; it starts generating immediately. onGenerate is a callback prop, not a hardcoded
// fetch — no backend battlecard endpoint exists yet (see 00-overview.md's Discovered Gaps).
"use client";
import { useEffect, useState } from "react";

export interface BattlecardSection {
  heading: string;
  content: string;
}

export interface BattlecardResult {
  title: string;
  sections: BattlecardSection[];
}

export interface BattlecardGeneratorProps {
  competitorId: string;
  onGenerate: (competitorId: string) => Promise<BattlecardResult>;
}

type GenerationState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: BattlecardResult };

export function BattlecardGenerator({ competitorId, onGenerate }: BattlecardGeneratorProps) {
  const [state, setState] = useState<GenerationState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    onGenerate(competitorId)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", result });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to generate battlecard.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [competitorId, onGenerate]);

  if (state.status === "loading") {
    return <p className="text-sm text-slate-500">Generating battlecard…</p>;
  }
  if (state.status === "error") {
    return <p className="text-sm text-red-600">{state.message}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-slate-900">{state.result.title}</h2>
      {state.result.sections.map((section) => (
        <div key={section.heading}>
          <h3 className="text-sm font-medium text-slate-700">{section.heading}</h3>
          <p className="text-sm text-slate-600">{section.content}</p>
        </div>
      ))}
    </div>
  );
}
