import { ApiError, getCompetitorScore, listCompetitors } from "@/lib/api";
import { previewBoardCards } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { Board, type BoardCardState } from "../board-client";

const COLUMNS = 3;
const CARD_WIDTH = 240;
const CARD_HEIGHT = 160;
const PADDING = 16;

function toBoardCards(cards: { id: string; name: string; score: number }[]): BoardCardState[] {
  return cards.map((card, index) => ({
    ...card,
    x: (index % COLUMNS) * CARD_WIDTH + PADDING,
    y: Math.floor(index / COLUMNS) * CARD_HEIGHT + PADDING,
  }));
}

export default async function Page() {
  const token = await getOptionalAccessToken();
  let cards = toBoardCards(previewBoardCards());

  if (token) {
    try {
      const competitors = await listCompetitors(token);
      const scored = await Promise.all(
        competitors.map(async (competitor) => {
          const score = await getCompetitorScore(competitor.id, token).catch((error) => {
            if (error instanceof ApiError && error.status === 404) return null;
            console.error("Failed to fetch competitor score", {
              competitorId: competitor.id,
              error,
            });
            return null;
          });
          return score ? { id: competitor.id, name: competitor.name, score: score.score } : null;
        }),
      );
      cards = toBoardCards(
        scored.filter((card): card is { id: string; name: string; score: number } => card !== null),
      );
    } catch {
      cards = toBoardCards(previewBoardCards());
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
          Board
        </h1>
        <p className="text-sm font-semibold text-studio-muted">
          Drag cards to arrange your own view. Competitors without a score aren&apos;t shown here.
        </p>
      </div>
      <Board initialCards={cards} />
    </div>
  );
}
