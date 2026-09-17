// apps/web/app/intel/page.tsx
// Full signal feed — filterable by source and competitor. Filtering lives here, not in
// SignalFeed (Part 5's deliberate scope boundary).
import { listCompetitors, listSignals, type SignalSource } from "../../lib/api";
import { getServerAccessToken } from "../../lib/supabase-server";
import { SignalFeed } from "../../components/SignalFeed";
import { IntelFilters } from "../intel-filters";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const token = await getServerAccessToken();
  const competitors = await listCompetitors(token);
  const competitorIds = params.competitor_id ? [params.competitor_id] : competitors.map((c) => c.id);

  const { data: signals } = await listSignals(
    {
      competitor_ids: competitorIds,
      sources: params.source ? [params.source as SignalSource] : undefined,
    },
    token
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Header with search */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-4xl font-semibold text-slate-900">Intel</h1>
        <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm">
          <span className="text-sm text-slate-400">Search intel...</span>
        </div>
      </div>

      {/* Filters */}
      <IntelFilters competitors={competitors} />

      {/* Signal Feed */}
      <SignalFeed signals={signals} competitorIds={competitorIds} />
    </div>
  );
}
