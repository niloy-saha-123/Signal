"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { normalizeDomain } from "@/lib/domain";
import { rememberPendingCompetitor } from "@/lib/pending-competitor";

// The hero's call to action is the product's first move: name a competitor.
// The domain rides along to sign-up so onboarding can start from it.
export function DomainForm({ cta = "Get their forecast", note }: { cta?: string; note?: string }) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const domain = normalizeDomain(value);
    if (!domain) {
      setError("Enter a company's website, like kestrel.dev");
      return;
    }
    setError(null);
    rememberPendingCompetitor(domain);
    router.push(`/signup?domain=${encodeURIComponent(domain)}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full max-w-[480px]">
      <label htmlFor={inputId} className="sr-only">
        A competitor&rsquo;s website
      </label>
      <div className="flex rounded-[14px] border-[1.5px] border-ink bg-surface p-1.5 shadow-[var(--shadow-press)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="competitor.com"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent px-3 text-[16px] text-ink outline-none placeholder:text-ink-muted"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-[10px] bg-ink px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#1d3047] sm:px-5"
        >
          {cta}
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2.5 text-[14px] font-medium text-status-critical">
          {error}
        </p>
      ) : note ? (
        <p className="mt-3 text-[14px] text-ink-secondary">{note}</p>
      ) : null}
    </form>
  );
}
