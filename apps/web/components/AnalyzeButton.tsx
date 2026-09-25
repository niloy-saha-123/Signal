"use client";
import { useState } from "react";
import { analyzeCompetitor } from "../lib/api";

export function AnalyzeButton({ competitorId }: { competitorId: string }) {
  const [state, setState] = useState<"idle" | "running" | "queued" | "error">("idle");

  async function run() {
    setState("running");
    try {
      await analyzeCompetitor(competitorId);
      setState("queued");
      setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  const label = state === "running" ? "Queuing…" : state === "queued" ? "Analysis queued" : state === "error" ? "Failed to queue" : "Re-run analysis";

  return (
    <button
      onClick={run}
      disabled={state === "running"}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
    >
      {state === "queued" ? (
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
      ) : null}
      {label}
    </button>
  );
}