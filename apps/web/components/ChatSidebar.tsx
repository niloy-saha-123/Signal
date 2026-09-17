"use client";
import { useEffect, useState } from "react";
import { listCompetitors, createChatThread } from "../lib/api";
import { ChatInterface } from "./ChatInterface";

export function ChatSidebar() {
  const [competitorIds, setCompetitorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
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
      <aside className="fixed right-0 top-0 z-10 flex h-screen w-12 flex-col border-l border-slate-200 bg-white">
        <button
          onClick={() => setIsCollapsed(false)}
          className="mt-4 flex h-12 items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-700"
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
    <aside className="fixed right-0 top-0 z-10 flex h-screen w-96 flex-col border-l border-slate-200 bg-white transition-all duration-300">
      {/* Chat header - CLEAN design, no purple */}
      <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
        <h2 className="font-sans text-sm font-semibold text-slate-900">Chat</h2>
        <div className="flex items-center gap-1">
          <button 
            onClick={handleNewChat}
            className="rounded-md px-3 py-1.5 font-sans text-xs font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
          >
            New chat
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
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
            <div className="flex gap-1">
              <div className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
            </div>
          </div>
        ) : competitorIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="font-sans text-sm text-slate-400">
              Add competitors to start asking questions
            </p>
          </div>
        ) : (
          <ChatInterface key={chatKey} competitorIds={competitorIds} />
        )}
      </div>
    </aside>
  );
}
