// apps/web/components/ChatInterface.tsx
// Persistent chat panel — answers from accumulated intelligence, not generic LLM knowledge.
// Streams via lib/chat-stream.ts. A refusal (ChatAgentResult.refused === true) is a normal,
// successful result, rendered distinctly from an operational error — never treated as one.
"use client";
import { useState, type FormEvent } from "react";
import type { ChatAgentResult } from "@signal/shared";
import { SOURCE_COLORS } from "../lib/chart-colors";
import { streamChatResult } from "../lib/chat-stream";

export interface ChatInterfaceProps {
  competitorIds: string[];
}

interface ChatTurn {
  id: string;
  query: string;
  result: ChatAgentResult | null;
  error: string | null;
}

function ChatTurnView({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-slate-900">{turn.query}</p>
      {turn.error ? (
        <p className="text-sm text-red-600">{turn.error}</p>
      ) : turn.result === null ? (
        <p className="text-sm text-slate-500">Thinking…</p>
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

export function ChatInterface({ competitorIds }: ChatInterfaceProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || submitting) return;

    const id = crypto.randomUUID();
    setTurns((current) => [...current, { id, query: trimmed, result: null, error: null }]);
    setQuery("");
    setSubmitting(true);

    await streamChatResult(
      trimmed,
      competitorIds,
      (result) => {
        setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, result } : turn)));
      },
      (message) => {
        setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, error: message } : turn)));
      }
    );
    setSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
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
  );
}
