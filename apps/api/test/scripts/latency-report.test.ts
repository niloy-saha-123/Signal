import { describe, expect, it, vi } from "vitest";
import {
  collectLatencyReport,
  formatLatencyReport,
  runLatencyReport,
} from "../../scripts/latency-report";

const competitorA = "11111111-1111-4111-8111-111111111111";

describe("latency-report", () => {
  const latencyRows = [
    {
      agent_name: "synthesis",
      p50: 100,
      p95: 240,
      p99: 300,
      mean: 125.5,
      sample_count: 5,
      failed_count: 1,
      run_count: 5,
    },
    {
      agent_name: "chat_agent",
      p50: null,
      p95: null,
      p99: null,
      mean: null,
      sample_count: 0,
      failed_count: 0,
      run_count: 0,
    },
  ];
  const costRows = [
    {
      competitor_id: competitorA,
      day: "2026-09-10",
      cost_usd: 0.123456,
    },
  ];

  it("collects one bounded report and derives failure rates", async () => {
    const getAgentLatencyReport = vi.fn(async () => latencyRows);
    const getCostByCompetitorDay = vi.fn(async () => costRows);

    const report = await collectLatencyReport(14, {
      getAgentLatencyReport,
      getCostByCompetitorDay,
    });

    expect(getAgentLatencyReport).toHaveBeenCalledWith(14);
    expect(getCostByCompetitorDay).toHaveBeenCalledWith(14);
    expect(report).toEqual({
      window_days: 14,
      agents: [
        {
          ...latencyRows[1],
          failure_rate: 0,
        },
        {
          ...latencyRows[0],
          failure_rate: 0.2,
        },
      ],
      costs: costRows,
    });
  });

  it("formats stable JSON for programmatic consumers", async () => {
    const output = await runLatencyReport(["--days=14", "--format=json"], {
      getAgentLatencyReport: async () => latencyRows,
      getCostByCompetitorDay: async () => costRows,
    });

    expect(JSON.parse(output)).toEqual({
      window_days: 14,
      agents: [
        { ...latencyRows[1], failure_rate: 0 },
        { ...latencyRows[0], failure_rate: 0.2 },
      ],
      costs: costRows,
    });
  });

  it("formats a readable Markdown report with explicit no-data markers", () => {
    const output = formatLatencyReport(
      {
        window_days: 7,
        agents: [
          {
            ...latencyRows[1],
            failure_rate: 0,
          },
          {
            ...latencyRows[0],
            failure_rate: 0.2,
          },
        ],
        costs: costRows,
      },
      "table"
    );

    expect(output).toContain("# Signal latency report — last 7 days");
    expect(output).toContain("| chat_agent | — | — | — | — | 0 | 0.00% |");
    expect(output).toContain("| synthesis | 100 ms | 240 ms | 300 ms | 125.50 ms | 5 | 20.00% |");
    expect(output).toContain(`| 2026-09-10 | ${competitorA} | $0.123456 |`);
  });

  it("renders empty sections honestly instead of fabricating zero-valued measurements", () => {
    expect(
      formatLatencyReport({ window_days: 7, agents: [], costs: [] }, "table")
    ).toContain("No latency samples were recorded in this window.");
  });

  it("rejects unsupported arguments through the shared CLI parser", async () => {
    await expect(
      runLatencyReport(["--days=7", "--format=csv"], {
        getAgentLatencyReport: async () => [],
        getCostByCompetitorDay: async () => [],
      })
    ).rejects.toThrow("Invalid enum value");
  });
});
