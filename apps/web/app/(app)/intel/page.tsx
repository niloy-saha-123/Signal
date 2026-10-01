// Evidence — everything Signal collected, labelled by source, filterable and
// searchable, with a 30-day coverage strip. Preview data only without a session.
import { SignalSourceSchema, type Signal } from "@signal/shared";
import { SignalFeed } from "@/components/SignalFeed";
import { DataCoverage } from "@/components/DataCoverage";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { EvidenceAreaTabs } from "@/components/evidence/parts";
import { PageHeader } from "@/components/ui/primitives";
import { listCompetitors, listSignals, type Competitor } from "@/lib/api";
import { PREVIEW_COMPETITORS, PREVIEW_SIGNALS } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { IntelFilters } from "../intel-filters";

type IntelSearch = {
  q?: string;
  source?: string;
  competitor_id?: string;
  min_quality?: string;
  from?: string;
  to?: string;
};

// ponytail: search runs over the newest 100 fetched signals, not the whole
// archive; move it server-side when the API grows a text query.
function matches(signal: Signal, q: string) {
  const needle = q.toLowerCase();
  return (signal.title ?? "").toLowerCase().includes(needle) || signal.raw_text.toLowerCase().includes(needle);
}

function renderIntel(competitors: Competitor[], signals: Signal[], q: string) {
  const visible = q ? signals.filter((signal) => matches(signal, q)) : signals;
  const exportRows = visible.map((signal) => ({
    source: signal.source,
    title: signal.title ?? "",
    text: signal.raw_text,
    quality_score: signal.quality_score,
    source_url: signal.source_url ?? "",
    collected_at: signal.collected_at,
  }));

  return (
    <div>
      <PageHeader
        title="Evidence"
        description="Everything Signal collected, labelled by where it came from. Forecasts and alerts are built from this."
        action={<EvidenceAreaTabs active="feed" />}
      />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <IntelFilters competitors={competitors} />
        <ExportCsvButton
          rows={exportRows}
          columns={[
            { key: "source", label: "Source" },
            { key: "title", label: "Title" },
            { key: "text", label: "Text" },
            { key: "quality_score", label: "Quality" },
            { key: "source_url", label: "URL" },
            { key: "collected_at", label: "Collected at" },
          ]}
          filename="signal-evidence.csv"
        />
      </div>
      <div className="mb-4">
        <DataCoverage dates={signals.map((signal) => signal.collected_at)} />
      </div>
      <section aria-label="Evidence feed" className="rounded-[14px] border border-line bg-surface p-5">
        <SignalFeed
          signals={visible}
          competitorIds={competitors.map((competitor) => competitor.id)}
          competitorNames={Object.fromEntries(competitors.map((competitor) => [competitor.id, competitor.name]))}
          {...(q
            ? { emptyTitle: `Nothing matches “${q}”`, emptyNote: "Try fewer words, or clear the other filters." }
            : competitors.length === 0
              ? { emptyTitle: "No evidence yet", emptyNote: "Add a competitor and Signal starts collecting within minutes." }
              : {})}
        />
      </section>
    </div>
  );
}

export default async function IntelPage({ searchParams }: { searchParams: Promise<IntelSearch> }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 200);
  const token = await getOptionalAccessToken();

  if (!token) {
    return renderIntel(PREVIEW_COMPETITORS, PREVIEW_SIGNALS, q);
  }

  const competitors = await listCompetitors(token);
  const competitorIds = competitors.map((competitor) => competitor.id);
  const source = SignalSourceSchema.safeParse(params.source);
  const minQuality = Number(params.min_quality);
  const result =
    competitorIds.length === 0
      ? { data: [] }
      : await listSignals(
          {
            competitor_ids:
              params.competitor_id && competitorIds.includes(params.competitor_id) ? [params.competitor_id] : competitorIds,
            sources: source.success ? [source.data] : undefined,
            min_quality: minQuality > 0 && minQuality <= 1 ? minQuality : undefined,
            created_after: params.from || undefined,
            created_before: params.to || undefined,
            limit: 100,
          },
          token
        );

  return renderIntel(competitors, result.data, q);
}
