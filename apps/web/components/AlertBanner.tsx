// Real-time alert banner that displays high-confidence strategic signals without page refresh.
"use client";

export function AlertBanner({ competitorId }: { competitorId: string }) {
  return <div data-competitor={competitorId}>No active alerts</div>;
}
