// Adapters over the checkpointed chat graph.
//
// runChatAgent — thin single-turn adapter for scripts/eval: runs the graph once
// against an ephemeral thread_id (the run's own UUID), returns the final
// citation_result. Still used by rag-eval; the streaming chat route (Task 4) no
// longer calls it.
//
// streamChat — the SSE route's dependency: drives graph.stream with streamMode
// ["messages","values"], yields per-token events from the "generate" node (the
// "messages" callback also captures the compaction model's tokens, so they are
// filtered out by node namespace), then a final result event from the last
// state's citation_result.
import { HumanMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { ChatAgentResult } from "@signal/shared";
import {
  chatGraph,
  ChatAgentInputSchema,
  setupChatCheckpointer,
  CHAT_RECURSION_LIMIT,
  GENERATE_NODE_NAME,
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

export type ChatStreamEvent =
  | { kind: "token"; text: string }
  | { kind: "result"; result: ChatAgentResult };

export interface StreamChatInput extends ChatAgentInput {
  thread_id: string;
}

// Mirrors chat-graph.ts's textFromContent over a single streamed chunk: text
// content blocks join with no separator; non-text blocks are dropped.
function chunkText(chunk: AIMessageChunk): string {
  const content = chunk.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : []
    )
    .join("");
}

export async function* streamChat(
  input: StreamChatInput,
  opts: { signal?: AbortSignal } = {}
): AsyncGenerator<ChatStreamEvent> {
  const parsed = ChatAgentInputSchema.parse({
    query: input.query,
    competitor_ids: input.competitor_ids,
    workspace_id: input.workspace_id,
    run_id: input.run_id,
  });
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(OVERALL_TIMEOUT_MS)])
    : AbortSignal.timeout(OVERALL_TIMEOUT_MS);
  signal.throwIfAborted();

  await setupChatCheckpointer();
  signal.throwIfAborted();

  // streamMode "messages" is a callback-based capture (StreamMessagesHandler with
  // lc_prefer_streaming) of every chat model that streams inside a node — so the
  // compaction model's summary tokens appear here too. The node name is the first
  // checkpoint-namespace segment ("generate:<taskId>"); filter to it so only the
  // answer draft is forwarded to the client, never the internal summary.
  const stream = await chatGraph.stream(
    {
      messages: [new HumanMessage(parsed.query)],
      workspace_id: parsed.workspace_id,
      competitor_ids: parsed.competitor_ids,
      run_id: parsed.run_id,
      // summary intentionally omitted — passing summary: "" would wipe the
      // checkpointed rolling summary (Task 3 invariant).
    },
    {
      configurable: { thread_id: input.thread_id },
      signal,
      recursionLimit: CHAT_RECURSION_LIMIT,
      streamMode: ["messages", "values"],
    }
  );

  let result: ChatAgentResult | undefined;
  // ponytail: the 60s timeout bounds the model/retrieval calls via node-level
  // signal?.throwIfAborted(); unlike runChatAgent's boundedBySignal race it does
  // not force-abort a dependency that ignores its signal and hangs. Add a per-chunk
  // race here if a hung non-abortable dependency is ever observed in production.
  for await (const chunk of stream) {
    signal.throwIfAborted();
    const [ns, mode, payload] = chunk as unknown as [string[], string, unknown];
    if (mode === "messages") {
      const [message] = payload as [AIMessageChunk, unknown];
      if (ns[0]?.split(":")[0] === GENERATE_NODE_NAME) {
        const text = chunkText(message);
        if (text) yield { kind: "token", text };
      }
    } else if (mode === "values") {
      const values = payload as { citation_result?: ChatAgentResult };
      if (values.citation_result) result = values.citation_result;
    }
  }

  if (!result) {
    throw new Error("chat-agent: stream finished without a citation_result");
  }
  yield { kind: "result", result };
}
