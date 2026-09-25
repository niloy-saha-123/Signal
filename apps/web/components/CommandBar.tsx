// apps/web/components/CommandBar.tsx
// Cmd+K command palette. A pure, data-driven mechanism — commands own their own onSelect,
// so this component has zero knowledge of what any command does (3 of the 5 real commands
// have no backend endpoint yet, see 00-overview.md's Discovered Gaps).
"use client";
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandBarProps {
  commands: Command[];
}

export function CommandBar({ commands }: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(
    () => commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase())),
    [commands, query]
  );

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const isToggle = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isToggle) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  function select(command: Command) {
    command.onSelect();
    setOpen(false);
    setQuery("");
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) select(command);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 pt-24"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Type a command…"
          className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none"
        />
        <ul className="mt-2 flex flex-col">
          {filtered.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                onClick={() => select(command)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  index === activeIndex ? "bg-surface-sunken text-ink" : "text-ink-secondary"
                }`}
              >
                <span>{command.label}</span>
                {command.shortcut ? (
                  <span className="text-xs text-ink-muted">{command.shortcut}</span>
                ) : null}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">No matching commands.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
