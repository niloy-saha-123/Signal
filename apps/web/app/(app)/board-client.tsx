"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AddCompetitorForm } from "@/components/AddCompetitorForm";
import { CompetitorAreaTabs, weeklyChange } from "@/components/competitors/parts";
import { Icon } from "@/components/ui/icons";
import { EmptyState, PageHeader, Probability, Select, cx } from "@/components/ui/primitives";
import { formatShortDate } from "@/lib/format";

export interface BoardRow {
  id: string;
  name: string;
  domain: string;
  score: number | null;
  delta: number | null;
  openForecasts: number;
  next: { id: string; statement: string; probability: number; resolvesAt: string } | null;
  discovering: boolean;
}

type Sort = "activity" | "change" | "next" | "name";

const byName = (a: BoardRow, b: BoardRow) => a.name.localeCompare(b.name);

// Nulls always sink: an unscored competitor is not "least active", it is unknown.
function nullsLast(a: number | null, b: number | null, compare: (x: number, y: number) => number) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
}

const SORTS: Record<Sort, (a: BoardRow, b: BoardRow) => number> = {
  activity: (a, b) => nullsLast(a.score, b.score, (x, y) => y - x) || byName(a, b),
  change: (a, b) =>
    nullsLast(a.delta === null ? null : Math.abs(a.delta), b.delta === null ? null : Math.abs(b.delta), (x, y) => y - x) ||
    byName(a, b),
  next: (a, b) =>
    nullsLast(
      a.next ? new Date(a.next.resolvesAt).getTime() : null,
      b.next ? new Date(b.next.resolvesAt).getTime() : null,
      (x, y) => x - y
    ) || byName(a, b),
  name: byName,
};

export function CompetitorBoard({
  rows,
  forecastsUnavailable = false,
}: {
  rows: BoardRow[];
  forecastsUnavailable?: boolean;
}) {
  const [sort, setSort] = useState<Sort>("activity");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => !q || row.name.toLowerCase().includes(q) || row.domain.toLowerCase().includes(q))
      .sort(SORTS[sort]);
  }, [rows, sort, query]);

  return (
    <div>
      <PageHeader
        title="Competitors"
        description="Who you're watching, how much each one is doing, and what Signal expects from them next."
        action={<CompetitorAreaTabs active="watching" />}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="You're not watching anyone yet"
          note="Add a competitor's website. Signal finds their pricing page, changelog, job board and community on its own."
          action={
            <div className="w-full max-w-md text-left">
              <AddCompetitorForm autoFocus size="lg" />
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="w-full lg:max-w-md">
              <AddCompetitorForm />
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <span className="sr-only">Find a competitor</span>
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find"
                  className="h-10 w-40 rounded-[10px] border border-line-strong bg-surface pr-3 pl-9 text-[14px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
                />
              </label>
              <Select label="Sort competitors" value={sort} onChange={(value) => setSort(value as Sort)}>
                <option value="activity">Most active</option>
                <option value="change">Biggest change</option>
                <option value="next">Next forecast due</option>
                <option value="name">Name</option>
              </Select>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState compact title={`No competitor matches “${query.trim()}”`} />
          ) : (
            <ul className="space-y-2.5">
              {visible.map((row) => (
                <CompetitorRow key={row.id} row={row} forecastsUnavailable={forecastsUnavailable} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CompetitorRow({ row, forecastsUnavailable }: { row: BoardRow; forecastsUnavailable: boolean }) {
  const rising = row.delta !== null && Math.round(row.delta) > 0;
  return (
    <li>
      <Link
        href={`/radar/${row.id}`}
        className="grid gap-4 rounded-[14px] border border-line bg-surface p-4 transition-colors hover:border-line-strong sm:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.6fr)_auto] sm:items-center sm:p-5"
      >
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold text-ink">{row.name}</p>
          <p className="truncate text-[13px] text-ink-muted">{row.domain}</p>
        </div>

        <div className="flex items-baseline gap-3 sm:block sm:w-28 sm:text-right">
          <span className="metric text-[28px]">{row.score ?? "—"}</span>
          <span className={cx("text-[12.5px] font-medium sm:block", rising ? "text-miss-text" : "text-ink-muted")}>
            {row.score === null ? (row.discovering ? "Finding sources" : "Gathering signals") : weeklyChange(row.delta)}
          </span>
        </div>

        <div className="min-w-0">
          {forecastsUnavailable ? (
            <p className="text-[13.5px] text-ink-muted">Forecasts didn&apos;t load.</p>
          ) : row.next ? (
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[14px] leading-snug font-semibold text-ink">{row.next.statement}</p>
                <p className="mt-1 text-[12.5px] text-ink-muted" suppressHydrationWarning>
                  Settles {formatShortDate(row.next.resolvesAt)}
                  {row.openForecasts > 1 ? ` · ${row.openForecasts - 1} more open` : ""}
                </p>
              </div>
              <Probability value={row.next.probability} size="sm" />
            </div>
          ) : (
            <p className="text-[13.5px] text-ink-muted">No open forecast. Signal waits until the evidence agrees.</p>
          )}
        </div>

        <Icon name="arrowRight" className="hidden h-4 w-4 text-ink-muted sm:block" />
      </Link>
    </li>
  );
}
