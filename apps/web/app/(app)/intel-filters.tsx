// Filter controls for /intel — source, competitor, and a date range. Filter state lives in
// the URL for shareability/bookmarking; SignalFeed itself stays filter-agnostic.
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import type { Competitor } from "@/lib/api";

const SOURCES = [
  "reddit",
  "hn",
  "jobs",
  "changelog",
  "pricing",
  "github",
  "website",
  "community",
  "postings",
] as const;

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
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        Source
        <select
          value={searchParams.get("source") ?? ""}
          onChange={(event) => updateParam("source", event.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="">All sources</option>
          {SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        Competitor
        <select
          value={searchParams.get("competitor_id") ?? ""}
          onChange={(event) => updateParam("competitor_id", event.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="">All competitors</option>
          {competitors.map((competitor) => (
            <option key={competitor.id} value={competitor.id}>
              {competitor.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        From
        <input
          type="date"
          value={searchParams.get("from") ?? ""}
          onChange={(event) => updateParam("from", event.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        To
        <input
          type="date"
          value={searchParams.get("to") ?? ""}
          onChange={(event) => updateParam("to", event.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>
    </div>
  );
}