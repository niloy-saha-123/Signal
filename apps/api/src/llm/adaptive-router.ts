// Runtime model selection — downgrades eligible tasks to cheaper models under budget pressure.
import { getDailySpend } from "./cost-tracker";

const DOWNGRADE_MAP: Record<string, string> = {
  "gpt-4o": "gpt-4o-mini",
  "claude-sonnet": "claude-haiku",
};

export async function selectModel(
  preferredModel: string,
  eligibleForDowngrade: boolean
): Promise<string> {
  if (!eligibleForDowngrade) return preferredModel;

  const downgradeTarget = DOWNGRADE_MAP[preferredModel];
  if (!downgradeTarget) return preferredModel;

  const dailyBudget = Number(process.env.DAILY_BUDGET_USD ?? 2.0);
  const spend = await getDailySpend();

  return spend >= dailyBudget ? downgradeTarget : preferredModel;
}
