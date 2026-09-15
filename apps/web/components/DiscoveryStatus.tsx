// apps/web/components/DiscoveryStatus.tsx
// Polls GET /api/competitors/:id/discovery every 3s until discovery_status settles. A
// client-side polling exception to "Server Components fetch once" — same footing as
// SignalFeed/AlertBanner's Socket.io exception (see 00-overview.md's Discovered Gaps).
"use client";
import { useEffect, useState } from "react";
import { getCompetitorDiscovery, type CompetitorDiscovery } from "../lib/api";
import type { DiscoveryLog } from "@signal/shared";

export interface DiscoveryStatusProps {
  competitorId: string;
  pollIntervalMs?: number;
  onManualEntry?: (fieldName: DiscoveryLog["field_name"]) => void;
}

const FIELD_LABELS: Record<DiscoveryLog["field_name"], string> = {
  subreddits: "Subreddits",
  greenhouse: "Greenhouse",
  lever: "Lever",
  pricing_url: "Pricing URL",
  rss_url: "RSS feed",
};

const SETTLED_STATUSES = new Set(["complete", "failed"]);

export function DiscoveryStatus({
  competitorId,
  pollIntervalMs = 3000,
  onManualEntry,
}: DiscoveryStatusProps) {
  const [discovery, setDiscovery] = useState<CompetitorDiscovery | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function poll() {
      const result = await getCompetitorDiscovery(competitorId);
      if (cancelled) return;
      setDiscovery(result);
      if (SETTLED_STATUSES.has(result.discovery_status) && timer) {
        clearInterval(timer);
      }
    }

    void poll();
    timer = setInterval(() => void poll(), pollIntervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [competitorId, pollIntervalMs]);

  if (!discovery) {
    return <p className="text-sm text-slate-500">Checking discovery status…</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {discovery.log.map((entry) => (
        <li key={entry.field_name} className="flex items-center gap-2 text-sm">
          <span className="text-slate-700">{FIELD_LABELS[entry.field_name]}</span>
          {entry.status === "found" ? (
            <span className="text-emerald-600">✓</span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600">
              <span>
                ✗{" "}
                {entry.status === "not_found"
                  ? "(not found — enter manually)"
                  : `(${entry.error_message ?? "error"})`}
              </span>
              {onManualEntry ? (
                <button
                  type="button"
                  onClick={() => onManualEntry(entry.field_name)}
                  className="text-xs text-indigo-600 underline"
                  aria-label={`Enter ${entry.field_name} manually`}
                >
                  Enter manually
                </button>
              ) : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
