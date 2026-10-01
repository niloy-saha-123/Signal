"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AddCompetitorForm } from "@/components/AddCompetitorForm";
import { Sig } from "@/components/brand/Sig";
import { Icon } from "@/components/ui/icons";
import { Card, EmptyState, ErrorState, LinkButton, Probability, SectionLabel } from "@/components/ui/primitives";
import type { DashboardSummary } from "@/lib/api";
import { askSignal } from "@/lib/ask";
import { daysUntil, formatShortDate, greeting, humanizePattern, relativeTime } from "@/lib/format";

export interface Movement {
  id: string;
  competitorId: string;
  competitor: string;
  pattern: string;
  detail: string;
  confidence: number;
  timestamp: string;
  action: string | null;
}

export interface Pulse {
  id: string;
  name: string;
  score: number | null;
  delta: number | null;
}

export interface ForecastPreview {
  id: string;
  competitor: string;
  statement: string;
  probability: number;
  resolvesAt: string;
}

type Props = {
  summary: DashboardSummary | null;
  movements: Movement[];
  pulse: Pulse[];
  // null = the fetch failed; [] = there are genuinely none.
  forecasts: ForecastPreview[] | null;
  competitorCount: number;
};

// Greeting depends on the viewer's clock, so it renders after mount to keep
// server and client HTML identical.
function useGreeting() {
  const [text, setText] = useState("Hello");
  useEffect(() => setText(greeting(new Date().getHours())), []);
  return text;
}

