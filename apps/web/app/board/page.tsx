// apps/web/app/board/page.tsx
// Freeform board — exploratory first pass (see this plan's Architecture note). Only shows
// competitors with a computed score; arranges them in an initial grid.
import { ApiError, getCompetitorScore, listCompetitors } from "../../lib/api";
import { getServerAccessToken } from "../../lib/supabase-server";
import { Board, type BoardCardState } from "../board-client";

const COLUMNS = 3;
const CARD_WIDTH = 240;
const CARD_HEIGHT = 160;
const PADDING = 16;

export default async function Page() {
  const token = await getServerAccessToken();
  const competitors = await listCompetitors(token);
  const scored = await Promise.all(
    competitors.map(async (competitor) => {
      const score = await getCompetitorScore(competitor.id, token).catch((error) => {
        if (error instanceof ApiError && error.status === 404) return null;
        console.error("Failed to fetch competitor score", { competitorId: competitor.id, error });
        return null;
      });
      return score ? { id: competitor.id, name: competitor.name, score: score.score } : null;
    })
  );

  const cards: BoardCardState[] = scored
    .filter((card): card is { id: string; name: string; score: number } => card !== null)
    .map((card, index) => ({
      ...card,
      x: (index % COLUMNS) * CARD_WIDTH + PADDING,
      y: Math.floor(index / COLUMNS) * CARD_HEIGHT + PADDING,
    }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Board</h1>
      <p className="text-sm text-slate-500">
        Drag cards to arrange your own view. Exploratory first pass — competitors without a
        score yet aren&apos;t shown here.
      </p>
      <Board initialCards={cards} />
    </div>
  );
}
