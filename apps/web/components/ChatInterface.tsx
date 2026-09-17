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
    <div className="flex flex-col gap-4 px-4 py-3">
      {/* User message */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-studio-sky-soft px-4 py-2.5">
          <p className="text-sm text-studio-ink">{turn.query}</p>
        </div>
      </div>

      {/* Assistant response */}
      <div className="flex flex-col gap-2">
        {turn.error ? (
          <p className="font-sans text-sm text-red-600">{turn.error}</p>
        ) : turn.result === null ? (
          <div className="flex items-center gap-2">
            {turn.draft ? (
              <p className="font-sans text-sm leading-relaxed text-slate-700">{turn.draft}</p>
            ) : (
              <>
                <span className="text-xs text-studio-muted">Thinking…</span>
              </>
            )}
          </div>
        ) : turn.result.refused ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="font-sans text-sm text-amber-900">{turn.result.reason}</p>
            {turn.result.suggested_query && (
              <button className="mt-2 text-xs text-amber-800 underline">
                Try: <span>{turn.result.suggested_query}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="font-sans text-sm leading-relaxed text-slate-700">
              {turn.result.answer}
            </p>
            {turn.result.citations.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {turn.result.citations.map((citation) => (
                  <span
                    key={citation.chunk_id}
                    title={citation.claim}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 font-sans text-xs text-slate-600"
                  >
                    {citation.source}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
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
    <div className="flex flex-col gap-4 px-4">
      {messages.map((message, index) =>
        message.role === "user" ? (
          <div key={message.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-2.5">
              <p className="font-sans text-sm text-slate-900">{message.text}</p>
            </div>
          </div>
        ) : (
          <div key={message.id} className="group flex items-start gap-2">
            <div className="flex-1">
              <p className="font-sans text-sm leading-relaxed text-slate-700">{message.text}</p>
            </div>
            <button
              type="button"
              onClick={() => onRegenerate(index)}
              title="Regenerate"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <svg className="h-4 w-4 text-slate-400 hover:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
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
    <div className="flex h-full flex-col">
      {/* Messages area - scrollable */}
      <div className="flex-1 overflow-y-auto">
        <HistoryView messages={history} onRegenerate={handleRegenerate} />
        {turns.map((turn) => (
          <ChatTurnView key={turn.id} turn={turn} />
        ))}
      </div>

      {/* Input area - fixed at bottom */}
      <div className="border-t border-studio-line p-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
              placeholder="Ask Signal a question…"
              rows={1}
              className="w-full resize-none rounded-2xl border border-studio-line bg-studio-sky-soft px-3 py-2.5 text-sm text-studio-ink placeholder:text-studio-muted focus:border-studio-action focus:outline-none"
              disabled={submitting}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || query.trim().length === 0}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-studio-ink text-white transition-opacity hover:opacity-90 disabled:opacity-30"
            title="Send message"
            aria-label="Ask"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
        {submitting && (
          <p className="mt-2 font-sans text-xs text-slate-400">Shift + Enter for new line</p>
        )}
      </div>
    </div>
  );
}