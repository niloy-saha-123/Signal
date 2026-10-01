"use client";
import { useState } from "react";
import { Icon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { analyzeCompetitor } from "../lib/api";

export function AnalyzeButton({ competitorId, name }: { competitorId: string; name: string }) {
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      await analyzeCompetitor(competitorId);
      toast(`Analyzing ${name}. New evidence and forecasts land here in a few minutes.`, "success");
    } catch {
      toast(`Couldn't start an analysis of ${name}. Try again in a moment.`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={pending} className={buttonClass("primary", "sm")}>
      <Icon name="refresh" className="h-4 w-4" />
      {pending ? "Starting…" : "Analyze now"}
    </button>
  );
}
