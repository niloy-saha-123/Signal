// A competitor's activity score (internally the Signal Score), its 7-day change,
// and a sparkline. It is a THREAT score: rising means the competitor is doing more
// (bad for the user), falling means less. See lib/chart-colors.ts's
// SCORE_DELTA_COLORS; do not invert this to the usual "up = green" convention.
"use client";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { weeklyChange } from "./competitors/parts";
import { CHART_CHROME, SCORE_DELTA_COLORS } from "../lib/chart-colors";

export interface SignalScoreCardProps {
  score: number;
  delta7d: number | null;
  history: Array<{ date: string; score: number }>;
}

function deltaMark(delta: number | null): { glyph: string; color: string } {
  const rounded = delta === null ? 0 : Math.round(delta);
  if (rounded === 0) return { glyph: "–", color: CHART_CHROME.inkMuted };
  return rounded > 0
    ? { glyph: "▲", color: SCORE_DELTA_COLORS.rising }
    : { glyph: "▼", color: SCORE_DELTA_COLORS.falling };
}

export function SignalScoreCard({ score, delta7d, history }: SignalScoreCardProps) {
  const mark = deltaMark(delta7d);

  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-secondary">Activity score</p>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="metric text-[56px]">{score}</span>
        <span className="flex items-baseline gap-1 text-[13.5px] font-medium text-ink-secondary">
          <span style={{ color: mark.color }} aria-hidden="true">
            {mark.glyph}
          </span>
          <span>{weeklyChange(delta7d)}</span>
        </span>
      </div>
      {history.length > 1 ? (
        <div className="mt-3 h-12 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <Line
                type="monotone"
                dataKey="score"
                stroke={CHART_CHROME.inkPrimary}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <p className="mt-3 text-[13px] text-ink-muted">
        0 to 100. How much this competitor is doing across every source Signal watches. Higher means busier.
      </p>
    </div>
  );
}
