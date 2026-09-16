import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0007 workspace auth migration", () => {
  it("creates workspace tables, scopes competitors/company_profile, and adds the token hook", async () => {
    const drizzleDir = resolve(process.cwd(), "drizzle");
    const migrationName = (await readdir(drizzleDir)).find((name) => name.startsWith("0007_"));
    expect(migrationName).toBeDefined();
    const sql = await readFile(resolve(drizzleDir, migrationName!), "utf8");

    for (const requiredFragment of [
      'CREATE TABLE "workspaces"',
      'CREATE TABLE "workspace_members"',
      'CREATE TABLE "workspace_invites"',
      "workspace_members_user_id_idx",
      'ADD COLUMN "workspace_id"',
      "competitors_workspace_domain_idx",
      "company_profile_workspace_idx",
      "custom_access_token_hook",
      "GRANT EXECUTE ON FUNCTION public.custom_access_token_hook",
    ]) {
      expect(sql).toContain(requiredFragment);
    }
  });
});
