// Thin single-turn adapter over the checkpointed chat graph.
//
// chat.ts (unchanged until Task 4) calls runChatAgent(input, { signal }) and
// expects a Promise<ChatAgentResult>. The multi-thread wiring — a stable
// workspace-scoped thread_id and SSE token streaming from generateNode — is
// Task 4's job; here the graph runs once against an ephemeral thread_id
// (the run's own UUID) and the final citation_result is returned.
import { HumanMessage } from "@langchain/core/messages";
import type { ChatAgentResult } from "@signal/shared";
import {
  chatGraph,
  ChatAgentInputSchema,
  setupChatCheckpointer,
  CHAT_RECURSION_LIMIT,
} from "./chat-graph";
import type { ChatAgentInput } from "./chat-graph";

export type { ChatAgentInput } from "./chat-graph";

export { ChatAgentInputSchema } from "./chat-graph";

// Bounds the whole request — retrieval, rerank and generation — so a hung
// Redis/embeddings call can't strand a caller (or a Part 13 SSE connection).
const OVERALL_TIMEOUT_MS = 60_000;

async function boundedBySignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export async function runChatAgent(
  input: ChatAgentInput,
  opts: { signal?: AbortSignal } = {}
): Promise<ChatAgentResult> {
  const parsed = ChatAgentInputSchema.parse(input);
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(OVERALL_TIMEOUT_MS)])
    : AbortSignal.timeout(OVERALL_TIMEOUT_MS);
  // Reject before creating `work`, so a pre-aborted caller neither runs the
  // graph nor strands the work promise's rejection on a signal that
  // boundedBySignal will already have surfaced synchronously.
  signal.throwIfAborted();

  const work = (async () => {
    await setupChatCheckpointer();
    signal.throwIfAborted();
    const finalized = await chatGraph.invoke(
      {
        messages: [new HumanMessage(parsed.query)],
        workspace_id: parsed.workspace_id,
        competitor_ids: parsed.competitor_ids,
        run_id: parsed.run_id,
        summary: "",
      },
      {
        configurable: { thread_id: parsed.run_id },
        signal,
        recursionLimit: CHAT_RECURSION_LIMIT,
      }
    );
    return finalized.citation_result as ChatAgentResult;
  })();

  // Some retrieval/cache dependencies do not expose AbortSignal inputs yet.
  // This enforces the caller-visible wall clock even if such a dependency is
  // stuck; the underlying promise may finish later, but post-await abort checks
  // prevent generation, billing, or cache writes after cancellation.
  return boundedBySignal(work, signal);
}