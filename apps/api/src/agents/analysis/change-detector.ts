// LangGraph node — conditional pricing-change extraction, fires only when a diff is detected (GPT-4o-mini).
import type { AnalysisGraphState } from "../../graph/state";
import { logger } from "../../lib/logger";

export async function changeDetectorNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  logger.warn("changeDetectorNode: not yet implemented (Part 10) — returning no-op update", {
    competitor_id: state.competitor_id,
  });
  return {};
}
