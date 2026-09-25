// Outbound Slack delivery for alerts and predictions.
//
// Every function here is best-effort and returns void. That is the whole
// contract: Slack is a notification channel layered on top of Postgres, never
// the record. A Slack outage must not fail a day's analysis run, must not leave
// a resolved prediction unwritten, and must not surface to the caller as
// anything they have to handle.
//
// The two silent-skip paths are deliberate. No installation means the workspace
// never connected Slack. No channel means they connected it but never chose
// where messages go — and posting competitive intelligence into an arbitrary
// channel because none was configured is worse than not posting at all.
import { getSlackInstallationForWorkspace } from "../../db/queries";
import { postMessage } from "./client";
import { predictionBlocks, alertBlocks, resolutionBlocks } from "./blocks";
import type { PredictionMessage, ResolutionMessage, AlertMessage } from "./blocks";
import type { SlackBlock } from "./blocks";
import { logger } from "../../lib/logger";

async function deliver(
  workspaceId: string,
  build: () => { blocks: SlackBlock[]; fallbackText: string }
): Promise<void> {
  try {
    const installation = await getSlackInstallationForWorkspace(workspaceId);
    if (!installation) return;
    if (!installation.default_channel) return;

    const { blocks, fallbackText } = build();
    await postMessage({
      token: installation.bot_token,
      channel: installation.default_channel,
      blocks,
      fallbackText,
    });
  } catch (error) {
    logger.error("slack: delivery failed — the underlying work is unaffected", {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deliverPredictionToSlack(
  workspaceId: string,
  prediction: PredictionMessage
): Promise<void> {
  await deliver(workspaceId, () => ({
    blocks: predictionBlocks(prediction),
    fallbackText: `New prediction about ${prediction.competitor_name}: ${prediction.statement}`,
  }));
}

export async function deliverResolutionToSlack(
  workspaceId: string,
  resolution: ResolutionMessage
): Promise<void> {
  await deliver(workspaceId, () => ({
    blocks: resolutionBlocks(resolution),
    fallbackText: `Prediction resolved (${resolution.status}): ${resolution.statement}`,
  }));
}

export async function deliverAlertToSlack(
  workspaceId: string,
  alert: AlertMessage
): Promise<void> {
  await deliver(workspaceId, () => ({
    blocks: alertBlocks(alert),
    fallbackText: `${alert.competitor_name}: ${alert.pattern}`,
  }));
}
