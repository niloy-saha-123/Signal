// Freeform board — drag-to-arrange score cards. Preview cards are shown ONLY with
// no session (dev-only preview); an authenticated fetch failure throws to the error
// boundary instead of rendering fake cards.
import { ApiError, getCompetitorScore, listCompetitors } from "@/lib/api";
import { previewBoardCards } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { Board, type BoardCardState } from "../board-client";
import { GoalsList } from "@/components/GoalsList";

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

  let cards: BoardCardState[] = toBoardCards(previewBoardCards());

  if (token) {
    const competitors = await listCompetitors(token);
    const scored = await Promise.all(
      competitors.map(async (competitor) => {
        const score = await getCompetitorScore(competitor.id, token).catch((error) => {
          if (error instanceof ApiError && error.status === 404) return null;
          return null;
        });
        return score ? { id: competitor.id, name: competitor.name, score: score.score } : null;
      })
    );
    cards = toBoardCards(
      scored.filter((card): card is { id: string; name: string; score: number } => card !== null)
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className=" text-4xl font-semibold tracking-[-0.035em] text-ink">
          Board
        </h1>
        <p className="text-sm font-semibold text-ink-secondary">
          Drag cards to arrange your own view. Competitors without a score aren&apos;t shown here.
        </p>
      </div>
      <GoalsList />
      <Board initialCards={cards} />
    </div>
  );
}