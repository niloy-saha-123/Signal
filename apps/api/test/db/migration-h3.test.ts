import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("H3 forward migration", () => {
  it("contains telemetry identity constraints, all advisor indexes, and the function privilege revoke", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0006_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      'ALTER TABLE "agent_latencies" ALTER COLUMN "run_id" DROP NOT NULL',
      'ADD COLUMN "job_id" text',
      'agent_latencies_identity_check',
      'agent_latencies_job_id_idx',
      'agent_runs_prompt_version_id_idx',
      'alerts_run_id_idx',
      'llm_costs_run_id_idx',
      'llm_costs_job_id_idx',
      'pricing_diffs_baseline_id_idx',
      'rag_eval_dataset_competitor_id_idx',
      "to_regprocedure('public.rls_auto_enable()')",
      "REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC",
      "rolname = 'anon'",
      "rolname = 'authenticated'",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
    expect(sql).not.toMatch(/^REVOKE EXECUTE ON FUNCTION public\.rls_auto_enable\(\)/m);
  });
});
