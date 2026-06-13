// Competitor detail page showing the live signal feed, trend charts, and alert history.
export default async function CompetitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <h1>Competitor {id}</h1>
      {/* TODO: SignalFeed, TrendChart, HiringChart, AlertBanner */}
    </main>
  );
}
