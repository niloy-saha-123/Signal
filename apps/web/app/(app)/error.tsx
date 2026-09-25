"use client";

import Link from "next/link";
import { useEffect } from "react";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error("Authenticated page failed", error);
  }, [error]);

  return (
    <section
      aria-labelledby="app-error-title"
      className="mx-auto max-w-2xl rounded-xl bg-surface shadow-[var(--shadow-card)] px-7 py-12 shadow-[0_20px_50px_-36px_rgba(10,32,51,0.45)] sm:px-12"
    >
      <p className="text-sm font-semibold text-accent">Signal could not load this view</p>
      <h1
        id="app-error-title"
        className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink"
      >
        Your workspace is still safe.
      </h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-secondary">
        The latest workspace data did not arrive. Try the request again, or return to the
        briefing and continue from there.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 rounded-full bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/briefing"
          className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-ink transition-colors hover:bg-surface-sunken"
        >
          Return to briefing
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-7 text-xs text-ink-secondary">Reference: {error.digest}</p>
      ) : null}
    </section>
  );
}
