// ChatGPT-style chat panel: thread rail + conversation + attach + stream.
// Streams via lib/chat-stream.ts (live `token` draft corrected by the final `result`).
// A refusal (ChatAgentResult.refused === true) is a normal, successful result.
// Input is disabled while a response is streaming, so a second send can't race the
// first. Per-turn attachments (docs + raster images) are validated client-side and
// sent with the chat request — they are not auto-persisted to the knowledge base.
"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatAgentResult } from "@signal/shared";
import { Sig, type SigMood } from "./brand/Sig";
import { Icon } from "./ui/icons";
import { SourceChip } from "./ui/primitives";
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
  // Pre-fills the composer (from "Ask Signal about this"). Never auto-sent.
  initialQuery?: string;
}

const GENERIC_ERROR_MESSAGE = "Signal couldn't answer that. Please try again.";

const SUGGESTED_QUESTIONS = [
  "What changed across my competitors this week?",
  "Which competitor is most likely to change pricing next?",
  "What's the strongest evidence behind my open forecasts?",
  "Where are competitors hiring, and what does it suggest?",
];

const PAPERCLIP =
  "M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13";

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

export function ChatInterface({ competitorIds, showThreads = true, initialQuery = "" }: ChatInterfaceProps) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function fillComposer(text: string) {
    setQuery(text);
    composerRef.current?.focus();
  }

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
        <div className="hidden w-64 shrink-0 border-r border-line bg-surface md:block">
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
        <div className="flex-1 overflow-y-auto px-4 py-6" aria-live="polite">
          {messages.length === 0 && !submitting ? (
            <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
              <Sig size={56} decorative />
              <h2 className="mt-4 font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">
                Ask about any competitor
              </h2>
              <p className="mt-2 text-[14px] text-ink-secondary">
                Answers come from the evidence Signal collected, with the sources cited. When the evidence is thin, it
                says so.
              </p>
              <div className="mt-6 flex w-full flex-col gap-2">
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => fillComposer(question)}
                    className="rounded-[12px] border border-line bg-surface px-4 py-3 text-left text-[14px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-sky"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-5">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-sky px-4 py-3">
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {message.attachments.map((a) => (
                            <span
                              key={a.name}
                              className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[12px] font-semibold text-ink"
                            >
                              <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PAPERCLIP} />
                              </svg>
                              {a.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-[14.5px] break-words whitespace-pre-wrap text-ink">{message.text}</p>
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="group flex items-start gap-3">
                    <Sig size={28} mood={assistantMood(message)} decorative className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      {message.error ? (
                        <p role="alert" className="rounded-[12px] border border-[#f3c0ca] bg-tint-rose px-4 py-3 text-[14px] text-status-critical">
                          {message.error}
                        </p>
                      ) : message.refused ? (
                        <div className="rounded-[12px] border border-line bg-sky px-4 py-3">
                          <p className="text-[14px] text-ink">{message.refused.reason}</p>
                          {message.refused.suggestedQuery && (
                            <button
                              type="button"
                              onClick={() => fillComposer(message.refused!.suggestedQuery)}
                              className="mt-2 text-left text-[13.5px] font-semibold text-accent hover:underline"
                            >
                              Try instead: {message.refused.suggestedQuery}
                            </button>
                          )}
                        </div>
                      ) : message.pending && !message.text ? (
                        <p className="py-1 text-[13.5px] text-ink-muted">Signal is responding…</p>
                      ) : (
                        <>
                          <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                            {message.text}
                          </p>
                          {message.citations && message.citations.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[12px] font-semibold text-ink-muted">Sources</span>
                              {message.citations.map((citation) => (
                                <span key={citation.chunk_id} title={citation.claim}>
                                  <SourceChip source={citation.source} />
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {message.confirmation && (
                        <div data-testid="confirm-card" className="mt-2 rounded-[12px] border border-line-strong bg-surface p-4">
                          <p className="text-[12.5px] font-semibold text-ink-secondary">Signal wants to run this action</p>
                          <p className="mt-1 text-[14px] font-semibold text-ink">{message.confirmation.description}</p>
                          {message.confirmation.status === "pending" ? (
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => void handleConfirm(message, "approve")}
                                className="h-8 rounded-[10px] bg-ink px-3 text-[13px] font-semibold text-white hover:bg-[#1d3047]"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleConfirm(message, "deny")}
                                className="h-8 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-sunken"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <p className="mt-2 text-[12.5px] text-ink-muted">
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
                        aria-label="Regenerate answer"
                        title="Regenerate"
                        className="shrink-0 rounded-[8px] p-1.5 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100"
                      >
                        <Icon name="refresh" className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-line bg-surface px-4 py-3">
          {attachError && (
            <p role="alert" className="mb-2 text-[13px] text-status-critical">
              {attachError}
            </p>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 py-1 text-[12.5px] text-ink-secondary"
                >
                  {a.name} · {formatBytes(a.size)}
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((x) => x.id !== a.id))}
                    aria-label={`Remove ${a.name}`}
                    className="text-ink-muted hover:text-ink"
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
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
              aria-label="Attach a file"
              title="Attach a document or image for this message only (not saved to company knowledge)"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
            >
              <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PAPERCLIP} />
              </svg>
            </button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Your question</span>
              <textarea
                ref={composerRef}
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
                className="block max-h-40 min-h-11 w-full resize-none rounded-[10px] border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
                disabled={submitting}
              />
            </label>
            <button
              type="submit"
              disabled={submitting || (query.trim().length === 0 && attachments.length === 0)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-ink text-white transition-colors hover:bg-[#1d3047] disabled:bg-ink-muted"
              title="Send"
              aria-label="Send message"
            >
              <Icon name="send" className="h-4 w-4" />
            </button>
          </form>
          <p className="mt-2 text-[12px] text-ink-muted">
            {submitting
              ? "Signal is responding. This chat is locked until it finishes."
              : "Enter to send, Shift+Enter for a new line."}
          </p>
        </div>
      </div>
    </div>
  );
}

function assistantMood(message: ChatMessage): SigMood {
  if (message.pending) return "thinking";
  if (message.refused || message.error) return "unsure";
  return "idle";
}
