import { z } from "zod";

const MAX_BACKFILL_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export const HistoricalCollectionWindowSchema = z
  .object({
    competitor_id: z.string().uuid(),
    since: z.string().datetime(),
    until: z.string().datetime(),
  })
  .strict()
  .superRefine((window, context) => {
    const duration = Date.parse(window.until) - Date.parse(window.since);
    if (duration <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Backfill until must be later than since",
        path: ["until"],
      });
    } else if (duration > MAX_BACKFILL_WINDOW_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Backfill window cannot exceed 365 days",
        path: ["since"],
      });
    }
  });

export const CollectorJobDataSchema = z
  .object({
    backfill: HistoricalCollectionWindowSchema.optional(),
  })
  .strict();

export type CollectorJobData = z.infer<typeof CollectorJobDataSchema>;
export type HistoricalCollectionWindow = z.infer<typeof HistoricalCollectionWindowSchema>;

export async function resolveCollectorCompetitors<
  TCompetitor extends { id: string; is_active: boolean },
>(
  data: CollectorJobData,
  listCompetitors: () => Promise<TCompetitor[]>,
  getCompetitorById: (id: string) => Promise<TCompetitor | undefined>
): Promise<TCompetitor[]> {
  if (!data.backfill) {
    return (await listCompetitors()).filter((competitor) => competitor.is_active);
  }

  const competitor = await getCompetitorById(data.backfill.competitor_id);
  if (!competitor) {
    throw new Error(`backfill competitor ${data.backfill.competitor_id} not found`);
  }
  if (!competitor.is_active) {
    throw new Error(`backfill competitor ${data.backfill.competitor_id} is inactive`);
  }
  return [competitor];
}
