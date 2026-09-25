"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createCompetitor, resumeDiscovery, triggerDiscovery, resolveCompany } from "@/lib/api";

export interface DiscoveryEntity {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  relationshipType: string;
  source: string;
  confidence: number | null;
  reason: string | null;
  status: string;
}

type Column = { key: string; title: string; hint: string };

const COLUMNS: Column[] = [
  { key: "candidate", title: "Suggested", hint: "Awaiting your call" },
  { key: "confirmed", title: "Tracking", hint: "Actively watched" },
  { key: "dismissed", title: "Dismissed", hint: "Set aside" },
];

const RELATIONSHIP_TINT: Record<string, string> = {
  competitor: "bg-accent-tint text-accent",
  aspirational: "bg-[var(--color-tint-sand)] text-ink",
  other: "bg-surface-sunken text-ink-secondary",
};

function bucket(status: string): string {
  if (status === "confirmed") return "confirmed";
  if (status === "dismissed") return "dismissed";
  return "candidate";
}

export function DiscoveryBoard({ entities }: { entities: DiscoveryEntity[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [resolvedName, setResolvedName] = useState("");
  const [resolvedDomain, setResolvedDomain] = useState("");
  const [resolving, setResolving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  async function act(entity: DiscoveryEntity, decision: "confirm" | "dismiss") {
    setBusy(entity.id);
    try {
      await resumeDiscovery(entity.workspaceId, decision);
      router.refresh();
    } catch {
      setBusy(null);
    }
  }

  async function startDiscovery() {
    setBusy("__trigger__");
    try {
      await triggerDiscovery();
      router.refresh();
    } catch {
      setBusy(null);
    }
  }

  async function handleInputChange(value: string) {
    setManualInput(value);
    setManualError(null);
    if (!value.trim()) {
      setResolvedName("");
      setResolvedDomain("");
      return;
    }

    setResolving(true);
    try {
      const resolved = await resolveCompany(value);
      setResolvedName(resolved.name);
      setResolvedDomain(resolved.domain);
    } catch {
      setResolvedName("");
      setResolvedDomain("");
    } finally {
      setResolving(false);
    }
  }

  async function addManually(event: FormEvent) {
    event.preventDefault();
    if (!manualInput.trim()) return;
    setBusy("__manual__");
    setManualError(null);
    try {
      const name = resolvedName || manualInput.trim();
      const domain = resolvedDomain;
      await createCompetitor({ name, domain });
      setManualInput("");
      setResolvedName("");
      setResolvedDomain("");
      setManualOpen(false);
      router.refresh();
    } catch {
      setManualError("Couldn't add that competitor. Check the domain and try again.");
    } finally {
      setBusy(null);
    }
  }

  const columns = COLUMNS.map((column) => ({
    ...column,
    entities: entities.filter((entity) => bucket(entity.status) === column.key),
  }));

  const total = entities.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className=" text-4xl font-semibold tracking-[-0.035em] text-ink">
            Discovery
          </h1>
          <p className="text-sm text-ink-secondary">
            {total === 0
              ? "Companies Signal suggests watching, and the ones you've already decided on."
              : `${total} tracked ${total === 1 ? "company" : "companies"} across the board.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setManualOpen((open) => !open)}
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-sm font-semibold text-ink transition-colors hover:bg-surface-sunken"
          >
            Add competitor
          </button>
          <button
            onClick={startDiscovery}
            disabled={busy === "__trigger__"}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "__trigger__" ? "Scanning…" : "Find new competitors"}
          </button>
        </div>
      </div>

      {manualOpen && (
        <form
          onSubmit={addManually}
          className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-6"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Company name or domain
            <input
              value={manualInput}
              onChange={(e) => handleInputChange(e.target.value)}
              required
              placeholder="Notion, notion.so, https://notion.so"
              className="rounded-full bg-surface-sunken px-4 py-2.5 text-sm font-normal text-ink outline-none focus:bg-accent-tint"
            />
          </label>

          {(resolvedName || resolvedDomain) && (
            <div className="flex items-center gap-3 p-3 rounded-[10px] bg-surface-sunken text-sm text-ink-secondary">
              {resolving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  Resolving…
                </span>
              ) : (
                <>
                  <span className="font-semibold text-ink">{resolvedName}</span>
                  <span className="px-2 py-0.5 rounded-full bg-surface text-ink-secondary">
                    {resolvedDomain}
                  </span>
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy === "__manual__" || resolving || !manualInput.trim()}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
          {manualError && <p className="text-sm text-red-600">{manualError}</p>}
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {columns.map((column) => (
          <div
            key={column.key}
            className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface-sunken p-4"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-ink">{column.title}</h2>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink-secondary">
                {column.entities.length}
              </span>
            </div>
            <p className="text-xs text-ink-secondary">{column.hint}</p>

            <div className="flex flex-col gap-3">
              {column.entities.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-line px-4 py-8 text-center">
                  <p className="text-xs text-ink-secondary">Nothing here yet.</p>
                </div>
              ) : (
                column.entities.map((entity) => (
                  <div
                    key={entity.id}
                    className="flex flex-col gap-3 rounded-[10px] bg-surface p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          RELATIONSHIP_TINT[entity.relationshipType] ?? RELATIONSHIP_TINT.other
                        }`}
                      >
                        {entity.relationshipType}
                      </span>
                      <span className="text-xs text-ink-secondary">
                        {entity.source === "discovered" ? "Found by Signal" : "Added by you"}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{entity.name}</p>
                      {entity.domain && (
                        <p className="text-xs text-ink-secondary">{entity.domain}</p>
                      )}
                    </div>
                    {entity.reason ? (
                      <p className="text-xs leading-relaxed text-ink-secondary line-clamp-3">
                        {entity.reason}
                      </p>
                    ) : null}
                    {entity.confidence != null && (
                      <p className="text-xs font-semibold text-ink-secondary">
                        {Math.round(entity.confidence * 100)}% confidence
                      </p>
                    )}

                    {bucket(entity.status) === "candidate" && (
                      <div className="mt-1 flex gap-2">
                        <button
                          onClick={() => act(entity, "confirm")}
                          disabled={busy === entity.id}
                          className="flex-1 rounded-full bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                        >
                          Track
                        </button>
                        <button
                          onClick={() => act(entity, "dismiss")}
                          disabled={busy === entity.id}
                          className="flex-1 rounded-full bg-accent-tint px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-[var(--color-accent-line)] disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}