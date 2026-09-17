import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0010 is_own_company migration", () => {
  it("adds the is_own_company boolean column defaulting to false", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0010_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      'ALTER TABLE "competitors" ADD COLUMN "is_own_company"',
      "boolean",
      "DEFAULT false",
      "NOT NULL",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
  });
});