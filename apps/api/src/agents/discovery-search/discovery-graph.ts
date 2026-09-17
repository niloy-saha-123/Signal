// LangGraph agent that proposes new competitors from the open web. Every
// candidate lands in tracked_entities with status='candidate' — promotion
// to 'confirmed' happens only through the interrupt() resume path below,
// triggered by an explicit user action (never by this graph on its own).
//
// ReAct tool loop (search/retrieve -> reflect -> confirm): the llmCall node
// drives a tool-calling model (DuckDuckGo web search + Signal's own retrieval),
// looping through the ToolNode until the model produces a final answer, then the
// confirm node gates each proposed candidate behind interrupt(). A soft
// iteration cap (MAX_ITERATIONS) routes to confirm with whatever candidates
// have been found so far instead of throwing a GraphRecursionError; the graph
// recursionLimit stays as a hard backstop above that cap.
import {
  StateGraph,
  Annotation,
  START,
  END,
  interrupt,
  messagesStateReducer,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";
import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getCompanyContext } from "../../lib/company-context";
import { createTrackedEntityCandidate } from "../../db/queries";
import { selectModel, ANTHROPIC_MODEL_IDS } from "../../llm/adaptive-router";
import { withCircuitBreaker } from "../../reliability/circuit-breaker";
import { retrievalTool } from "../../retrieval/hybrid-retrieve-tool";
import { loadRootEnv } from "../../lib/env";

loadRootEnv();

const LLM_TIMEOUT_MS = 30_000;
const MAX_TOOL_CALLS = 5;
// Soft cap on llmCall<->toolNode round-trips before routing to confirm with
// whatever candidates exist. recursionLimit (below) is the hard backstop.
const MAX_ITERATIONS = 5;
const RECURSION_LIMIT = 15;

const DiscoveryGraphState = Annotation.Root({
  workspace_id: Annotation<string>(),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  candidates: Annotation<{ name: string; domain: string; reason: string }[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
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

// DuckDuckGo (free) replaces Tavily (paid): the spec's own open-risks section
// flagged Tavily's per-call cost as something to budget-cap, and this swap
// removes the need for that guard entirely. Wrapped in a structured tool so the
// search invocation is circuit-breaker-protected like every other LLM call site.
const duckDuckGoSearch = new DuckDuckGoSearch({ maxResults: MAX_TOOL_CALLS });

const webSearchTool = tool(
  ({ query }: { query: string }) =>
    withCircuitBreaker("discovery:search", () => duckDuckGoSearch.invoke(query)),
  {
    name: "web_search",
    description:
      "Search the open web for companies that compete with the user's company. " +
      "Use this to find competitor candidates the user may not already track.",
    schema: z.object({ query: z.string() }),
  }
);

// The model's final (non-tool-call) message carries the candidate proposals as a
// JSON object. This strips markdown fences and extracts the outermost object so
// minor prose around the JSON (which the model is explicitly told not to emit)
// still parses. On any failure it degrades to no candidates — the proposals are
// advisory (every one still passes the human confirm gate), never fatal.
// ponytail: naive "first { to last }" extraction; a strict JSON-only output
// format with withStructuredOutput would be more robust if this ever misfires.
function extractCandidates(content: unknown): { name: string; domain: string; reason: string }[] {
  if (typeof content !== "string") return [];
  const cleaned = content.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    return CandidatesSchema.parse(JSON.parse(cleaned.slice(start, end + 1))).candidates;
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT =
  "You are a competitive-intelligence analyst discovering new competitors for the user's " +
  "company. Use the web_search tool to find companies that compete for the same customers, " +
  "and the retrieve_signals tool to check whether Signal already stores signals about a " +
  "candidate before re-discovering it via web search. You may call tools repeatedly to " +
  "refine. When you have enough, reply with ONLY a JSON object of this exact shape and no " +
  "other text: {\"candidates\":[{\"name\":\"...\",\"domain\":\"...\",\"reason\":\"...\"}]}. " +
  "Propose up to 5 candidates that genuinely compete for the same customers.";

async function llmCallNode(
  state: typeof DiscoveryGraphState.State,
  config: LangGraphRunnableConfig
): Promise<Partial<typeof DiscoveryGraphState.State>> {
  const companyContext = await getCompanyContext(state.workspace_id);

  const alias = await selectModel("claude-sonnet", true);
  const model = new ChatAnthropic({
    model: ANTHROPIC_MODEL_IDS[alias] ?? alias,
    clientOptions: { timeout: LLM_TIMEOUT_MS },
  }).bindTools([webSearchTool, retrievalTool]);

  const system = companyContext ? `${SYSTEM_PROMPT}\n\n${companyContext}` : SYSTEM_PROMPT;

  const response = (await withCircuitBreaker("discovery:llm", () =>
    model.invoke([["system", system], ...state.messages], { signal: config.signal })
  )) as AIMessage;

  const iterationCount = state.iterationCount + 1;

  if (response.tool_calls && response.tool_calls.length > 0) {
    return { messages: [response], iterationCount };
  }

  return {
    messages: [response],
    candidates: extractCandidates(response.content),
    iterationCount,
  };
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

function afterLlmCall(state: typeof DiscoveryGraphState.State): "tools" | "confirm" {
  // The soft iteration cap wins over tool-call detection: once hit, route to
  // confirm with whatever candidates exist rather than looping indefinitely.
  if (state.iterationCount >= MAX_ITERATIONS) return "confirm";
  const last = state.messages[state.messages.length - 1];
  const hasToolCalls = last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0;
  return hasToolCalls ? "tools" : "confirm";
}

// Same dual-copy cast as the checkpointer below: ToolNode (from the hoisted root
// @langchain/langgraph, which resolves the root @langchain/core@1.2.2) types its
// tools against that root core, while `tool()` and retrievalTool come from
// apps/api's own @langchain/core@1.2.11. The two DynamicStructuredTool types are
// structurally identical at runtime — this cast is safe at this one boundary.
const discoveryTools = [webSearchTool, retrievalTool] as unknown as ConstructorParameters<
  typeof ToolNode
>[0];

const builder = new StateGraph(DiscoveryGraphState)
  .addNode("llmCall", llmCallNode, { retryPolicy: RETRY_POLICY })
  .addNode("tools", new ToolNode(discoveryTools), { retryPolicy: RETRY_POLICY })
  .addNode("confirm", confirmNode)
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", afterLlmCall, { tools: "tools", confirm: "confirm" })
  .addEdge("tools", "llmCall")
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
export { llmCallNode, confirmNode };
