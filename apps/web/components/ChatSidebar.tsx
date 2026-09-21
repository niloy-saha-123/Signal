"use client";
import { useEffect, useState } from "react";
import { listCompetitors } from "../lib/api";
import { ChatInterface } from "./ChatInterface";

export function ChatSidebar() {
  const [competitorIds, setCompetitorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    listCompetitors()
      .then((competitors) => {
        const activeIds = competitors.filter((c) => c.is_active).map((c) => c.id);
        setCompetitorIds(activeIds);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <>
      {/* Floating button - bottom right */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_8px_24px_-8px_rgba(79,70,229,0.4)] hover:bg-indigo-700 transition-all duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/50"
          aria-label="Open chat"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h16M8 12l-4 4m4-4l4 4m-4-4v-4m0 16v-4" />
          </svg>
        </button>
      )}

      {/* Chat panel - slides in from right */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm transition-opacity"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          {/* Panel */}
          <aside className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[384px] flex-col border-l border-slate-200 bg-white shadow-[0_0_80px_-20px_rgba(15,23,42,0.15)] animate-slide-in-right">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
              <h2 className="text-sm font-semibold text-slate-900">Chat</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setChatKey((prev) => prev + 1)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-indigo-50"
                >
                  New chat
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-full p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-slate-900"
                  aria-label="Close chat"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <p className="text-sm text-slate-500">Loading workspace chat…</p>
                </div>
              ) : competitorIds.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                  <p className="text-sm leading-relaxed text-slate-500">
                    Research chat stays tied to collected evidence. Sign in to ask a follow-up against
                    this workspace.
                  </p>
                </div>
              ) : (
                <ChatInterface key={chatKey} competitorIds={competitorIds} showThreads={false} />
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}