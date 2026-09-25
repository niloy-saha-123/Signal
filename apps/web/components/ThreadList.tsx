// Thread rail — list, select, new, and delete chat threads. Kept in the studio
// token system to match the rest of the app.
"use client";
import type { ChatThreadSummary } from "../lib/api";

export interface ThreadListProps {
  threads: ChatThreadSummary[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ThreadList({ threads, activeThreadId, onSelect, onNew, onDelete }: ThreadListProps) {
  return (
    <div className="flex h-full flex-col">
      <button
        onClick={onNew}
        className="m-3 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
        </svg>
        New chat
      </button>

      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
        {threads.map((thread) => {
          const isActive = activeThreadId === thread.id;
          return (
            <li key={thread.id} className="group relative">
              <button
                onClick={() => onSelect(thread.id)}
                className={`w-full rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-accent-tint text-ink"
                    : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                }`}
              >
                <span className="block truncate font-semibold">
                  {thread.title ?? "Untitled chat"}
                </span>
                <span className="block text-xs opacity-70">{relativeTime(thread.updated_at)}</span>
              </button>
              <button
                onClick={() => onDelete(thread.id)}
                aria-label="Delete chat"
                className="absolute top-2 right-2 hidden rounded-full p-1 text-ink-secondary hover:bg-accent-tint hover:text-ink group-hover:block"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </li>
          );
        })}
        {threads.length === 0 && (
          <p className="px-3 py-4 text-xs text-ink-secondary">No chats yet. Ask Signal something.</p>
        )}
      </ul>
    </div>
  );
}