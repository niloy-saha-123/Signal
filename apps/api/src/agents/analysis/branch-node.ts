// Shared failure-isolation + budget-gate helpers for the 5 analysis branch nodes
// (intent-analyzer, sentiment-clusterer, change-detector, pattern-detector,
// vulnerability-detector). synthesis is deliberately NOT a consumer — its persist/decision
// failures are legitimately fatal (no Signal Score without them) and its caller owns the
// agent_runs row lifecycle on that throw.
import type { AgentName } from "@signal/shared";
import type { AnalysisGraphStateType } from "../../graph/state";
import { logger } from "../../lib/logger";
import { getDailyBudget } from "../../llm/adaptive-router";
import { getDailySpend } from "../../llm/cost-tracker";

interface BranchNodeContext {
  competitor_id: string;
  run_id: string;
}

// H1 / production-review M4: a thrown error in one branch node must degrade that branch to
// "couldn't determine anything" (`{}`) rather than abort the whole graph run — synthesis's
// 5-way fan-in is fully null-tolerant (every compute* helper handles null/[]). The error is
// logged with full debuggable context first (the M4 gap: non-parse failures had none).
//
// `{}` on failure is distinct from a branch's genuine empty-input result (e.g.
// intent-analyzer's `{ hiring_intent: { ..., intent_level: "low" } }`) — that real "we
// looked, there's nothing" outcome is returned from inside `body` and passes straight
// through.
export async function runBranchNode(
  agentName: AgentName,
  ctx: BranchNodeContext,
  body: () => Promise<Partial<AnalysisGraphStateType>>
): Promise<Partial<AnalysisGraphStateType>> {
  try {
    return await body();
  } catch (error) {
    logger.error(
      "analysis branch node failed — degrading to an empty result so the synthesis fan-in still completes",
      { agent_name: agentName, competitor_id: ctx.competitor_id, run_id: ctx.run_id, error }
    );
    return {};
  }
}

// H3: hard daily-budget stop for the branch LLM calls. Same pattern as
// pipeline/entity-extractor.ts's gate — selectModel only downgrades, it never blocks, so a
// caller whose model has no cheaper target (or who has already downgraded) needs this
// explicit stop or the budget is unenforced for them.
//
// getDailySpend() fails safe to Infinity on a DB error (documented in cost-tracker.ts) —
// that means "skip the LLM during a Postgres outage", which is the intended posture.
export async function isLlmBudgetExhausted(
  agentName: AgentName,
  ctx: BranchNodeContext
): Promise<boolean> {
  const budget = getDailyBudget();
  const spend = await getDailySpend();
  if (spend >= budget) {
    logger.warn("analysis branch node: daily LLM budget reached — skipping the LLM call", {
      agent_name: agentName,
      competitor_id: ctx.competitor_id,
      run_id: ctx.run_id,
      spend,
      budget,
    });
    return true;
  }
  return false;
}
