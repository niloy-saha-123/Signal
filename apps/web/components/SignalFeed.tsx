// Real-time signal feed — powers the Intel view's list. Filtering (source/quality/date) is
// the /intel page's job (Part 8); this component renders whatever list it's given and appends
// live updates. SignalCreatedPayload is too slim to render directly (see Task 2's comment),
// so a relevant event triggers router.refresh() instead of a client-side merge.
"use client";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Signal } from "@signal/shared";
import { AskButton } from "./AskButton";
import { Icon } from "./ui/icons";
import { Badge, EmptyState, SourceChip } from "./ui/primitives";
import { sourceLabel } from "../lib/chart-colors";
import { relativeTime } from "../lib/format";
import { joinCompetitor, leaveCompetitor, onSignalCreated } from "../lib/socket";

export interface SignalFeedProps {
  signals: Signal[];
  competitorIds: string[];
  competitorNames?: Record<string, string>;
  emptyTitle?: string;
  emptyNote?: string;
  emptyAction?: React.ReactNode;
}

const STRONG = 0.8;

export function SignalFeed({
  signals,
  competitorIds,
  competitorNames = {},
  emptyTitle = "No evidence here yet",
  emptyNote = "New evidence appears here the moment Signal collects it.",
  emptyAction,
}: SignalFeedProps) {
  const router = useRouter();

  useEffect(() => {
    return onSignalCreated((payload) => {
      if (competitorIds.includes(payload.competitor_id)) {
        router.refresh();
      }
    });
  }, [competitorIds, router]);

  // A value key, not the array reference: router.refresh() (triggered by the effect above, on
  // every live signal:new) re-runs the Server Component parent, which produces a *new*
  // competitorIds array with the *same* ids. Keying this effect on the array reference would
  // leave-then-rejoin every room on every single live update — racing the very event that
  // triggered the refresh and dropping anything published mid-churn.
  const competitorIdsKey = useMemo(() => [...competitorIds].sort().join(","), [competitorIds]);

  // Keyed on the joined ids (not just mount/unmount) so a competitorIds prop change (e.g. the
  // Intel page's competitor filter) leaves stale rooms and joins the new set.
  useEffect(() => {
    const ids = competitorIdsKey === "" ? [] : competitorIdsKey.split(",");
    ids.forEach((id) => joinCompetitor(id));
    return () => {
      ids.forEach((id) => leaveCompetitor(id));
    };
  }, [competitorIdsKey]);

  if (signals.length === 0) {
    return <EmptyState compact title={emptyTitle} note={emptyNote} action={emptyAction} />;
  }

  return (
    <ul className="divide-y divide-line">
      {signals.map((signal) => {
        const competitor = competitorNames[signal.competitor_id];
        const title = signal.title || `${sourceLabel(signal.source)} update`;
        return (
          <li key={signal.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <SourceChip source={signal.source} submittedBy={signal.submitted_by} />
                {competitor ? <span className="text-[13px] font-bold text-ink">{competitor}</span> : null}
                <span className="text-[12.5px] text-ink-muted" suppressHydrationWarning>
                  {relativeTime(signal.collected_at)}
                </span>
                {signal.quality_score >= STRONG ? <Badge tone="hit">Strong</Badge> : null}
              </div>
              <p className="mt-1.5 text-[15px] leading-snug font-semibold break-words text-ink">
                {signal.source_url ? (
                  <a href={signal.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {title}
                    <Icon name="external" className="ml-1 inline h-3.5 w-3.5 text-ink-muted" />
                  </a>
                ) : (
                  title
                )}
              </p>
              <p className="mt-1 line-clamp-3 text-[14px] break-words text-ink-secondary">{signal.raw_text}</p>
            </div>
            <div className="shrink-0">
              <AskButton
                variant="ghost"
                label="Ask"
                prompt={`What does this mean${competitor ? ` for how ${competitor} competes with us` : ""}? "${title}" (${sourceLabel(signal.source)})`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
