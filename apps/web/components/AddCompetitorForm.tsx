"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { addCompetitorByDomain } from "@/lib/add-competitor";
import { ApiError } from "@/lib/api";
import { normalizeDomain } from "@/lib/domain";

// Add a competitor in place, from wherever the need arises (Home, the board,
// an empty state) instead of sending people to another page to do it.
export function AddCompetitorForm({
  autoFocus = false,
  size = "md",
  onAdded,
}: {
  autoFocus?: boolean;
  size?: "md" | "lg";
  onAdded?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const domain = normalizeDomain(value);
    if (!domain) {
      setError("Enter a company's website, like kestrel.dev");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const competitor = await addCompetitorByDomain(domain);
      setValue("");
      toast(`Now watching ${competitor.name}. Signal is finding its sources.`, "success");
      onAdded?.();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "That competitor is already being watched."
          : "Couldn't add that competitor. Try again in a moment."
      );
    } finally {
      setPending(false);
    }
  }

  const height = size === "lg" ? "h-12" : "h-10";

  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Competitor website</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Add a competitor: kestrel.dev"
            autoFocus={autoFocus}
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            aria-invalid={error ? true : undefined}
            className={`${height} w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none`}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`${height} inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-ink px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#1d3047] disabled:bg-ink-muted`}
        >
          <Icon name="plus" className="h-4 w-4" />
          {pending ? "Adding…" : "Watch"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[14px] font-medium text-miss-text">
          {error}
        </p>
      ) : null}
    </form>
  );
}
