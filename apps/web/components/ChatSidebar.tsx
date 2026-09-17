"use client";
import { useEffect, useState } from "react";
import { listCompetitors, createChatThread } from "../lib/api";
import { ChatInterface } from "./ChatInterface";

export function ChatSidebar() {
  const [competitorIds, setCompetitorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    listCompetitors()
      .then((competitors) => {
        const activeIds = competitors.filter((c) => c.is_active).map((c) => c.id);
        setCompetitorIds(activeIds);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load competitors:", error);
        setLoading(false);
      });
  }, []);

  const handleNewChat = async () => {
    try {
      await createChatThread();
      // Force ChatInterface to refresh by changing key
      setChatKey((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to create new chat:", error);
    }
  };

  if (isCollapsed) {
    return (
      <aside className="fixed top-0 right-0 z-20 flex h-screen w-12 flex-col border-l border-studio-line bg-studio-paper">
        <button
          onClick={() => setIsCollapsed(false)}
          className="mt-4 flex h-12 items-center justify-center text-studio-muted hover:bg-studio-sky-soft hover:text-studio-ink"
          aria-label="Expand chat"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="fixed top-0 right-0 z-20 flex h-screen w-80 flex-col border-l border-studio-line bg-studio-paper">
      <div className="flex h-14 items-center justify-between border-b border-studio-line px-4">
        <h2 className="text-sm font-semibold text-studio-ink">Chat</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-studio-ink hover:bg-studio-sky-soft"
          >
            New chat
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="rounded-full p-1.5 text-studio-muted hover:bg-studio-sky-soft hover:text-studio-ink"
            aria-label="Collapse chat"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chat content - clean minimal design */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-sm text-studio-muted">Loading workspace chat…</p>
          </div>
        ) : competitorIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="text-sm leading-relaxed text-studio-muted">
              Research chat stays tied to collected evidence. Sign in to ask a follow-up
              against this workspace.
            </p>
          </div>
        ) : (
          <ChatInterface key={chatKey} competitorIds={competitorIds} />
        )}
      </div>
    </aside>
  );
}
