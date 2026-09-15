// apps/web/app/home-client.tsx
// Add Competitor form. On success, tracks the new id locally so its card shows live
// DiscoveryStatus, and calls router.refresh() so the Server Component (page.tsx) re-fetches
// the updated competitor list — same idiomatic pattern as Part 5's SignalFeed.
"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createCompetitor } from "../lib/api";
import { DiscoveryStatus } from "../components/DiscoveryStatus";

export function HomeClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAddedIds, setJustAddedIds] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await createCompetitor({ name, domain });
      setJustAddedIds((current) => [...current, created.id]);
      setName("");
      setDomain("");
      router.refresh();
    } catch {
      setError("Couldn't add that competitor. Check the domain and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm text-slate-700">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>
        <label className="flex flex-col text-sm text-slate-700">
          Domain
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="notion.so"
            required
            className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add competitor
        </button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {justAddedIds.map((id) => (
        <DiscoveryStatus key={id} competitorId={id} />
      ))}
    </div>
  );
}
