import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0018 news/docs/packages/field migration", () => {
  it("adds source config columns, widens the source check, and enables RLS", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0018_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      'ADD COLUMN "news_query" text',
      'ADD COLUMN "docs_sitemap_url" text',
      `ADD COLUMN "npm_packages" text[] DEFAULT '{}'::text[] NOT NULL`,
      `ADD COLUMN "pypi_packages" text[] DEFAULT '{}'::text[] NOT NULL`,
      "'postings', 'news', 'docs', 'packages', 'field')) NOT VALID",
      "ENABLE ROW LEVEL SECURITY",
      "schemaname = 'public'",
      "SET LOCAL lock_timeout = '5s';--> statement-breakpoint",
      "WHERE schemaname = 'public' AND NOT rowsecurity",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
    expect(sql.startsWith("SET LOCAL lock_timeout")).toBe(true);
  });
});
