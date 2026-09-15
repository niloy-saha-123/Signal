// apps/web/components/HiringChart.tsx
// Diverging horizontal bar chart for department hiring deltas — the dataviz skill's
// "above/below a baseline" job, not a categorical-per-department encoding. Horizontal because
// department names are long.
"use client";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME, DIVERGING_COLORS } from "../lib/chart-colors";

export interface HiringChartDataPoint {
  department: string;
  delta: number;
}

export interface HiringChartProps {
  data: HiringChartDataPoint[];
}

export function HiringChart({ data }: HiringChartProps) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <XAxis type="number" stroke={CHART_CHROME.inkMuted} fontSize={11} tickLine={false} />
          <YAxis
            type="category"
            dataKey="department"
            stroke={CHART_CHROME.inkMuted}
            fontSize={11}
            tickLine={false}
            width={100}
          />
          <ReferenceLine x={0} stroke={CHART_CHROME.baseline} />
          <Tooltip />
          <Bar dataKey="delta" isAnimationActive={false}>
            {data.map((entry) => (
              <Cell
                key={entry.department}
                fill={entry.delta >= 0 ? DIVERGING_COLORS.positive : DIVERGING_COLORS.negative}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
