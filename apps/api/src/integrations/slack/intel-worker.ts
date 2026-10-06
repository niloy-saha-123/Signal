// Files field intel submitted from the Slack modal, then DMs the submitter the
// outcome. The modal had to close within 3 seconds, so the page fetch and the
// write happen here.
import type { Job } from "bullmq";
import { registerWorker } from "../../queues/registry";
import { logger } from "../../lib/logger";
import * as queries from "../../db/queries";
import {
  defaultFieldIntelDeps,
  submitFieldIntel,
  type FieldIntelDeps,
} from "../../pipeline/field-intel";
import { postMessageBestEffort } from "./client";
import { escapeMrkdwn } from "./blocks";

export interface SlackIntel {
  workspace_id: string;
  team_id: string;
  user: string;
  competitor_id: string;
  note: string;
  url?: string;
  // The modal's view id: one submission, one job.
  dedupe_key: string;
}

export interface SlackIntelDeps {
  getSlackInstallation: typeof queries.getSlackInstallation;
  getCompetitorByIdForWorkspace: typeof queries.getCompetitorByIdForWorkspace;
  fieldIntel: FieldIntelDeps;
  postMessage: typeof postMessageBestEffort;
}

const defaultDeps: SlackIntelDeps = {
  getSlackInstallation: queries.getSlackInstallation,
  getCompetitorByIdForWorkspace: queries.getCompetitorByIdForWorkspace,
  fieldIntel: defaultFieldIntelDeps,
  postMessage: postMessageBestEffort,
};

export async function slackIntelProcessor(
  job: Job<SlackIntel>,
  deps: SlackIntelDeps = defaultDeps,
): Promise<void> {
  const intel = job.data;
  const installation = await deps.getSlackInstallation(intel.team_id);
  if (!installation || installation.workspace_id !== intel.workspace_id) {
    logger.warn(
      "slack: intel for a team that is no longer connected — dropping",
      { team_id: intel.team_id },
    );
    return;
  }

  const dm = (text: string) =>
    deps.postMessage({
      token: installation.bot_token,
      channel: intel.user,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      fallbackText: text,
    });

  const competitor = await deps.getCompetitorByIdForWorkspace(
    intel.competitor_id,
    intel.workspace_id,
  );
  if (!competitor) {
    await dm(
      "That competitor is no longer in Signal, so the intel wasn't saved.",
    );
    return;
  }
  const name = escapeMrkdwn(competitor.name);

  try {
    const result = await submitFieldIntel(deps.fieldIntel, {
      workspace_id: intel.workspace_id,
      competitor_id: intel.competitor_id,
      note: intel.note,
      url: intel.url,
      submitted_by: `slack:${intel.team_id}:${intel.user}`,
    });
    if (result.status === "created") {
      await dm(
        result.fetched || !intel.url
          ? `Saved to *${name}*. Signal will fold it into the next analysis.`
          : `Saved to *${name}*. The link couldn't be read, so only your note was kept.`,
      );
    } else if (result.status === "duplicate") {
      await dm(`*${name}* already has that link, so nothing new was saved.`);
    } else {
      await dm(
        "Too many intel submissions from this workspace right now. Try again in a little while.",
      );
    }
  } catch (error) {
    logger.error("slack: field intel failed", {
      workspace_id: intel.workspace_id,
      competitor_id: intel.competitor_id,
      error: error instanceof Error ? error.message : String(error),
    });
    await dm(
      "Something went wrong saving that. The failure is logged — try again in a moment.",
    );
  }
}

export function initSlackIntelWorker() {
  return registerWorker("slack-intel", (job: Job<SlackIntel>) =>
    slackIntelProcessor(job),
  );
}
