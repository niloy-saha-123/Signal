// Runtime model selection — downgrades eligible tasks to cheaper models under budget pressure.
import { getDailySpend } from "./cost-tracker";
import { logger } from "../lib/logger";

const DOWNGRADE_MAP: Record<string, string> = {
  "gpt-4o": "gpt-4o-mini",
  "claude-sonnet": "claude-haiku",
};

const DEFAULT_DAILY_BUDGET_USD = 2.0;

let warnedBadBudgetEnv = false;

// Exported so callers whose preferred model has no downgrade target (the whole
// DOWNGRADE_MAP miss path below) can still enforce the budget as a hard stop —
// otherwise DAILY_BUDGET_USD is unenforced for them.
export function getDailyBudget(): number {
  const raw = process.env.DAILY_BUDGET_USD;
  const parsed = Number(raw ?? DEFAULT_DAILY_BUDGET_USD);

  if (Number.isNaN(parsed)) {
    if (!warnedBadBudgetEnv) {
      logger.warn("DAILY_BUDGET_USD is not a valid number, falling back to default", {
        value: raw,
        default: DEFAULT_DAILY_BUDGET_USD,
      });
      warnedBadBudgetEnv = true;
    }
    return DEFAULT_DAILY_BUDGET_USD;
  }

  return parsed;
}

export async function selectModel(
  preferredModel: string,
  eligibleForDowngrade: boolean
): Promise<string> {
  if (!eligibleForDowngrade) return preferredModel;

  const downgradeTarget = DOWNGRADE_MAP[preferredModel];
  if (!downgradeTarget) return preferredModel;

  const dailyBudget = getDailyBudget();
  const spend = await getDailySpend();

  return spend >= dailyBudget ? downgradeTarget : preferredModel;
}
