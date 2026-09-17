// Three small multiples sharing one x-axis — mention volume, sentiment, and Signal Score have
// three different scales, so one multi-line chart would be a dual/triple-axis chart (the
// dataviz skill's #1 anti-pattern). Sentiment is a polarity metric (above/below zero), so it
// gets a diverging split-gradient fill, not a single categorical hue.
"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME, DIVERGING_COLORS, SEQUENTIAL_COLOR } from "../lib/chart-colors";

export interface TrendChartDataPoint {
  date: string;
  mention_volume: number;
  sentiment: number;
  score: number;
}

export interface TrendChartProps {
  data: TrendChartDataPoint[];
}

function sentimentGradientOffset(data: TrendChartDataPoint[]): number {
  const values = data.map((point) => point.sentiment);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

const axisProps = {
  stroke: CHART_CHROME.inkMuted,
  fontSize: 11,
  tickLine: false,
} as const;

export function TrendChart({ data }: TrendChartProps) {
  const sentimentOffset = sentimentGradientOffset(data);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-medium text-studio-muted">Mention volume</h3>
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid vertical={false} stroke={CHART_CHROME.gridline} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis width={32} {...axisProps} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="mention_volume"
                stroke={SEQUENTIAL_COLOR}
                fill={SEQUENTIAL_COLOR}
                fillOpacity={0.15}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-studio-muted">Sentiment</h3>
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="trendChartSentimentSplit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={sentimentOffset} stopColor={DIVERGING_COLORS.positive} stopOpacity={1} />
                  <stop offset={sentimentOffset} stopColor={DIVERGING_COLORS.negative} stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={CHART_CHROME.gridline} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis width={32} {...axisProps} />
              <ReferenceLine y={0} stroke={CHART_CHROME.baseline} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="sentiment"
                stroke="url(#trendChartSentimentSplit)"
                fill="url(#trendChartSentimentSplit)"
                fillOpacity={0.3}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-studio-muted">Signal Score</h3>
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid vertical={false} stroke={CHART_CHROME.gridline} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis domain={[0, 100]} width={32} {...axisProps} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="score"
                stroke={SEQUENTIAL_COLOR}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
