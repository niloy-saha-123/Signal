// Thread rail — list, select, new, and delete chat threads.
"use client";
import { Icon } from "./ui/icons";
import { Button, cx } from "./ui/primitives";
import type { ChatThreadSummary } from "../lib/api";
import { relativeTime } from "../lib/format";

export interface ThreadListProps {
  threads: ChatThreadSummary[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ThreadList({ threads, activeThreadId, onSelect, onNew, onDelete }: ThreadListProps) {
  return (
    <nav aria-label="Chats" className="flex h-full flex-col">
      <div className="p-3">
        <Button variant="primary" size="md" onClick={onNew} className="w-full">
          <Icon name="plus" className="h-4 w-4" />
          New chat
        </Button>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {threads.map((thread) => {
          const isActive = activeThreadId === thread.id;
          const title = thread.title ?? "Untitled chat";
          return (
            <li key={thread.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(thread.id)}
                aria-current={isActive ? "true" : undefined}
                className={cx(
                  "w-full rounded-[10px] py-2.5 pr-9 pl-3 text-left transition-colors",
                  isActive ? "bg-sky text-ink" : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                )}
              >
                <span className="block truncate text-[14px] font-semibold">{title}</span>
                <span className="block text-[12px] text-ink-muted" suppressHydrationWarning>
                  {relativeTime(thread.updated_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(thread.id)}
                aria-label={`Delete chat: ${title}`}
                className="absolute top-2.5 right-2 rounded-[8px] p-1 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface hover:text-status-critical focus-visible:opacity-100"
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </li>
          );
        })}
        {threads.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-muted">Your chats show up here.</p>}
      </ul>
    </nav>
  );
}
