"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddCompetitorForm } from "@/components/AddCompetitorForm";
import { CompetitorAreaTabs } from "@/components/competitors/parts";
import { Icon } from "@/components/ui/icons";
import { Badge, Button, EmptyState, PageHeader, Tabs } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { resumeDiscovery, triggerDiscovery } from "@/lib/api";

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

type View = "candidate" | "confirmed" | "dismissed";

const VIEW_LABEL: Record<View, string> = {
  candidate: "Suggested",
  confirmed: "Tracking",
  dismissed: "Dismissed",
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  competitor: "Direct competitor",
  aspirational: "One to learn from",
  other: "Adjacent",
};

function bucket(status: string): View {
  if (status === "confirmed") return "confirmed";
  if (status === "dismissed") return "dismissed";
  return "candidate";
}

export function DiscoveryBoard({ entities }: { entities: DiscoveryEntity[] }) {
  const router = useRouter();
  const [view, setView] = useState<View>("candidate");
  // Optimistic decisions, keyed by entity id. Removed again if the API refuses.
  const [decided, setDecided] = useState<Record<string, View>>({});
  const [scanning, setScanning] = useState(false);

  const statusOf = (entity: DiscoveryEntity) => decided[entity.id] ?? bucket(entity.status);
  const inView = (v: View) => entities.filter((entity) => statusOf(entity) === v);

  async function decide(entity: DiscoveryEntity, decision: "confirm" | "dismiss") {
    setDecided((current) => ({ ...current, [entity.id]: decision === "confirm" ? "confirmed" : "dismissed" }));
    try {
      await resumeDiscovery(entity.workspaceId, decision);
      toast(
        decision === "confirm"
          ? `Now watching ${entity.name}. Signal is finding its sources.`
          : `Dismissed ${entity.name}. It won't be suggested again.`,
        "success"
      );
      router.refresh();
    } catch {
      setDecided(({ [entity.id]: _, ...rest }) => rest);
      toast(`Couldn't save that decision about ${entity.name}. Try again.`, "error");
    }
  }

  async function findMore() {
    setScanning(true);
    try {
      await triggerDiscovery();
      toast("Looking for competitors. New suggestions show up here in a few minutes.", "success");
      router.refresh();
    } catch {
      toast("Couldn't start a search right now. Try again in a moment.", "error");
    } finally {
      setScanning(false);
    }
  }

  const findButton = (
    <Button size="sm" onClick={findMore} disabled={scanning}>
      <Icon name="search" className="h-4 w-4" />
      {scanning ? "Looking…" : "Find competitors"}
    </Button>
  );

  const visible = inView(view);

  return (
    <div>
      <PageHeader
        title="Candidates"
        description="Companies Signal thinks you should watch. Keep the ones that matter, dismiss the rest."
        action={<CompetitorAreaTabs active="candidates" />}
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <Tabs
          label="Candidate status"
          active={view}
          onChange={setView}
          items={(Object.keys(VIEW_LABEL) as View[]).map((v) => ({
            value: v,
            label: VIEW_LABEL[v],
            count: inView(v).length,
          }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="w-full sm:w-80">
            <AddCompetitorForm />
          </div>
          {findButton}
        </div>
      </div>

      {visible.length === 0 ? (
        view === "candidate" ? (
          <EmptyState
            title="No suggestions waiting"
            note="Signal suggests companies that sell to the same buyers as you. Run a search, or add one you already know about."
            action={findButton}
          />
        ) : (
          <EmptyState compact title={view === "confirmed" ? "Nothing tracked from here yet" : "Nothing dismissed"} />
        )
      ) : (
        <ul aria-label={VIEW_LABEL[view]} className="grid gap-3 md:grid-cols-2">
          {visible.map((entity) => (
            <li key={entity.id} className="flex flex-col rounded-[14px] border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={entity.relationshipType === "competitor" ? "accent" : "neutral"}>
                  {RELATIONSHIP_LABEL[entity.relationshipType] ?? RELATIONSHIP_LABEL.other}
                </Badge>
                <span className="text-[12.5px] text-ink-muted">
                  {entity.source === "discovered" ? "Found by Signal" : "Added by you"}
                </span>
                {entity.confidence != null ? (
                  <span className="tnum ml-auto text-[12.5px] font-semibold text-ink-secondary">
                    {Math.round(entity.confidence * 100)}% match
                  </span>
                ) : null}
              </div>
              <p className="mt-3 truncate text-[16px] font-semibold text-ink">{entity.name}</p>
              {entity.domain ? <p className="truncate text-[13px] text-ink-muted">{entity.domain}</p> : null}
              {entity.reason ? (
                <p className="mt-2 line-clamp-3 text-[14px] text-ink-secondary">{entity.reason}</p>
              ) : null}
              {view === "candidate" ? (
                <div className="mt-4 flex gap-2 pt-1">
                  <Button variant="primary" size="sm" onClick={() => decide(entity, "confirm")} aria-label={`Watch ${entity.name}`}>
                    <Icon name="plus" className="h-4 w-4" />
                    Watch
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => decide(entity, "dismiss")} aria-label={`Dismiss ${entity.name}`}>
                    Dismiss
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
