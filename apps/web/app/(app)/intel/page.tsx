import type { SignalSource } from "@signal/shared";
import { SignalFeed } from "@/components/SignalFeed";
import { DataCoverage } from "@/components/DataCoverage";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { listCompetitors, listSignals } from "@/lib/api";
import { PREVIEW_COMPETITORS, PREVIEW_SIGNALS } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { IntelFilters } from "../intel-filters";

type IntelSearch = {
  source?: string;
  competitor_id?: string;
  from?: string;
  to?: string;
};

function renderIntel(competitors: typeof PREVIEW_COMPETITORS, signals: typeof PREVIEW_SIGNALS) {
  const exportRows = signals.map((signal) => ({
    source: signal.source,
    title: signal.title ?? "",
    text: signal.raw_text,
    quality_score: signal.quality_score,
    source_url: signal.source_url ?? "",
    collected_at: signal.collected_at,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
            Intel
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-studio-muted">
            Raw collected evidence, still labeled by source. Filter the trail before you ask
            research chat to interpret it.
          </p>
        </div>
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
          filename="signal-intel.csv"
        />
      </div>
      <IntelFilters competitors={competitors} />
      <DataCoverage dates={signals.map((signal) => signal.collected_at)} />
      <div className="rounded-[1.6rem] border border-studio-line bg-studio-paper p-5 sm:p-6">
        <SignalFeed signals={signals} competitorIds={competitors.map((competitor) => competitor.id)} />
      </div>
    </div>
  );
}

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<IntelSearch>;
}) {
  const params = await searchParams;
  const token = await getOptionalAccessToken();

  if (!token) {
    return renderIntel(PREVIEW_COMPETITORS, PREVIEW_SIGNALS);
  }

  const competitors = await listCompetitors(token);
  const competitorIds = competitors.map((competitor) => competitor.id);
  const result =
    competitorIds.length === 0
      ? { data: [] }
      : await listSignals(
          {
            competitor_ids: params.competitor_id ? [params.competitor_id] : competitorIds,
            sources: params.source ? [params.source as SignalSource] : undefined,
            created_after: params.from || undefined,
            created_before: params.to || undefined,
            limit: 100,
          },
          token
        );

  return renderIntel(competitors, result.data);
}