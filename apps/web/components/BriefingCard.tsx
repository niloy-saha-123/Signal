// Morning briefing card — one of the day's top 3 competitive movements: event summary,
// evidence count, recommended action, one-click action button.
"use client";

export interface BriefingCardProps {
  summary: string;
  evidenceCount: number;
  recommendedAction: string;
  onAction: () => void;
  actionLabel?: string;
}

export function BriefingCard({
  summary,
  evidenceCount,
  recommendedAction,
  onAction,
  actionLabel = "Take action",
}: BriefingCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-900">{summary}</p>
      <p className="mt-1 text-xs text-slate-500">
        {evidenceCount} {evidenceCount === 1 ? "piece" : "pieces"} of evidence
      </p>
      <p className="mt-3 text-sm font-medium text-slate-700">{recommendedAction}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
      >
        {actionLabel}
      </button>
    </div>
  );
}
