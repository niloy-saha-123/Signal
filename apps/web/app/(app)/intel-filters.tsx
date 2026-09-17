// apps/web/app/intel-filters.tsx
// Filter controls for /intel — SignalFeed itself deliberately has no filtering logic (Part 5),
// this page owns it. Filter state lives in the URL for shareability/bookmarking.
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import type { Competitor } from "@/lib/api";

const SOURCES = ["reddit", "hn", "jobs", "changelog", "pricing"] as const;

export function IntelFilters({ competitors }: { competitors: Competitor[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/intel?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-studio-muted">
        Source
        <select
          value={searchParams.get("source") ?? ""}
          onChange={(event) => updateParam("source", event.target.value)}
          className="rounded-full border border-studio-line bg-studio-paper px-3 py-2 text-sm outline-none focus:border-studio-action"
        >
          <option value="">All sources</option>
          {SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-studio-muted">
        Competitor
        <select
          value={searchParams.get("competitor_id") ?? ""}
          onChange={(event) => updateParam("competitor_id", event.target.value)}
          className="rounded-full border border-studio-line bg-studio-paper px-3 py-2 text-sm outline-none focus:border-studio-action"
        >
          <option value="">All competitors</option>
          {competitors.map((competitor) => (
            <option key={competitor.id} value={competitor.id}>
              {competitor.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
