import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0012 company_goals migration", () => {
  it("adds the company_goals table with workspace FK, checks, and index", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0012_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      'CREATE TABLE "company_goals"',
      '"content" text NOT NULL',
      '"created_by" text NOT NULL',
      'IN (\'user\', \'agent\')',
      'IN (\'active\', \'archived\')',
      'REFERENCES "public"."workspaces"("id") ON DELETE cascade',
      "company_goals_workspace_id_idx",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
  });
});