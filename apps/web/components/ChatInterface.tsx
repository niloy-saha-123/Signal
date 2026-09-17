// ChatGPT-style chat panel: thread rail + conversation + attach + stream.
// Streams via lib/chat-stream.ts (live `token` draft corrected by the final `result`).
// A refusal (ChatAgentResult.refused === true) is a normal, successful result.
// Input is disabled while a response is streaming, so a second send can't race the
// first. Document uploads are validated client-side (type + 10 MB) and stored via
// /api/company-documents (the workspace knowledge path).
"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SOURCE_COLORS } from "../lib/chart-colors";
import { streamChatResult } from "../lib/chat-stream";
import { ThreadList } from "./ThreadList";
import {
  createChatThread,
  deleteChatThread,
  getChatThreadMessages,
  listChatThreads,
  listChatThreadCheckpoints,
  regenerateChatThread,
  uploadCompanyDocument,
  type ChatThreadSummary,
} from "../lib/api";
import { validateDocument, formatBytes, ACCEPTED_DOC_EXTENSIONS } from "../lib/attachments";

export interface ChatInterfaceProps {
  competitorIds: string[];
  showThreads?: boolean;
}

const GENERIC_ERROR_MESSAGE = "Signal couldn't answer that. Please try again.";

interface Attachment {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "ok" | "error";
}

interface Citation {
  claim: string;
  chunk_id: string;
  source: string;
  similarity_score: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: { name: string }[];
  citations?: Citation[];
  refused?: { reason: string; suggestedQuery: string } | null;
  error?: string | null;
  pending?: boolean;
  regenerateIndex?: number;
}

