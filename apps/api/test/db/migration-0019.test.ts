import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0019 blog/social migration", () => {
  it("adds source config columns, widens the source check, and enables RLS", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0019_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      `ADD COLUMN "blog_feeds" text[] DEFAULT '{}'::text[] NOT NULL`,
      `ADD COLUMN "social_feeds" text[] DEFAULT '{}'::text[] NOT NULL`,
      `ADD COLUMN "forum_feeds" text[] DEFAULT '{}'::text[] NOT NULL`,
      'ADD COLUMN "bluesky_handle" text',
      'ADD COLUMN "stackoverflow_tag" text',
      'ADD COLUMN "links_scanned_at" timestamp with time zone',
      "'field', 'blog', 'social')) NOT VALID",
      "ENABLE ROW LEVEL SECURITY",
      "SET LOCAL lock_timeout = '5s';--> statement-breakpoint",
      "AND NOT rowsecurity",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
    expect(sql.startsWith("SET LOCAL lock_timeout")).toBe(true);
  });
});
