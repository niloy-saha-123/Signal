// ChatGPT-style chat panel: thread rail + conversation + attach + stream.
// Streams via lib/chat-stream.ts (live `token` draft corrected by the final `result`).
// A refusal (ChatAgentResult.refused === true) is a normal, successful result.
// Input is disabled while a response is streaming, so a second send can't race the
// first. Per-turn attachments (docs + raster images) are validated client-side and
// sent with the chat request — they are not auto-persisted to the knowledge base.
"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatAgentResult } from "@signal/shared";
import { SOURCE_COLORS } from "../lib/chart-colors";
import { resumeChatThread, streamChatResult, type ChatMutationRequest } from "../lib/chat-stream";
import { ThreadList } from "./ThreadList";
import {
  createChatThread,
  deleteChatThread,
  getChatThreadMessages,
  listChatThreads,
  listChatThreadCheckpoints,
  regenerateChatThread,
  type ChatThreadSummary,
} from "../lib/api";
import {
  validateChatAttachment,
  formatBytes,
  ACCEPTED_CHAT_EXTENSIONS,
  MAX_CHAT_DOCS,
  MAX_CHAT_IMAGES,
} from "../lib/attachments";

export interface ChatInterfaceProps {
  competitorIds: string[];
  showThreads?: boolean;
}

const GENERIC_ERROR_MESSAGE = "Signal couldn't answer that. Please try again.";

interface Attachment {
  id: string;
  name: string;
  size: number;
  file: File;
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
  confirmation?: {
    tool_name: string;
    description: string;
    arguments: Record<string, unknown>;
    status: "pending" | "approved" | "denied";
  } | null;
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

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachError(null);
    const incoming = Array.from(files);
    setAttachments((current) => {
      let docs = current.filter((a) => !/\.(png|jpe?g|webp|gif)$/i.test(a.name)).length;
      let images = current.filter((a) => /\.(png|jpe?g|webp|gif)$/i.test(a.name)).length;
      const next = [...current];
      for (const file of incoming) {
        const invalid = validateChatAttachment(file);
        if (invalid) {
          setAttachError(invalid);
          continue;
        }
        const isImage = /\.(png|jpe?g|webp|gif)$/i.test(file.name);
        if (isImage) {
          if (images >= MAX_CHAT_IMAGES) {
            setAttachError(`At most ${MAX_CHAT_IMAGES} images per message.`);
            continue;
          }
          images += 1;
        } else {
          if (docs >= MAX_CHAT_DOCS) {
            setAttachError(`At most ${MAX_CHAT_DOCS} documents per message.`);
            continue;
          }
          docs += 1;
        }
        next.push({ id: crypto.randomUUID(), name: file.name, size: file.size, file });
      }
      return next;
    });
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

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function applyResult(id: string, result: ChatAgentResult) {
    patchMessage(id, {
      pending: false,
      text: result.refused ? "" : result.answer,
      refused: result.refused ? { reason: result.reason, suggestedQuery: result.suggested_query } : null,
      citations: result.refused ? undefined : result.citations,
    });
  }

  async function handleConfirm(message: ChatMessage, decision: "approve" | "deny") {
    const threadId = activeThreadId;
    if (!threadId || !message.confirmation || message.confirmation.status !== "pending") return;
    patchMessage(message.id, {
      confirmation: { ...message.confirmation, status: decision === "approve" ? "approved" : "denied" },
      pending: true,
    });
    setSubmitting(true);
    try {
      await resumeChatThread(
        threadId,
        decision,
        (result) => applyResult(message.id, result),
        (error) => patchMessage(message.id, { pending: false, error }),
        {
          onToken: (text) => patchMessage(message.id, { text: message.text + text }),
          onConfirmRequired: (mutation) =>
            patchMessage(message.id, {
              pending: false,
              confirmation: { ...mutation, status: "pending" },
            }),
        }
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (submitting || (!trimmed && attachments.length === 0)) return;

    const attachmentNames = attachments.map((a) => a.name);
    const filesToSend = attachments.map((a) => a.file);
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
          attachments: filesToSend.length > 0 ? filesToSend : undefined,
          onToken: (text) => {
            setMessages((current) =>
              current.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, text: m.text + text }
                  : m
              )
            );
          },
          onConfirmRequired: (mutation: ChatMutationRequest) => {
            setMessages((current) =>
              current.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, pending: false, confirmation: { ...mutation, status: "pending" } }
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
        <div className="w-64 shrink-0 border-r border-line bg-surface">
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
              <h2 className=" text-2xl font-semibold tracking-tight text-ink">
                Ask Signal a question
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                Answers are grounded in your collected competitor evidence, with citations.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-lg bg-accent-tint px-4 py-3">
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {message.attachments.map((a) => (
                            <span
                              key={a.name}
                              className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold text-ink"
                            >
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                              {a.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-sm text-ink">{message.text}</p>
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="group flex items-start gap-2">
                    <div className="flex-1">
                      {message.error ? (
                        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                          {message.error}
                        </p>
                      ) : message.refused ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
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
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
                          </span>
                          <span className="text-xs text-ink-secondary">Signal is responding…</span>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                            {message.text}
                          </p>
                          {message.citations && message.citations.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {message.citations.map((citation) => (
                                <span
                                  key={citation.chunk_id}
                                  title={citation.claim}
                                  className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-xs text-ink-secondary"
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: SOURCE_COLORS[citation.source as keyof typeof SOURCE_COLORS] ?? "var(--color-ink-muted)" }}
                                  />
                                  {citation.source}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {message.confirmation && (
                        <div
                          data-testid="confirm-card"
                          className="mt-2 rounded-lg border border-line bg-white p-3"
                        >
                          <p className="text-xs font-medium text-ink-secondary">
                            Signal wants to run this action
                          </p>
                          <p className="mt-1 text-sm font-semibold text-ink">
                            {message.confirmation.description}
                          </p>
                          {message.confirmation.status === "pending" ? (
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => void handleConfirm(message, "approve")}
                                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleConfirm(message, "deny")}
                                className="rounded-xl bg-surface shadow-[var(--shadow-card)] px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:text-ink"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-ink-secondary">
                              {message.confirmation.status === "approved" ? "Action approved." : "Action cancelled."}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {message.regenerateIndex !== undefined && (
                      <button
                        type="button"
                        onClick={() => handleRegenerate(message)}
                        title="Regenerate"
                        className="shrink-0 rounded-full p-1 text-ink-secondary opacity-0 transition-opacity hover:bg-surface-sunken hover:text-ink group-hover:opacity-100"
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
        <div className="border-t border-line bg-surface px-4 py-3">
          {attachError && <p className="mb-2 text-xs text-red-600">{attachError}</p>}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 py-1 text-xs text-ink-secondary"
                >
                  {a.name} · {formatBytes(a.size)}
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((x) => x.id !== a.id))}
                    aria-label={`Remove ${a.name}`}
                    className="text-ink-secondary hover:text-ink"
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
              accept={ACCEPTED_CHAT_EXTENSIONS.join(",")}
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
              title="Attach a document or image for this message only (not saved to company knowledge)"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
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
              className="max-h-40 w-full resize-none rounded-lg border border-line bg-surface-sunken px-4 py-2.5 text-sm text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none"
              disabled={submitting}
            />
            <button
              type="submit"
              disabled={submitting || (query.trim().length === 0 && attachments.length === 0)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 disabled:opacity-30"
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
            <p className="mt-2 text-xs text-ink-secondary">Signal is responding — this chat is locked until it finishes.</p>
          )}
        </div>
      </div>
    </div>
  );
}