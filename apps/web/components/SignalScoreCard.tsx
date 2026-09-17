// apps/web/components/SignalScoreCard.tsx
// Stat tile: a competitor's current Signal Score, its 7-day delta, and a 30-day sparkline.
// Signal Score is a competitor THREAT score — a rising score means more competitor activity/
// threat (bad for the user), falling means less (good). See lib/chart-colors.ts's
// SCORE_DELTA_COLORS comment; do not invert this to the usual "up = green" convention.
"use client";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { CHART_CHROME, SCORE_DELTA_COLORS } from "../lib/chart-colors";

export interface SignalScoreCardProps {
  competitorName: string;
  score: number;
  delta7d: number | null;
  history: Array<{ date: string; score: number }>;
}

interface DeltaMark {
  glyph: string;
  color: string;
  label: string;
}

function deltaMark(delta: number | null): DeltaMark {
  if (delta === null || delta === 0) {
    return { glyph: "–", color: CHART_CHROME.inkMuted, label: "no change" };
  }
  if (delta > 0) {
    return { glyph: "▲", color: SCORE_DELTA_COLORS.rising, label: `${delta.toFixed(1)} (7d)` };
  }
  return {
    glyph: "▼",
    color: SCORE_DELTA_COLORS.falling,
    label: `${Math.abs(delta).toFixed(1)} (7d)`,
  };
}

export function SignalScoreCard({ competitorName, score, delta7d, history }: SignalScoreCardProps) {
  const mark = deltaMark(delta7d);

  return (
    <div className="rounded-2xl border border-studio-line bg-studio-paper p-4">
      <p className="text-sm font-medium text-studio-muted">{competitorName}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-studio-ink">{score}</span>
        <span className="flex items-baseline gap-1 text-sm tabular-nums text-studio-muted">
          <span style={{ color: mark.color }}>{mark.glyph}</span>
          <span>{mark.label}</span>
        </span>
      </div>
      {history.length > 0 ? (
        <div className="mt-3 h-10 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <Line
                type="monotone"
                dataKey="score"
                stroke={CHART_CHROME.inkSecondary}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}
