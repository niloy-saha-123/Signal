"use client";

import type { Signal } from "@signal/shared";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { EmptyState, SourceChip, cx } from "@/components/ui/primitives";
import { sourceColor, sourceLabel } from "@/lib/chart-colors";
import { relativeTime } from "@/lib/format";

const SHOWN = 8;

export function EvidenceBySource({ signals }: { signals: Signal[] }) {
  const [source, setSource] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const signal of signals) map.set(signal.source, (map.get(signal.source) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [signals]);

  if (signals.length === 0) {
    return (
      <EmptyState
        compact
        title="No evidence in the last 30 days"
        note="Nothing new from this competitor's sources yet. Analyze now to check again."
      />
    );
  }

  const visible = (source ? signals.filter((signal) => signal.source === source) : signals).slice(0, SHOWN);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter evidence by source">
        <FilterChip pressed={source === null} onClick={() => setSource(null)}>
          All <span className="tnum text-ink-muted">{signals.length}</span>
        </FilterChip>
        {counts.map(([key, count]) => (
          <FilterChip key={key} pressed={source === key} onClick={() => setSource(source === key ? null : key)}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sourceColor(key) }} aria-hidden="true" />
            {sourceLabel(key)} <span className="tnum text-ink-muted">{count}</span>
          </FilterChip>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-line">
        {visible.map((signal) => (
          <li key={signal.id} className="py-3.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <SourceChip source={signal.source} />
              <span className="text-[12.5px] text-ink-muted" suppressHydrationWarning>
                {relativeTime(signal.collected_at)}
              </span>
            </div>
            <p className="mt-1.5 text-[14.5px] leading-snug font-semibold break-words text-ink">
              {signal.source_url ? (
                <a href={signal.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {signal.title || sourceLabel(signal.source)}
                  <Icon name="external" className="ml-1 inline h-3.5 w-3.5 text-ink-muted" />
                </a>
              ) : (
                signal.title || sourceLabel(signal.source)
              )}
            </p>
            <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-secondary">{signal.raw_text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors",
        pressed ? "border-ink bg-ink text-white [&_.text-ink-muted]:text-white/70" : "border-line-strong bg-surface text-ink hover:bg-surface-sunken"
      )}
    >
      {children}
    </button>
  );
}
