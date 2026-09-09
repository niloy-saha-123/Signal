// LangGraph node — infers competitor hiring intent from recent job postings (GPT-4o).
import type { AnalysisGraphState } from "../../graph/state";
import { logger } from "../../lib/logger";

export async function intentAnalyzerNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  logger.warn("intentAnalyzerNode: not yet implemented (Part 10) — returning no-op update", {
    competitor_id: state.competitor_id,
  });
  return {};
}
