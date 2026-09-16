// LangGraph agent that proposes new competitors from the open web. Every
// candidate lands in tracked_entities with status='candidate' — promotion
// to 'confirmed' happens only through the interrupt() resume path below,
// triggered by an explicit user action (never by this graph on its own).
//
// Fixed 2-node graph (search → confirm), NOT a ReAct tool loop: the search
// node makes a single Tavily call and asks the model for up to MAX_TOOL_CALLS
// candidate entities, then the confirm node gates each one behind interrupt().
import {
  StateGraph,
  Annotation,
  START,
  END,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { TavilySearch } from "@langchain/tavily";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { getCompanyContext } from "../../lib/company-context";
import { createTrackedEntityCandidate } from "../../db/queries";
import { selectModel, ANTHROPIC_MODEL_IDS } from "../../llm/adaptive-router";
import { loadRootEnv } from "../../lib/env";

loadRootEnv();

const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;
const MAX_TOOL_CALLS = 5;
const RECURSION_LIMIT = 15;

const DiscoveryGraphState = Annotation.Root({
  workspace_id: Annotation<string>(),
  candidates: Annotation<{ name: string; domain: string; reason: string }[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
});

const CandidatesSchema = z.object({
  candidates: z.array(
    z.object({ name: z.string(), domain: z.string(), reason: z.string() })
  ),
});

const RETRY_POLICY = {
  maxAttempts: 3,
  retryOn: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return /429|5\d\d|timeout/i.test(message);
  },
};

async function searchNode(
  state: typeof DiscoveryGraphState.State
): Promise<Partial<typeof DiscoveryGraphState.State>> {
  const companyContext = await getCompanyContext(state.workspace_id);
  const tavily = new TavilySearch({ maxResults: MAX_TOOL_CALLS });

  // "claude-sonnet"/"claude-haiku" are internal routing aliases, not Anthropic
  // API model strings — translate the alias selectModel hands back through
  // ANTHROPIC_MODEL_IDS before handing it to ChatAnthropic.
  const alias = await selectModel("claude-sonnet", true);
  const model = new ChatAnthropic({
    model: ANTHROPIC_MODEL_IDS[alias] ?? alias,
    clientOptions: { timeout: LLM_TIMEOUT_MS },
    maxRetries: LLM_MAX_RETRIES,
  }).withStructuredOutput(CandidatesSchema, { includeRaw: true });

  const searchResults = await tavily.invoke({
    query: `companies competing with: ${companyContext.slice(0, 500)}`,
  });

  const result = await model.invoke([
    {
      role: "system",
      content:
        "Given this company's profile and web search results, propose up to 5 real " +
        "competitor candidates with their domain and a one-sentence reason each. " +
        "Only propose companies that genuinely compete for the same customers.",
    },
    { role: "user", content: `Company:\n${companyContext}\n\nSearch results:\n${searchResults}` },
  ]);

  if (!result.parsed) return { candidates: [] };
  return { candidates: result.parsed.candidates };
}

async function confirmNode(
  state: typeof DiscoveryGraphState.State
): Promise<Partial<typeof DiscoveryGraphState.State>> {
  for (const candidate of state.candidates) {
    // Pauses graph execution here until a human resumes it — the actual
    // HITL gate. Nothing below this line runs until the resume value
    // arrives from POST /api/discovery/:threadId/resume (Task 9).
    const decision = interrupt({ type: "confirm_candidate", candidate });
    if (decision === "confirm") {
      await createTrackedEntityCandidate({
        workspace_id: state.workspace_id,
        candidate_name: candidate.name,
        candidate_domain: candidate.domain,
        candidate_reason: candidate.reason,
        source: "discovered",
        status: "candidate",
      });
    }
  }
  return {};
}

const builder = new StateGraph(DiscoveryGraphState)
  .addNode("search", searchNode, { retryPolicy: RETRY_POLICY })
  .addNode("confirm", confirmNode)
  .addEdge(START, "search")
  .addEdge("search", "confirm")
  .addEdge("confirm", END);

// PostgresSaver does NOT auto-create its tables (unlike PostgresStore), so the
// worker must call setupDiscoveryCheckpointer() before its first invoke — see
// Ruling B. The PostgresSaver is built eagerly at import (see compile() below),
// but it is a thin handle: pg.Pool defers its connection until .setup()/first
// invoke, so importing this module never throws or opens a connection when
// DATABASE_URL is unset.
let checkpointer: PostgresSaver | undefined;

export function getDiscoveryCheckpointer(): PostgresSaver {
  if (!checkpointer) {
    checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  }
  return checkpointer;
}

let setupPromise: Promise<void> | undefined;

export async function setupDiscoveryCheckpointer(): Promise<void> {
  if (!setupPromise) {
    setupPromise = getDiscoveryCheckpointer().setup();
  }
  await setupPromise;
}

// npm hoisting gives @langchain/langgraph-checkpoint-postgres (under
// apps/api/node_modules) its own @langchain/langgraph-checkpoint copy (nested
// 1.1.5 vs root 1.1.3), so its PostgresSaver's BaseCheckpointSaver is nominally
// distinct from the root copy @langchain/langgraph types compile() against. The
// two are structurally identical (abstract class, no private members) and pregel
// duck-types the checkpointer, so this cast is safe at this one boundary (same
// dual-copy situation registry.ts documents for bullmq/ioredis).
export const discoveryGraph = builder.compile({
  checkpointer: getDiscoveryCheckpointer() as unknown as BaseCheckpointSaver,
});
export const DISCOVERY_RECURSION_LIMIT = RECURSION_LIMIT;
export { searchNode, confirmNode };