// Runs against the local docker-compose Postgres (docker-compose.yml's
// `postgres` service, localhost:5433) — never the Supabase project that
// process.env.DATABASE_URL points to for the rest of the app. Set before
// importing memory-store so its loadRootEnv() call (which never overwrites
// an already-set var) can't put the Supabase URL back.
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { afterAll, describe, expect, it } from "vitest";
import {
  getMemoryStore,
  getRelationshipMemory,
  setRelationshipMemory,
} from "../../../src/agents/discovery-search/memory-store";

describe("memory-store", () => {
  const workspaceId = "11111111-1111-1111-1111-111111111111";
  const competitorId = "22222222-2222-2222-2222-222222222222";

  afterAll(async () => {
    await getMemoryStore().stop();
  });

  it("round-trips a relationship-type inference", async () => {
    await setRelationshipMemory(workspaceId, competitorId, {
      relationship_type: "aspirational",
      confidence: 0.7,
    });
    const result = await getRelationshipMemory(workspaceId, competitorId);
    expect(result).toEqual({ relationship_type: "aspirational", confidence: 0.7 });
  });

  it("returns null for a workspace/competitor pair with no stored memory", async () => {
    const result = await getRelationshipMemory(workspaceId, "33333333-3333-3333-3333-333333333333");
    expect(result).toBeNull();
  });
});