export function BriefingClient({ summary, movements, pulse, forecasts, competitorCount }: Props) {
  const hello = useGreeting();

  if (competitorCount === 0) {
    return (
      <div className="flex flex-col gap-8">
        <header className="flex items-center gap-4">
          <Sig size={52} mood="happy" decorative />
          <div>
            <p className="text-[15px] font-semibold text-ink-muted">{hello}</p>
            <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">
              Your briefing starts with a competitor.
            </h1>
          </div>
        </header>
        <Card className="p-6 sm:p-8">
          <p className="max-w-xl text-[16px] text-ink-secondary">
            Type a competitor&rsquo;s website. Signal finds their job boards, docs, feeds and forums, and this page fills
            with what moved and what it expects next.
          </p>
          <div className="mt-5 max-w-lg">
            <AddCompetitorForm size="lg" autoFocus />
          </div>
          <p className="mt-4 text-[14px] text-ink-muted">
            Not sure who to add?{" "}
            <Link href="/discovery" className="font-semibold text-accent hover:underline">
              Let Signal suggest competitors
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const [top, ...rest] = movements;
  const moved = movements.length;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          <Sig size={52} decorative />
          <div>
            <p className="text-[15px] font-semibold text-ink-muted">{hello}</p>
            <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-[40px]">
              {moved === 0 ? "Quiet out there." : `${moved} thing${moved === 1 ? "" : "s"} moved.`}
            </h1>
            <p className="mt-1 text-[15px] text-ink-secondary">
              Across {competitorCount} competitor{competitorCount === 1 ? "" : "s"}
              {summary ? `, from ${summary.signals_this_week} signals this week` : ""}.
            </p>
          </div>
        </div>
        <div className="w-full max-w-sm">
          <AddCompetitorForm />
        </div>
      </header>

      {summary && summary.pending_candidates > 0 ? (
        <Link
          href="/discovery"
          className="flex items-center gap-3 rounded-[14px] bg-tint-sun px-5 py-3.5 text-[15px] text-ink transition-colors hover:bg-[#ffeeb0]"
        >
          <Icon name="discovery" className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            <span className="font-semibold">
              {summary.pending_candidates} suggested competitor{summary.pending_candidates === 1 ? "" : "s"}
            </span>{" "}
            waiting for a yes or no.
          </span>
          <Icon name="arrowRight" className="h-5 w-5 shrink-0" />
        </Link>
      ) : null}

      <section aria-labelledby="moved">
        <SectionLabel action={<LinkButton href="/alerts" variant="ghost" size="sm">All alerts</LinkButton>}>
          <span id="moved">What moved</span>
        </SectionLabel>
        {top ? (
          <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
            <MovementCard movement={top} featured />
            <div className="grid gap-3">
              {rest.slice(0, 3).map((movement) => (
                <MovementCard key={movement.id} movement={movement} />
              ))}
              {rest.length === 0 ? (
                <Card className="flex items-center p-5 text-[14px] text-ink-secondary">
                  Nothing else crossed the alert bar. Quiet is normal; Signal only alerts on corroborated moves.
                </Card>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState
            compact
            title="Nothing crossed the alert bar"
            note="Signal only raises an alert when several independent signals point the same way. Evidence is still being collected."
            action={<LinkButton href="/intel">Browse the evidence</LinkButton>}
          />
        )}
      </section>

      <section aria-labelledby="next">
        <SectionLabel action={<LinkButton href="/forecast" variant="ghost" size="sm">All forecasts</LinkButton>}>
          <span id="next">Resolving soonest</span>
        </SectionLabel>
        {forecasts === null ? (
          <ErrorState message="Forecasts didn't load. Refresh to try again." />
        ) : forecasts.length === 0 ? (
          <EmptyState
            compact
            title="No forecasts yet"
            note="A forecast is only written once enough independent evidence agrees. Most competitors spend most days below that bar."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {forecasts.map((forecast) => {
              const days = daysUntil(forecast.resolvesAt);
              return (
                <Link
                  key={forecast.id}
                  href={`/forecast/${forecast.id}`}
                  className="flex flex-col justify-between gap-4 rounded-[14px] border border-line bg-surface p-5 transition-colors hover:border-line-strong"
                >
                  <div>
                    <p className="text-[13px] font-semibold text-ink-muted">{forecast.competitor}</p>
                    <p className="mt-1 line-clamp-3 text-[15px] leading-snug font-semibold text-ink">{forecast.statement}</p>
                  </div>
                  <div className="flex items-end justify-between">
                    <span className="text-[13px] text-ink-muted">
                      {days > 0 ? `${days} day${days === 1 ? "" : "s"} · ${formatShortDate(forecast.resolvesAt)}` : "Due now"}
                    </span>
                    <Probability value={forecast.probability} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="pulse">
        <SectionLabel action={<LinkButton href="/board" variant="ghost" size="sm">All competitors</LinkButton>}>
          <span id="pulse">Competitor pulse</span>
        </SectionLabel>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pulse.map((item) => (
            <li key={item.id}>
              <Link
                href={`/radar/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-strong"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{item.name}</span>
                  <span className="block text-[13px] text-ink-muted">
                    {item.delta === null || item.delta === 0
                      ? "Steady this week"
                      : item.delta > 0
                        ? `Up ${item.delta} this week`
                        : `Down ${Math.abs(item.delta)} this week`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="metric block text-[26px]">{item.score ?? "—"}</span>
                  <span className="block text-[11.5px] text-ink-muted">activity</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function MovementCard({ movement, featured = false }: { movement: Movement; featured?: boolean }) {
  return (
    <Card as="article" className={featured ? "flex flex-col p-6" : "flex flex-col p-5"}>
      <div className="flex items-center justify-between gap-3">
        <Link href={`/radar/${movement.competitorId}`} className="text-[13.5px] font-bold text-ink hover:underline">
          {movement.competitor}
        </Link>
        <span className="text-[12.5px] text-ink-muted" suppressHydrationWarning>
          {relativeTime(movement.timestamp)}
        </span>
      </div>
      <h3 className={featured ? "mt-2 font-display text-[24px] leading-tight font-semibold text-ink" : "mt-1.5 text-[16px] font-semibold text-ink"}>
        {humanizePattern(movement.pattern)}
      </h3>
      <p className={featured ? "mt-2 text-[15px] leading-relaxed text-ink-secondary" : "mt-1 line-clamp-2 text-[14px] text-ink-secondary"}>
        {movement.detail}
      </p>
      {featured && movement.action ? (
        <p className="mt-4 rounded-[12px] bg-sky px-4 py-3 text-[14px] text-ink">
          <span className="font-semibold">Suggested: </span>
          {movement.action}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <button
          type="button"
          onClick={() =>
            askSignal(`What should we do about this ${movement.competitor} move: ${humanizePattern(movement.pattern)}?`)
          }
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-ink px-3 text-[13px] font-semibold text-white hover:bg-[#1d3047]"
        >
          <Icon name="chat" className="h-4 w-4" />
          Ask Signal about this
        </button>
        <span className="text-[12.5px] text-ink-muted">
          {Math.round(movement.confidence * 100)}% confidence
        </span>
      </div>
    </Card>
  );
}
