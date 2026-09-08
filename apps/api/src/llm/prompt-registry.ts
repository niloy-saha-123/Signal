// Fetches the active prompt version per agent. The DB enforces at most one
// is_active=true row per agent_name (prompt_versions_one_active_per_agent_idx,
// a partial unique index) — this function just reads whichever one exists.
import { and, eq } from "drizzle-orm";
import type { AgentName } from "@signal/shared";
import { db } from "../db/client";
import { promptVersionsTable } from "../db/schema";

export async function getActivePrompt(agentName: AgentName): Promise<string | null> {
  const rows = await db
    .select({ prompt_text: promptVersionsTable.prompt_text })
    .from(promptVersionsTable)
    .where(
      and(eq(promptVersionsTable.agent_name, agentName), eq(promptVersionsTable.is_active, true))
    )
    .limit(1);

  return rows.length > 0 ? rows[0].prompt_text : null;
}
