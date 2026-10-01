"use client";

import { useEffect, useState } from "react";

// Tiny event-bus toast. Any client component calls toast(); the one <Toaster />
// in the app shell renders it in a polite live region. No context provider, so
// it works from deep components and from plain event handlers alike.
export type ToastTone = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const EVENT = "signal:toast";
const TTL_MS = 4500;
const MAX_VISIBLE = 3;

export function toast(message: string, tone: ToastTone = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

let nextId = 1;

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    function onToast(event: Event) {
      const detail = (event as CustomEvent<{ message: string; tone: ToastTone }>).detail;
      if (!detail?.message) return;
      const id = nextId++;
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, message: detail.message, tone: detail.tone }]);
      const timer = setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
        timers.delete(timer);
      }, TTL_MS);
      timers.add(timer);
    }
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className="toast-in pointer-events-auto flex items-start gap-2.5 rounded-[12px] bg-ink px-4 py-3 text-[14px] text-white shadow-[var(--shadow-popover)]"
        >
          <span
            aria-hidden="true"
            className={
              item.tone === "error"
                ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#ff8a9a]"
                : item.tone === "success"
                  ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#5fd39a]"
                  : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sun"
            }
          />
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
