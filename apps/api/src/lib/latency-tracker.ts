// Latency tracker — records per-agent timing for every analysis graph run and every ChatAgent request.
//
// Usage: wrap any agent execution with trackLatency(agentName, competitorId, runId, fn). The
// wrapper records start time, calls fn(), records end time, computes duration_ms, and writes a row
// to the agent_latencies table (see db/schema.ts).
//
// Also exports computePercentiles(agentName, days), which queries agent_latencies and returns
// { p50, p95, p99, mean, sample_count } for a given agent over the last N days. Percentile
// computation uses the nearest-rank method on sorted duration_ms values.
//
// This data populates the latency budget table shown in the README (generated via
// scripts/latency-report.ts) — measured values, not estimates.
import { and, eq, gte } from "drizzle-orm";
import type { AgentName, LatencyRecord } from "@signal/shared";
import { db } from "../db/client";
import { agentLatenciesTable } from "../db/schema";
import { logger } from "./logger";

export async function trackLatency<T>(
  agentName: AgentName,
  competitorId: string,
  runId: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await fn();
    const completedAt = new Date();
    try {
      await db.insert(agentLatenciesTable).values({
        run_id: runId,
        competitor_id: competitorId,
        agent_name: agentName,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        status: "success",
      });
    } catch (insertError) {
      logger.error("Failed to write agent_latencies row (success)", {
        agentName,
        runId,
        error: insertError,
      });
    }
    return result;
  } catch (error) {
    const completedAt = new Date();
    try {
      await db.insert(agentLatenciesTable).values({
        run_id: runId,
        competitor_id: competitorId,
        agent_name: agentName,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        status: "failed",
      });
    } catch (insertError) {
      logger.error("Failed to write agent_latencies row (failed)", {
        agentName,
        runId,
        error: insertError,
      });
    }
    throw error;
  }
}

// Nearest-rank percentile on sorted duration_ms values over the last `days` days.
export async function computePercentiles(
  agentName: AgentName,
  days: number
): Promise<LatencyRecord> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ duration_ms: agentLatenciesTable.duration_ms })
    .from(agentLatenciesTable)
    .where(
      and(
        gte(agentLatenciesTable.created_at, since),
        eq(agentLatenciesTable.agent_name, agentName)
      )
    );

  const durations = rows
    .map((row) => row.duration_ms)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return { agent_name: agentName, p50: 0, p95: 0, p99: 0, mean: 0, sample_count: 0 };
  }

  const rank = (p: number) => durations[Math.min(durations.length - 1, Math.ceil(p * durations.length) - 1)];
  const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;

  return {
    agent_name: agentName,
    p50: rank(0.5),
    p95: rank(0.95),
    p99: rank(0.99),
    mean,
    sample_count: durations.length,
  };
}
