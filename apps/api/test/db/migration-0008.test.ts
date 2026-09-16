import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0008 company profile v2 + competitor discovery migration", () => {
  it("adds signal_goal fields, company_documents, and tracked_entities tables", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0008_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      '"company_profile" ADD COLUMN "signal_goal"',
      '"company_profile" ADD COLUMN "signal_goal_confidence"',
      '"company_profile" ADD COLUMN "signal_goal_inferred_at"',
      'CREATE TABLE "company_documents"',
      'CREATE TABLE "tracked_entities"',
      "company_documents_doc_type_check",
      "company_documents_extraction_status_check",
      "tracked_entities_relationship_type_check",
      "tracked_entities_source_check",
      "tracked_entities_status_check",
      "tracked_entities_competitor_id_when_confirmed_check",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
  });
});
