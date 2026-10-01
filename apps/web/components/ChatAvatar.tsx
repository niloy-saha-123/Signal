"use client";

import type { Ref } from "react";
import { Sig } from "@/components/brand/Sig";

// Sig, pinned bottom-right on every app page. Hovering says what it does; the
// face itself is the button.
export function ChatAvatar({ onOpen, ref }: { onOpen: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label="Ask Signal"
      className="group fixed right-5 bottom-5 z-40 flex items-center gap-2"
    >
      <span className="pointer-events-none max-w-0 overflow-hidden rounded-full bg-ink py-2 text-[13px] font-semibold whitespace-nowrap text-white opacity-0 transition-all duration-200 group-hover:max-w-[160px] group-hover:px-3.5 group-hover:opacity-100 group-focus-visible:max-w-[160px] group-focus-visible:px-3.5 group-focus-visible:opacity-100">
        Ask Signal
      </span>
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-surface shadow-[var(--shadow-window)] transition-transform group-hover:-translate-y-0.5">
        <Sig size={40} decorative />
      </span>
    </button>
  );
}
