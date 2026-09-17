"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createCompetitor, resumeDiscovery, triggerDiscovery } from "@/lib/api";

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
  competitor: "bg-studio-action-soft text-studio-action",
  aspirational: "bg-[#ede9fe] text-[#6d28d9]",
  other: "bg-studio-sky-soft text-studio-muted",
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
  const [manualName, setManualName] = useState("");
  const [manualDomain, setManualDomain] = useState("");
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

  async function addManually(event: FormEvent) {
    event.preventDefault();
    if (!manualName.trim() || !manualDomain.trim()) return;
    setBusy("__manual__");
    setManualError(null);
    try {
      await createCompetitor({ name: manualName.trim(), domain: manualDomain.trim() });
      setManualName("");
      setManualDomain("");
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
          <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
            Discovery
          </h1>
          <p className="text-sm text-studio-muted">
            {total === 0
              ? "Companies Signal suggests watching, and the ones you've already decided on."
              : `${total} tracked ${total === 1 ? "company" : "companies"} across the board.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setManualOpen((open) => !open)}
            className="inline-flex min-h-11 items-center rounded-full border border-studio-line bg-studio-paper px-5 text-sm font-bold text-studio-ink transition-colors hover:bg-studio-sky-soft"
          >
            Add competitor manually
          </button>
          <button
            onClick={startDiscovery}
            disabled={busy === "__trigger__"}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-studio-ink px-5 text-sm font-bold text-white transition-colors hover:bg-[#071625] disabled:opacity-50"
          >
            {busy === "__trigger__" ? "Scanning…" : "Find new competitors"}
          </button>
        </div>
      </div>

      {manualOpen && (
        <form
          onSubmit={addManually}
          className="flex flex-wrap items-end gap-3 rounded-[1.6rem] border border-studio-line bg-studio-paper p-6"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold text-studio-ink">
            Name
            <input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              required
              placeholder="Notion"
              className="rounded-full bg-studio-sky-soft px-4 py-2.5 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-studio-ink">
            Domain
            <input
              value={manualDomain}
              onChange={(e) => setManualDomain(e.target.value)}
              required
              placeholder="notion.so"
              className="rounded-full bg-studio-sky-soft px-4 py-2.5 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
            />
          </label>
          <button
            type="submit"
            disabled={busy === "__manual__"}
            className="rounded-full bg-studio-action px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-studio-action-hover disabled:opacity-50"
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
            className="flex flex-col gap-3 rounded-[1.6rem] border border-studio-line bg-studio-sky-soft p-4"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-studio-ink">{column.title}</h2>
              <span className="rounded-full bg-studio-paper px-2 py-0.5 text-xs font-semibold text-studio-muted">
                {column.entities.length}
              </span>
            </div>
            <p className="text-xs text-studio-muted">{column.hint}</p>

            <div className="flex flex-col gap-3">
              {column.entities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-studio-line px-4 py-8 text-center">
                  <p className="text-xs text-studio-muted">Nothing here yet.</p>
                </div>
              ) : (
                column.entities.map((entity) => (
                  <div
                    key={entity.id}
                    className="flex flex-col gap-3 rounded-2xl bg-studio-paper p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          RELATIONSHIP_TINT[entity.relationshipType] ?? RELATIONSHIP_TINT.other
                        }`}
                      >
                        {entity.relationshipType}
                      </span>
                      <span className="text-xs text-studio-muted">
                        {entity.source === "discovered" ? "Found by Signal" : "Added by you"}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-studio-ink">{entity.name}</p>
                      {entity.domain && (
                        <p className="text-xs text-studio-muted">{entity.domain}</p>
                      )}
                    </div>
                    {entity.reason ? (
                      <p className="text-xs leading-relaxed text-studio-muted line-clamp-3">
                        {entity.reason}
                      </p>
                    ) : null}
                    {entity.confidence != null && (
                      <p className="text-xs font-semibold text-studio-muted">
                        {Math.round(entity.confidence * 100)}% confidence
                      </p>
                    )}

                    {bucket(entity.status) === "candidate" && (
                      <div className="mt-1 flex gap-2">
                        <button
                          onClick={() => act(entity, "confirm")}
                          disabled={busy === entity.id}
                          className="flex-1 rounded-full bg-studio-action px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-studio-action-hover disabled:opacity-50"
                        >
                          Track
                        </button>
                        <button
                          onClick={() => act(entity, "dismiss")}
                          disabled={busy === entity.id}
                          className="flex-1 rounded-full bg-studio-sky px-3 py-2 text-xs font-bold text-studio-ink transition-colors hover:bg-studio-sky-deep disabled:opacity-50"
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