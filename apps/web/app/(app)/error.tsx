"use client";

import { useEffect } from "react";
import { Sig } from "@/components/brand/Sig";
import { Button, LinkButton } from "@/components/ui/primitives";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// The raw error message is logged, never shown: it can carry internal detail.
export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error("Authenticated page failed", error);
  }, [error]);

  return (
    <section
      aria-labelledby="app-error-title"
      className="mx-auto flex max-w-xl flex-col items-center rounded-[20px] border border-line bg-surface px-6 py-12 text-center sm:px-12"
    >
      <Sig mood="unsure" size={60} decorative />
      <h1 id="app-error-title" className="mt-4 font-display text-[28px] font-semibold tracking-[-0.03em] text-ink">
        This view didn&apos;t load
      </h1>
      <p className="mt-3 text-[15px] text-ink-secondary">
        Your workspace data is safe. The latest numbers just didn&apos;t arrive. Try again, or carry on from Home.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <LinkButton href="/briefing">Go to Home</LinkButton>
      </div>
      {error.digest ? <p className="mt-6 text-[12px] text-ink-muted">Reference: {error.digest}</p> : null}
    </section>
  );
}
