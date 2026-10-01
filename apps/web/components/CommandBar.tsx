// apps/web/components/CommandBar.tsx
// ⌘K palette. Data-driven: commands own their onSelect. When nothing matches,
// the query becomes a question for Signal (if `onAsk` is wired), so the palette
// never dead-ends.
"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Sig } from "@/components/brand/Sig";
import { Icon, type IconName } from "@/components/ui/icons";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: IconName;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandBarProps {
  commands: Command[];
  onAsk?: (query: string) => void;
}

const OPEN_EVENT = "signal:command-bar";

export function openCommandBar() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandBar({ commands, onAsk }: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    return commands.filter(
      (command) => command.label.toLowerCase().includes(q) || command.hint?.toLowerCase().includes(q)
    );
  }, [commands, trimmed]);

  const askOption = onAsk && trimmed.length > 0;
  const optionCount = filtered.length + (askOption ? 1 : 0);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const isToggle = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isToggle) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
    } else {
      setQuery("");
      restoreFocus.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  function close() {
    setOpen(false);
  }

  function select(command: Command) {
    command.onSelect();
    close();
  }

  function ask() {
    if (!onAsk || !trimmed) return;
    onAsk(trimmed);
    close();
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(optionCount - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) select(command);
      else if (askOption && activeIndex === filtered.length) ask();
    }
  }

  if (!open) return null;

  const optionClass = (index: number) =>
    `flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[14px] ${
      index === activeIndex ? "bg-sky text-ink" : "text-ink-secondary"
    }`;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
      <div className="fixed inset-0 bg-ink/30" aria-hidden="true" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg overflow-hidden rounded-[16px] bg-surface shadow-[var(--shadow-window)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" className="h-5 w-5 text-ink-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages or ask Signal…"
            aria-label="Search pages or ask Signal"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-options"
            aria-activedescendant={optionCount > 0 ? `command-option-${activeIndex}` : undefined}
            className="h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-muted"
          />
          <kbd className="rounded-[5px] border border-line px-1.5 text-[11px] text-ink-muted">esc</kbd>
        </div>
        <ul id="command-options" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.map((command, index) => (
            <li key={command.id} role="presentation">
              <button
                id={`command-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                type="button"
                onClick={() => select(command)}
                onMouseEnter={() => setActiveIndex(index)}
                className={optionClass(index)}
              >
                {command.icon ? <Icon name={command.icon} className="h-[18px] w-[18px] shrink-0" /> : null}
                <span className="flex-1">
                  <span className="font-semibold text-ink">{command.label}</span>
                  {command.hint ? <span className="ml-2 text-[13px] text-ink-muted">{command.hint}</span> : null}
                </span>
                {command.shortcut ? <span className="text-[12px] text-ink-muted">{command.shortcut}</span> : null}
              </button>
            </li>
          ))}
          {askOption ? (
            <li role="presentation">
              <button
                id={`command-option-${filtered.length}`}
                role="option"
                aria-selected={activeIndex === filtered.length}
                type="button"
                onClick={ask}
                onMouseEnter={() => setActiveIndex(filtered.length)}
                className={optionClass(filtered.length)}
              >
                <Sig size={22} decorative />
                <span className="flex-1 truncate">
                  <span className="font-semibold text-ink">Ask Signal:</span> {trimmed}
                </span>
              </button>
            </li>
          ) : null}
          {optionCount === 0 ? (
            <li className="px-3 py-3 text-[14px] text-ink-muted">No matching commands.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
