import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  agentLatenciesTable,
  agentRunsTable,
  alertsTable,
  llmCostsTable,
  pricingDiffsTable,
  ragEvalDatasetTable,
} from "@/db/schema";

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes
    .map((item) => item.config.name)
    .filter((name): name is string => name !== undefined);
}

describe("H3 database hardening schema", () => {
  it("supports either durable run or queue-job latency attribution", () => {
    const config = getTableConfig(agentLatenciesTable);
    expect(agentLatenciesTable.run_id.notNull).toBe(false);
    expect(agentLatenciesTable.job_id.notNull).toBe(false);
    expect(config.checks.map((item) => item.name)).toContain("agent_latencies_identity_check");
    expect(indexNames(agentLatenciesTable)).toEqual(
      expect.arrayContaining(["agent_latencies_run_id_idx", "agent_latencies_job_id_idx"])
    );
  });

  it("allows standalone costs while indexing both attribution paths", () => {
    expect(llmCostsTable.run_id.notNull).toBe(false);
    expect(llmCostsTable.job_id.notNull).toBe(false);
    expect(indexNames(llmCostsTable)).toEqual(
      expect.arrayContaining(["llm_costs_run_id_idx", "llm_costs_job_id_idx"])
    );
  });

  it("indexes every foreign key reported by the production advisor", () => {
    expect(indexNames(agentRunsTable)).toContain("agent_runs_prompt_version_id_idx");
    expect(indexNames(alertsTable)).toContain("alerts_run_id_idx");
    expect(indexNames(pricingDiffsTable)).toContain("pricing_diffs_baseline_id_idx");
    expect(indexNames(ragEvalDatasetTable)).toContain("rag_eval_dataset_competitor_id_idx");
  });
});
