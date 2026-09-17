import type { SignalSource } from "@signal/shared";
import { SignalFeed } from "@/components/SignalFeed";
import { listCompetitors, listSignals } from "@/lib/api";
import {
  PREVIEW_COMPETITORS,
  PREVIEW_SIGNALS,
} from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { IntelFilters } from "../intel-filters";

type IntelSearch = {
  source?: string;
  competitor_id?: string;
};

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<IntelSearch>;
}) {
  const params = await searchParams;
  const token = await getOptionalAccessToken();

  let competitors = PREVIEW_COMPETITORS;
  let signals = PREVIEW_SIGNALS;

  if (token) {
    try {
      competitors = await listCompetitors(token);
      const competitorIds = competitors.map((competitor) => competitor.id);
      if (competitorIds.length === 0) {
        signals = [];
      } else {
        const result = await listSignals(
          {
            competitor_ids: params.competitor_id ? [params.competitor_id] : competitorIds,
            sources: params.source ? [params.source as SignalSource] : undefined,
            limit: 50,
          },
          token,
        );
        signals = result.data;
      }
    } catch {
      competitors = PREVIEW_COMPETITORS;
      signals = PREVIEW_SIGNALS;
    }
  }

  const visibleSignals = signals.filter((signal) => {
    if (params.competitor_id && signal.competitor_id !== params.competitor_id) return false;
    if (params.source && signal.source !== params.source) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
          Intel
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-studio-muted">
          Raw collected evidence, still labeled by source. Filter the trail before you ask
          research chat to interpret it.
        </p>
      </div>
      <IntelFilters competitors={competitors} />
      <div className="rounded-[1.6rem] border border-studio-line bg-studio-paper p-5 sm:p-6">
        <SignalFeed
          signals={visibleSignals}
          competitorIds={competitors.map((competitor) => competitor.id)}
        />
      </div>
    </div>
  );
}
