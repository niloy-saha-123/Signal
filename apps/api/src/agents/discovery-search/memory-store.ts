// Long-term, cross-thread memory for things Signal *infers and corrects
// over time* — as opposed to company_profile/company_documents, which are
// directly-stated facts. Backed by LangGraph's PostgresStore so the same
// primitive that gives chat its checkpointed memory (Task in Phase 2) also
// gives Signal a durable place to remember "we guessed X, user said Y."
//
// `PostgresStore` lives on the package's "./store" subpath, not its root
// export (the root only exports the checkpointer, `PostgresSaver`).
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { loadRootEnv } from "../../lib/env";

loadRootEnv();

let store: PostgresStore | undefined;

// PostgresStore defaults `ensureTables` to true, so `.get()`/`.put()` lazily
// call `.setup()` themselves on first use — no explicit setup() call needed
// here (unlike PostgresSaver, the checkpointer, which does require one).
export function getMemoryStore(): PostgresStore {
  if (!store) {
    store = PostgresStore.fromConnString(process.env.DATABASE_URL!);
  }
  return store;
}

// PostgresStore.put()'s value param is Record<string, unknown> — an index
// signature is required for these to satisfy it structurally.
interface RelationshipMemory {
  relationship_type: string;
  confidence: number;
  [key: string]: unknown;
}

interface SignalGoalMemory {
  goal: string;
  confidence: number;
  [key: string]: unknown;
}

export async function getRelationshipMemory(
  workspaceId: string,
  competitorId: string
): Promise<RelationshipMemory | null> {
  const item = await getMemoryStore().get(["relationships", workspaceId], competitorId);
  return (item?.value as RelationshipMemory | undefined) ?? null;
}

export async function setRelationshipMemory(
  workspaceId: string,
  competitorId: string,
  value: RelationshipMemory
): Promise<void> {
  await getMemoryStore().put(["relationships", workspaceId], competitorId, value);
}

export async function getSignalGoalMemory(workspaceId: string): Promise<SignalGoalMemory | null> {
  const item = await getMemoryStore().get(["signal_goal"], workspaceId);
  return (item?.value as SignalGoalMemory | undefined) ?? null;
}

export async function setSignalGoalMemory(
  workspaceId: string,
  value: SignalGoalMemory
): Promise<void> {
  await getMemoryStore().put(["signal_goal"], workspaceId, value);
}
