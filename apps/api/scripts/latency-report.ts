// Queries run- and job-attributed agent_latencies plus all llm_costs (including
// legitimate unattributed standalone calls) and emits the same aggregate report.
import { z } from "zod";
import {
  getAgentLatencyReport,
  getCostByCompetitorDay,
  type AgentLatencyReportRow,
  type CostByCompetitorDayRow,
} from "../src/db/queries";
import { closeDatabase } from "../src/db/client";
import { parseCliArgs, runCli } from "./lib/cli";

const LatencyReportOptionsSchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).default(7),
    format: z.enum(["table", "json"]).default("table"),
  })
  .strict();

type LatencyReportFormat = z.infer<typeof LatencyReportOptionsSchema>["format"];

export type LatencyReportDeps = {
  getAgentLatencyReport: (days: number) => Promise<AgentLatencyReportRow[]>;
  getCostByCompetitorDay: (days: number) => Promise<CostByCompetitorDayRow[]>;
};

export type LatencyReportAgentRow = AgentLatencyReportRow & {
  failure_rate: number;
};

export type LatencyReport = {
  window_days: number;
  agents: LatencyReportAgentRow[];
  costs: CostByCompetitorDayRow[];
};

const defaultDeps: LatencyReportDeps = {
  getAgentLatencyReport,
  getCostByCompetitorDay,
};

export async function collectLatencyReport(
  days: number,
  deps: LatencyReportDeps = defaultDeps
): Promise<LatencyReport> {
  const [latencyRows, costRows] = await Promise.all([
    deps.getAgentLatencyReport(days),
    deps.getCostByCompetitorDay(days),
  ]);

  return {
    window_days: days,
    agents: latencyRows
      .map((row) => ({
        ...row,
        failure_rate: row.run_count === 0 ? 0 : row.failed_count / row.run_count,
      }))
      .sort((left, right) => left.agent_name.localeCompare(right.agent_name)),
    costs: [...costRows].sort(
      (left, right) =>
        right.day.localeCompare(left.day) ||
        (left.competitor_id ?? "unattributed").localeCompare(
          right.competitor_id ?? "unattributed"
        )
    ),
  };
}

function milliseconds(value: number | null): string {
  if (value === null) return "—";
  return `${Number.isInteger(value) ? value.toString() : value.toFixed(2)} ms`;
}

export function formatLatencyReport(
  report: LatencyReport,
  format: LatencyReportFormat
): string {
  if (format === "json") return JSON.stringify(report, null, 2);

  const lines = [`# Signal latency report — last ${report.window_days} days`, ""];
  if (report.agents.length === 0) {
    lines.push("No latency samples were recorded in this window.");
  } else {
    lines.push(
      "| Agent | P50 | P95 | P99 | Mean | Samples | Failure rate |",
      "|---|---:|---:|---:|---:|---:|---:|",
      ...report.agents.map(
        (row) =>
          `| ${row.agent_name} | ${milliseconds(row.p50)} | ${milliseconds(row.p95)} | ${milliseconds(row.p99)} | ${milliseconds(row.mean)} | ${row.sample_count} | ${(row.failure_rate * 100).toFixed(2)}% |`
      )
    );
  }

  lines.push("", "## LLM cost by competitor and UTC day", "");
  if (report.costs.length === 0) {
    lines.push("No LLM costs were recorded in this window.");
  } else {
    lines.push(
      "| Day | Competitor | Cost (USD) |",
      "|---|---|---:|",
      ...report.costs.map(
        (row) =>
          `| ${row.day} | ${row.competitor_id ?? "unattributed"} | $${row.cost_usd.toFixed(6)} |`
      )
    );
  }
  return lines.join("\n");
}

export async function runLatencyReport(
  argv: string[],
  deps: LatencyReportDeps = defaultDeps
): Promise<string> {
  const options = parseCliArgs(argv, LatencyReportOptionsSchema);
  const report = await collectLatencyReport(options.days, deps);
  return formatLatencyReport(report, options.format);
}

if (require.main === module) {
  void runCli(
    async () => {
      console.log(await runLatencyReport(process.argv.slice(2)));
    },
    closeDatabase
  ).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
