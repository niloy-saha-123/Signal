// apps/web/components/DiscoveryStatus.tsx
// Polls GET /api/competitors/:id/discovery every 3s until discovery_status settles. A
// client-side polling exception to "Server Components fetch once" — same footing as
// SignalFeed/AlertBanner's Socket.io exception (see 00-overview.md's Discovered Gaps).
"use client";
import { useEffect, useState } from "react";
import { getCompetitorDiscovery, type CompetitorDiscovery } from "../lib/api";
import type { DiscoveryLog } from "@signal/shared";
import { Icon } from "./ui/icons";

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
  github_org: "GitHub org",
  website_urls: "Website pages",
  discourse_url: "Community forum",
  postings_rss: "Newsroom feed",
};

const SETTLED_STATUSES = new Set(["complete", "failed"]);

export function DiscoveryStatus({
  competitorId,
  pollIntervalMs = 3000,
  onManualEntry,
}: DiscoveryStatusProps) {
  const [discovery, setDiscovery] = useState<CompetitorDiscovery | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function poll() {
      try {
        const result = await getCompetitorDiscovery(competitorId);
        if (cancelled) return;
        setDiscovery(result);
        setFailed(false);
        if (SETTLED_STATUSES.has(result.discovery_status) && timer) {
          clearInterval(timer);
        }
      } catch {
        if (!cancelled) setFailed(true);
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
    return (
      <p className="text-[13.5px] text-ink-muted" aria-live="polite">
        {failed ? "Couldn't check discovery right now. Retrying." : "Checking which sources were found…"}
      </p>
    );
  }

  return (
    <ul className="space-y-2" aria-live="polite">
      {discovery.log.map((entry) => {
        const label = FIELD_LABELS[entry.field_name];
        const found = entry.status === "found";
        return (
          <li key={entry.field_name} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
            <span className="font-medium text-ink">{label}</span>
            {found ? (
              <span className="inline-flex items-center gap-1 font-semibold text-outcome-hit">
                <Icon name="check" className="h-3.5 w-3.5" />
                Found
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-ink-muted">
                {entry.status === "not_found" ? "Not found" : (entry.error_message ?? "Couldn't check")}
                {onManualEntry ? (
                  <button
                    type="button"
                    onClick={() => onManualEntry(entry.field_name)}
                    className="font-semibold text-accent hover:underline"
                    aria-label={`Enter ${label} manually`}
                  >
                    Enter it
                  </button>
                ) : null}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
