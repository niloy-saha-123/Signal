// apps/web/components/ChatInterface.tsx
// Persistent chat panel — answers from accumulated intelligence, not generic LLM knowledge.
// Streams via lib/chat-stream.ts (live `token` draft, corrected by the final `result`). A
// refusal (ChatAgentResult.refused === true) is a normal, successful result, rendered
// distinctly from an operational error — never treated as one. Threads are Phase 2's
// checkpointed multi-turn memory: when no thread is selected the UI creates one explicitly
// (so back-to-back sends continue one conversation, since the SSE `result` frame carries no
// thread_id to learn from) and then sends with that id. Backend auto-create-on-omit remains
// only a direct-API fallback.
"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { ChatAgentResult } from "@signal/shared";
import { SOURCE_COLORS } from "../lib/chart-colors";
import { streamChatResult } from "../lib/chat-stream";
import { ThreadList } from "./ThreadList";
import {
  createChatThread,
  getChatThreadMessages,
  listChatThreads,
  listChatThreadCheckpoints,
  regenerateChatThread,
  type ChatThreadSummary,
} from "../lib/api";

export interface ChatInterfaceProps {
  competitorIds: string[];
}

const GENERIC_ERROR_MESSAGE = "Signal couldn't answer that. Please try again.";

interface ChatTurn {
  id: string;
  query: string;
  result: ChatAgentResult | null;
  error: string | null;
  draft: string | null;
}

interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function ChatTurnView({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-slate-900">{turn.query}</p>
      {turn.error ? (
        <p className="text-sm text-red-600">{turn.error}</p>
      ) : turn.result === null ? (
        <p className="text-sm text-slate-700">{turn.draft ?? "Thinking…"}</p>
      ) : turn.result.refused ? (
        <div className="rounded-md bg-amber-50 p-3">
          <p className="text-sm text-amber-800">{turn.result.reason}</p>
          <p className="mt-1 text-xs text-amber-700">{turn.result.suggested_query}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-700">{turn.result.answer}</p>
          <div className="flex flex-wrap gap-1">
            {turn.result.citations.map((citation) => (
              <span
                key={citation.chunk_id}
                title={citation.claim}
                className="rounded-full border px-2 py-0.5 text-xs"
                style={{
                  borderColor: SOURCE_COLORS[citation.source],
                  color: SOURCE_COLORS[citation.source],
                }}
              >
                {citation.source}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryView({
  messages,
  onRegenerate,
}: {
  messages: HistoryMessage[];
  onRegenerate: (messageIndex: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((message, index) =>
        message.role === "user" ? (
          <div
            key={message.id}
            className="ml-auto max-w-[80%] rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white"
          >
            {message.text}
          </div>
        ) : (
          <div
            key={message.id}
            className="mr-auto flex max-w-[80%] items-start gap-1 rounded-xl bg-white px-4 py-2 text-sm text-slate-700 shadow-sm"
          >
            <p className="flex-1">{message.text}</p>
            <button
              type="button"
              onClick={() => onRegenerate(index)}
              title="Regenerate from here"
              className="shrink-0 rounded px-1 text-slate-400 hover:text-indigo-600"
            >
              ↻
            </button>
          </div>
        )
      )}
    </div>
  );
}

export function ChatInterface({ competitorIds }: ChatInterfaceProps) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function refreshThreads() {
    try {
      setThreads(await listChatThreads());
    } catch {
      // Thread list is best-effort; chat still works without it.
    }
  }

  useEffect(() => {
    refreshThreads();
  }, []);

  async function handleSelectThread(id: string) {
    setActiveThreadId(id);
    setTurns([]);
    try {
      const messages = await getChatThreadMessages(id);
      setHistory(
        messages
          .filter((m) => m.type === "human" || m.type === "ai")
          .map((m, i) => ({
            id: `${id}-${i}`,
            role: m.type === "human" ? "user" : "assistant",
            text: m.content,
          }))
      );
    } catch {
      setHistory([]);
    }
  }

  async function handleNewThread() {
    try {
      const thread = await createChatThread();
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
    } catch {
      setActiveThreadId(null);
    }
    setHistory([]);
    setTurns([]);
  }

  // Regenerate from the assistant message at `messageIndex`: fork the thread at
  // the checkpoint whose message_count === messageIndex and re-run generation.
  // The backend leaves the original history untouched (a fork), and this reload
  // surfaces the regenerated branch.
  async function handleRegenerate(messageIndex: number) {
    if (!activeThreadId) return;
    try {
      const checkpoints = await listChatThreadCheckpoints(activeThreadId);
      const checkpoint = checkpoints.find((c) => c.message_count === messageIndex);
      if (!checkpoint) return;
      await regenerateChatThread(activeThreadId, checkpoint.checkpoint_id);
      await handleSelectThread(activeThreadId);
    } catch {
      // Regeneration is best-effort; the existing history stays visible.
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || submitting) return;

    const id = crypto.randomUUID();
    setTurns((current) => [
      ...current,
      { id, query: trimmed, result: null, error: null, draft: null },
    ]);
    setQuery("");
    setSubmitting(true);

    let threadId = activeThreadId;
    if (threadId === null) {
      let thread: ChatThreadSummary;
      try {
        thread = await createChatThread();
      } catch {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === id ? { ...turn, error: GENERIC_ERROR_MESSAGE } : turn
          )
        );
        setSubmitting(false);
        return;
      }
      threadId = thread.id;
      setActiveThreadId(thread.id);
      setThreads((current) => [thread, ...current]);
    }

    try {
      await streamChatResult(
        trimmed,
        competitorIds,
        (result) => {
          setTurns((current) =>
            current.map((turn) => (turn.id === id ? { ...turn, result } : turn))
          );
        },
        (message) => {
          setTurns((current) =>
            current.map((turn) => (turn.id === id ? { ...turn, error: message } : turn))
          );
        },
        {
          threadId,
          onToken: (text) => {
            setTurns((current) =>
              current.map((turn) =>
                turn.id === id ? { ...turn, draft: (turn.draft ?? "") + text } : turn
              )
            );
          },
        }
      );
    } finally {
      setSubmitting(false);
    }
    refreshThreads();
  }

  return (
    <div className="flex gap-6">
      <ThreadList
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={handleSelectThread}
        onNew={handleNewThread}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-4">
          <HistoryView messages={history} onRegenerate={handleRegenerate} />
          {turns.map((turn) => (
            <ChatTurnView key={turn.id} turn={turn} />
          ))}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask Signal a question…"
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
            disabled={submitting}
          />
          <button
            type="submit"
            disabled={submitting || query.trim().length === 0}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}