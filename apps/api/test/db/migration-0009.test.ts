import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0009 chat_threads migration", () => {
  it("adds the chat_threads metadata table with workspace FK + index", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0009_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      'CREATE TABLE "chat_threads"',
      '"title" text',
      'REFERENCES "public"."workspaces"("id") ON DELETE cascade',
      "chat_threads_workspace_id_idx",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
  });
});