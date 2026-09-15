// Real-time signal feed — powers the Intel view's list. Filtering (source/quality/date) is
// the /intel page's job (Part 8); this component renders whatever list it's given and appends
// live updates. SignalCreatedPayload is too slim to render directly (see Task 2's comment),
// so a relevant event triggers router.refresh() instead of a client-side merge.
"use client";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Signal } from "@signal/shared";
import { SOURCE_COLORS } from "../lib/chart-colors";
import { joinCompetitor, leaveCompetitor, onSignalCreated } from "../lib/socket";

export interface SignalFeedProps {
  signals: Signal[];
  competitorIds: string[];
}

export function SignalFeed({ signals, competitorIds }: SignalFeedProps) {
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
    return <p className="text-sm text-slate-500">No signals yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {signals.map((signal) => (
        <li
          key={signal.id}
          className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3"
        >
          <span
            className="mt-1 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: SOURCE_COLORS[signal.source] }}
            aria-label={signal.source}
          />
          <div>
            {signal.title ? (
              <p className="text-sm font-medium text-slate-900">{signal.title}</p>
            ) : null}
            <p className="text-sm text-slate-600">{signal.raw_text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