export function ChatInterface({ competitorIds, showThreads = true }: ChatInterfaceProps) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, submitting]);

  useEffect(() => {
    listChatThreads()
      .then(setThreads)
      .catch(() => {});
  }, []);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachError(null);
    for (const file of Array.from(files)) {
      const invalid = validateDocument(file);
      if (invalid) {
        setAttachError(invalid);
        continue;
      }
      const id = crypto.randomUUID();
      setAttachments((current) => [
        ...current,
        { id, name: file.name, size: file.size, status: "uploading" },
      ]);
      try {
        await uploadCompanyDocument(file);
        setAttachments((current) =>
          current.map((a) => (a.id === id ? { ...a, status: "ok" } : a))
        );
      } catch {
        setAttachments((current) =>
          current.map((a) => (a.id === id ? { ...a, status: "error" } : a))
        );
      }
    }
  }

  async function loadThread(id: string) {
    setActiveThreadId(id);
    setAttachments([]);
    try {
      const raw = await getChatThreadMessages(id);
      const mapped: ChatMessage[] = [];
      const humanAndAi = raw.filter((m) => m.type === "human" || m.type === "ai");
      humanAndAi.forEach((m, index) => {
        const role = m.type === "human" ? "user" : "assistant";
        mapped.push({
          id: `${id}-${index}`,
          role,
          text: m.content,
          regenerateIndex: role === "assistant" ? index : undefined,
        });
      });
      setMessages(mapped);
    } catch {
      setMessages([]);
    }
  }

  async function handleNewThread() {
    setActiveThreadId(null);
    setMessages([]);
    setAttachments([]);
  }

  async function handleDeleteThread(id: string) {
    try {
      await deleteChatThread(id);
      setThreads((current) => current.filter((t) => t.id !== id));
      if (activeThreadId === id) {
        setActiveThreadId(null);
        setMessages([]);
      }
    } catch {
      // best-effort
    }
  }

  async function handleRegenerate(message: ChatMessage) {
    if (!activeThreadId || message.regenerateIndex === undefined) return;
    try {
      const checkpoints = await listChatThreadCheckpoints(activeThreadId);
      const checkpoint = checkpoints.find((c) => c.message_count === message.regenerateIndex);
      if (!checkpoint) return;
      await regenerateChatThread(activeThreadId, checkpoint.checkpoint_id);
      await loadThread(activeThreadId);
    } catch {
      // best-effort; existing history stays visible
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    const uploadFailed = attachments.some((a) => a.status === "error");
    const uploadPending = attachments.some((a) => a.status === "uploading");
    if (submitting || (!trimmed && attachments.length === 0)) return;
    if (uploadFailed) {
      setAttachError("One or more attachments failed to upload — remove them to continue.");
      return;
    }
    if (uploadPending) return;

    const attachmentNames = attachments.map((a) => a.name);
    setQuery("");
    setAttachments([]);
    setAttachError(null);

    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: userMsgId,
        role: "user",
        text: trimmed,
        attachments: attachmentNames.map((name) => ({ name })),
      },
      {
        id: assistantMsgId,
        role: "assistant",
        text: "",
        pending: true,
      },
    ]);
    setSubmitting(true);

    let threadId = activeThreadId;
    if (threadId === null) {
      try {
        const thread = await createChatThread();
        threadId = thread.id;
        setActiveThreadId(thread.id);
        setThreads((current) => [thread, ...current]);
      } catch {
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantMsgId ? { ...m, pending: false, error: GENERIC_ERROR_MESSAGE } : m
          )
        );
        setSubmitting(false);
        return;
      }
    }

    try {
      await streamChatResult(
        trimmed,
        competitorIds,
        (result) => {
          setMessages((current) =>
            current.map((m) => {
              if (m.id !== assistantMsgId) return m;
              return {
                ...m,
                pending: false,
                text: result.refused ? "" : result.answer,
                refused: result.refused
                  ? { reason: result.reason, suggestedQuery: result.suggested_query }
                  : null,
                citations: result.refused ? undefined : result.citations,
              };
            })
          );
        },
        (message) => {
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantMsgId ? { ...m, pending: false, error: message } : m
            )
          );
        },
        {
          threadId,
          onToken: (text) => {
            setMessages((current) =>
              current.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, text: m.text + text }
                  : m
              )
            );
          },
        }
      );
    } finally {
      setSubmitting(false);
    }
    listChatThreads().then(setThreads).catch(() => {});
  }

  return (
    <div className="flex h-full min-h-0">
      {showThreads && (
        <div className="w-64 shrink-0 border-r border-studio-line bg-studio-paper">
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={loadThread}
            onNew={handleNewThread}
            onDelete={handleDeleteThread}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 && !submitting ? (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-studio-ink">
                Ask Signal a question
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-studio-muted">
                Answers are grounded in your collected competitor evidence, with citations.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-studio-action-soft px-4 py-3">
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {message.attachments.map((a) => (
                            <span
                              key={a.name}
                              className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold text-studio-ink"
                            >
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                              {a.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-sm text-studio-ink">{message.text}</p>
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="group flex items-start gap-2">
                    <div className="flex-1">
                      {message.error ? (
                        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                          {message.error}
                        </p>
                      ) : message.refused ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                          <p className="text-sm text-amber-900">{message.refused.reason}</p>
                          {message.refused.suggestedQuery && (
                            <p className="mt-1 text-xs text-amber-800">
                              Try instead: {message.refused.suggestedQuery}
                            </p>
                          )}
                        </div>
                      ) : message.pending ? (
                        <div className="flex items-center gap-2 px-1 py-2">
                          <span className="flex gap-1">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-studio-action [animation-delay:0ms]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-studio-action [animation-delay:150ms]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-studio-action [animation-delay:300ms]" />
                          </span>
                          <span className="text-xs text-studio-muted">Signal is responding…</span>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-studio-ink">
                            {message.text}
                          </p>
                          {message.citations && message.citations.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {message.citations.map((citation) => (
                                <span
                                  key={citation.chunk_id}
                                  title={citation.claim}
                                  className="inline-flex items-center gap-1 rounded-full border border-studio-line bg-white px-2 py-0.5 text-xs text-studio-muted"
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: SOURCE_COLORS[citation.source as keyof typeof SOURCE_COLORS] ?? "#94a3b8" }}
                                  />
                                  {citation.source}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {message.regenerateIndex !== undefined && (
                      <button
                        type="button"
                        onClick={() => handleRegenerate(message)}
                        title="Regenerate"
                        className="shrink-0 rounded-full p-1 text-studio-muted opacity-0 transition-opacity hover:bg-studio-sky-soft hover:text-studio-ink group-hover:opacity-100"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-studio-line bg-studio-paper px-4 py-3">
          {attachError && <p className="mb-2 text-xs text-red-600">{attachError}</p>}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-studio-line bg-studio-sky-soft px-3 py-1 text-xs text-studio-muted"
                >
                  {a.name} · {formatBytes(a.size)}
                  <span className={a.status === "ok" ? "text-emerald-600" : a.status === "error" ? "text-red-600" : "text-studio-muted"}>
                    {a.status === "ok" ? "✓" : a.status === "error" ? "✕" : "…"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((x) => x.id !== a.id))}
                    aria-label={`Remove ${a.name}`}
                    className="text-studio-muted hover:text-studio-ink"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_DOC_EXTENSIONS.join(",")}
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={openFilePicker}
              disabled={submitting}
              title="Attach a document (PDF, TXT, MD, DOC, DOCX, CSV, JSON, RTF — max 10 MB)"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-studio-muted transition-colors hover:bg-studio-sky-soft hover:text-studio-ink disabled:opacity-30"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as FormEvent);
                }
              }}
              placeholder="Ask Signal a question…"
              rows={1}
              className="max-h-40 w-full resize-none rounded-3xl border border-studio-line bg-studio-sky-soft px-4 py-2.5 text-sm text-studio-ink placeholder:text-studio-muted focus:border-studio-action focus:outline-none"
              disabled={submitting}
            />
            <button
              type="submit"
              disabled={submitting || (query.trim().length === 0 && attachments.length === 0)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-studio-ink text-white transition-opacity hover:opacity-90 disabled:opacity-30"
              title="Send"
              aria-label="Send message"
            >
              {submitting ? (
                <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </form>
          {submitting && (
            <p className="mt-2 text-xs text-studio-muted">Signal is responding — this chat is locked until it finishes.</p>
          )}
        </div>
      </div>
    </div>
  );
}