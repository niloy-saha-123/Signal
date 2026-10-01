// Filter controls for /intel — search, source, competitor, quality and a date
// range. Filter state lives in the URL so a filtered view can be shared;
// SignalFeed itself stays filter-agnostic.
"use client";
import { SignalSourceSchema } from "@signal/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/primitives";
import type { Competitor } from "@/lib/api";
import { sourceLabel } from "@/lib/chart-colors";

const DATE_INPUT =
  "h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink focus:border-ink focus:outline-none";

export function IntelFilters({ competitors }: { competitors: Competitor[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/intel?${params.toString()}`);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    updateParam("q", query.trim());
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSearch} role="search" className="w-full sm:max-w-md">
        <label className="relative block">
          <span className="sr-only">Search evidence</span>
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and text, then press Enter"
            className="h-11 w-full rounded-[10px] border border-line-strong bg-surface pr-3 pl-10 text-[15px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
          />
        </label>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Source" value={searchParams.get("source") ?? ""} onChange={(v) => updateParam("source", v)}>
          <option value="">Every source</option>
          {SignalSourceSchema.options.map((source) => (
            <option key={source} value={source}>
              {sourceLabel(source)}
            </option>
          ))}
        </Select>
        <Select
          label="Competitor"
          value={searchParams.get("competitor_id") ?? ""}
          onChange={(v) => updateParam("competitor_id", v)}
        >
          <option value="">Every competitor</option>
          {competitors.map((competitor) => (
            <option key={competitor.id} value={competitor.id}>
              {competitor.name}
            </option>
          ))}
        </Select>
        <Select label="Quality" value={searchParams.get("min_quality") ?? ""} onChange={(v) => updateParam("min_quality", v)}>
          <option value="">Any quality</option>
          <option value="0.7">Strong evidence only</option>
        </Select>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-secondary">
          From
          <input
            type="date"
            value={searchParams.get("from") ?? ""}
            onChange={(event) => updateParam("from", event.target.value)}
            className={DATE_INPUT}
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-secondary">
          To
          <input
            type="date"
            value={searchParams.get("to") ?? ""}
            onChange={(event) => updateParam("to", event.target.value)}
            className={DATE_INPUT}
          />
        </label>
      </div>
    </div>
  );
}
