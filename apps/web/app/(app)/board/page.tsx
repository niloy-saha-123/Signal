// Competitors — everyone being watched, ranked by activity, with the next
// forecast for each. Preview rows are shown ONLY with no session (dev-only
// preview) and never carry forecasts; an authenticated fetch failure throws to
// the error boundary instead of rendering fake rows.
import { getCompetitorScore, listCompetitors, listPredictions } from "@/lib/api";
import { PREVIEW_COMPETITORS, previewBoardCards } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { CompetitorBoard, type BoardRow } from "../board-client";

export default async function Page() {
  const token = await getOptionalAccessToken();

  if (!token) {
    const domains = new Map(PREVIEW_COMPETITORS.map((c) => [c.id, c.domain]));
    const rows: BoardRow[] = previewBoardCards().map((card) => ({
      ...card,
      domain: domains.get(card.id) ?? "",
      delta: null,
      openForecasts: 0,
      next: null,
      discovering: false,
    }));
    return <CompetitorBoard rows={rows} />;
  }

  const watched = (await listCompetitors(token)).filter((competitor) => !competitor.is_own_company);
  if (watched.length === 0) return <CompetitorBoard rows={[]} />;

  const [scores, open] = await Promise.all([
    Promise.all(watched.map((competitor) => getCompetitorScore(competitor.id, token).catch(() => null))),
    listPredictions({ status: "open", limit: 200 }, token).catch(() => []),
  ]);

  const rows: BoardRow[] = watched.map((competitor, index) => {
    const forecasts = open
      .filter((prediction) => prediction.competitor_id === competitor.id)
      .sort((a, b) => new Date(a.resolves_at).getTime() - new Date(b.resolves_at).getTime());
    const next = forecasts[0];
    return {
      id: competitor.id,
      name: competitor.name,
      domain: competitor.domain,
      score: scores[index]?.score ?? null,
      delta: scores[index]?.delta_7d ?? null,
      openForecasts: forecasts.length,
      next: next
        ? { id: next.id, statement: next.statement, probability: next.probability, resolvesAt: next.resolves_at }
        : null,
      discovering: competitor.discovery_status !== "complete" && competitor.discovery_status !== "failed",
    };
  });

  return <CompetitorBoard rows={rows} />;
}
