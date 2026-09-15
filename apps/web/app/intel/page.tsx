// apps/web/app/intel/page.tsx
// Full signal feed — filterable by source and competitor. Filtering lives here, not in
// SignalFeed (Part 5's deliberate scope boundary).
import { listCompetitors, listSignals, type SignalSource } from "../../lib/api";
import { SignalFeed } from "../../components/SignalFeed";
import { IntelFilters } from "../intel-filters";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const competitors = await listCompetitors();
  const competitorIds = params.competitor_id ? [params.competitor_id] : competitors.map((c) => c.id);

  const { data: signals } = await listSignals({
    competitor_ids: competitorIds,
    sources: params.source ? [params.source as SignalSource] : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Intel</h1>
      <IntelFilters competitors={competitors} />
      <SignalFeed signals={signals} competitorIds={competitorIds} />
    </div>
  );
}
