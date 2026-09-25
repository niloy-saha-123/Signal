"use client";

// The assistant's persistent presence: a small circle pinned to the right edge,
// vertically centred, on every authenticated page.
//
// Right edge rather than bottom-right corner on purpose. A bottom-corner bubble
// is the support-widget gesture — it reads as "contact us", something you click
// when stuck. Signal's chat is a working tool you reach for constantly while
// reading a briefing, so it sits where the eye already is and stays put as the
// page scrolls.
export function ChatAvatar({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Ask Signal"
      className="group fixed right-4 bottom-5 z-40 flex items-center gap-2 lg:top-1/2 lg:bottom-auto lg:-translate-y-1/2"
    >
      {/* Label slides out on hover so the resting state stays a quiet circle. */}
      <span className="pointer-events-none max-w-0 overflow-hidden rounded-full bg-midnight py-1.5 text-[12px] font-medium whitespace-nowrap text-white opacity-0 shadow-[var(--shadow-popover)] transition-all duration-200 group-hover:max-w-[140px] group-hover:px-3 group-hover:opacity-100">
        Ask Signal
      </span>

      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2b61cc_0%,#0f2150_60%,#061436_100%)] shadow-[var(--shadow-float)] ring-4 ring-white/70 transition-transform duration-200 group-hover:-translate-y-0.5">
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
          {/* The product mark's trace and flare peak, at avatar scale. */}
          <path
            d="M6 19h3.6l2-6 3.5 11 2.4-7.7"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="23.6" cy="16.3" r="2.6" fill="#f96e31" />
        </svg>
        {/* Availability dot. Static — a pulsing indicator would imply activity
            that is not happening. */}
        <span
          className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[var(--color-status-good)]"
          aria-hidden="true"
        />
      </span>
    </button>
  );
}
