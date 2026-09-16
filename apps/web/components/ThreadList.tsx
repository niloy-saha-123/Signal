// apps/web/components/ThreadList.tsx
// Minimal thread sidebar — list + select + "new thread". Phase 5 rebuilds this properly; this
// exists only to prove Phase 2's thread routes work end-to-end in the real UI.
import type { ChatThreadSummary } from "../lib/api";

export interface ThreadListProps {
  threads: ChatThreadSummary[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ThreadList({ threads, activeThreadId, onSelect, onNew }: ThreadListProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-3 rounded-xl bg-white p-3 shadow-sm">
      <button
        onClick={onNew}
        className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
      >
        New thread
      </button>
      <ul className="flex flex-col gap-1">
        {threads.map((thread) => (
          <li key={thread.id}>
            <button
              onClick={() => onSelect(thread.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                activeThreadId === thread.id
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {thread.title ?? "Untitled"}
            </button>
          </li>
        ))}
      </ul>
      {threads.length === 0 && (
        <p className="px-3 text-xs text-slate-400">No threads yet.</p>
      )}
    </aside>
  );
}