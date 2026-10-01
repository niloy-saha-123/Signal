"use client";
import { useEffect, useRef, useState } from "react";
import { Sig } from "@/components/brand/Sig";
import { Icon } from "@/components/ui/icons";
import { listCompetitors } from "../lib/api";
import { onAskSignal } from "../lib/ask";
import { ChatAvatar } from "./ChatAvatar";
import { ChatInterface } from "./ChatInterface";

// The slide-over Ask Signal panel. Opens from Sig, from ⌘K free text, or from
// any "Ask Signal about this" button — the last two arrive pre-filled.
export function ChatSidebar() {
  const [competitorIds, setCompetitorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [prefill, setPrefill] = useState("");
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    listCompetitors()
      .then((competitors) => {
        setCompetitorIds(competitors.filter((c) => c.is_active).map((c) => c.id));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(
    () =>
      onAskSignal((prompt) => {
        setPrefill(prompt);
        setChatKey((key) => key + 1);
        setIsOpen(true);
      }),
    []
  );

  useEffect(() => {
    if (!isOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>("textarea, input[type=text]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, chatKey]);

  return (
    <>
      {!isOpen && <ChatAvatar onOpen={() => setIsOpen(true)} />}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-ink/20" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Ask Signal"
            className="animate-slide-in-right fixed top-0 right-0 z-50 flex h-[100dvh] w-full max-w-[440px] flex-col border-l border-line bg-surface shadow-[var(--shadow-window)]"
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
              <div className="flex items-center gap-2.5">
                <Sig size={30} decorative />
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Ask Signal</h2>
                  <p className="text-[12px] text-ink-muted">Answers cite your collected evidence</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setPrefill("");
                    setChatKey((prev) => prev + 1);
                  }}
                  className="h-9 rounded-[8px] px-3 text-[13px] font-semibold text-ink hover:bg-surface-sunken"
                >
                  New chat
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-muted hover:bg-surface-sunken hover:text-ink"
                  aria-label="Close chat"
                >
                  <Icon name="close" className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {loading ? (
                <div className="flex h-full items-center justify-center p-8">
                  <Sig mood="thinking" size={44} title="Loading workspace chat" />
                </div>
              ) : competitorIds.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <Sig mood="unsure" size={48} decorative />
                  <p className="max-w-xs text-[14px] text-ink-secondary">
                    Signal answers from evidence it has collected. Add a competitor (or sign in) and
                    ask again once the first signals arrive.
                  </p>
                </div>
              ) : (
                <ChatInterface key={chatKey} competitorIds={competitorIds} showThreads={false} initialQuery={prefill} />
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
