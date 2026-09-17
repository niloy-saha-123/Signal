"use client";
import { useEffect, useState } from "react";
import { listCompetitors } from "../lib/api";
import { ChatInterface } from "./ChatInterface";

export function ChatSidebar() {
  const [competitorIds, setCompetitorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  if (isCollapsed) {
    return (
      <aside className="fixed right-0 top-0 z-10 flex h-screen w-12 flex-col border-l border-slate-200 bg-white">
        <button
          onClick={() => setIsCollapsed(false)}
          className="mt-4 flex h-12 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900"
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
      {/* Chat header */}
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
        <h2 className="font-sans text-sm font-extrabold text-slate-900">Chat</h2>
        <div className="flex items-center gap-2">
          <button className="rounded-lg bg-indigo-600 px-3 py-1.5 font-sans text-xs font-bold text-white transition-colors hover:bg-indigo-700">
            New thread
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Collapse chat"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chat content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <p className="font-sans text-sm text-slate-400">Loading...</p>
          </div>
        ) : (
          <ChatInterface competitorIds={competitorIds} />
        )}
      </div>
    </aside>
  );
}
