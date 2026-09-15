// Real-time signal feed — powers the Intel view's list. Filtering (source/quality/date) is
// the /intel page's job (Part 8); this component renders whatever list it's given and appends
// live updates. SignalCreatedPayload is too slim to render directly (see Task 2's comment),
// so a relevant event triggers router.refresh() instead of a client-side merge.
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Signal } from "@signal/shared";
import { SOURCE_COLORS } from "../lib/chart-colors";
import { onSignalCreated } from "../lib/socket";

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
