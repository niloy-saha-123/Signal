// BullMQ worker — answers a Slack question with the existing chat agent.
//
// The agent is not rebuilt for Slack. This worker is a transport adapter: it
// takes a question that arrived over Slack, runs the same graph the SSE chat
// endpoint runs, and posts the result back into the thread. Same retrieval,
// same citation enforcement, same refusal behaviour.
//
// That last part matters most. The chat agent returns a structured refusal when
// the evidence is thin rather than guessing, and Slack is exactly where a guess
// would do the most damage — answers get screenshotted, forwarded, and quoted
// in decisions without anyone going back to check the sources. So a refusal is
// posted as a refusal, verbatim, not smoothed into something that sounds more
// helpful than it is.
import type { Job } from "bullmq";
import { runChatAgent } from "../../agents/chat/chat-agent";
import { registerWorker } from "../../queues/registry";
import { postMessageBestEffort } from "./client";
import type { SlackBlock } from "./blocks";
import { logger } from "../../lib/logger";
import type { SlackQuestion } from "../../api/slack";
import {
  listCompetitorsForWorkspace,
  createAgentRun,
  completeAgentRun,
  failRunIfRunning,
} from "../../db/queries";

function answerBlocks(answer: string, citations: Array<{ source: string }>): SlackBlock[] {
  const blocks: SlackBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: answer } },
  ];

  if (citations.length > 0) {
    const sources = [...new Set(citations.map((citation) => citation.source))];
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Grounded in ${citations.length} cited passage(s) · ${sources.join(", ")}` },
      ],
    });
  }

  return blocks;
}

function refusalBlocks(reason: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `I don't have enough evidence to answer that.\n\n_${reason}_`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Signal declines rather than guessing when the collected evidence is thin.",
        },
      ],
    },
  ];
}

export async function slackQuestionProcessor(job: Job<SlackQuestion>): Promise<void> {
  const question = job.data;

  let blocks: SlackBlock[];
  let fallbackText: string;
  let runId: string | null = null;

  try {
    // The chat agent scopes retrieval to a competitor set and anchors telemetry
    // to an agent_run row, exactly as the SSE route does. Slack carries neither,
    // so both are derived here: every competitor the workspace tracks, and a run
    // against the first of them.
    const competitors = await listCompetitorsForWorkspace(question.workspace_id);
    const competitorIds = competitors.filter((c) => c.is_active).map((c) => c.id);

    if (competitorIds.length === 0) {
      // Nothing to retrieve from. Saying so is more useful than a refusal that
      // sounds like the evidence was merely thin.
      await postMessageBestEffort({
        token: question.bot_token,
        channel: question.channel,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "This workspace isn't tracking any competitors yet, so there's nothing for me to search. Add one in Signal and I'll have something to work with.",
            },
          },
        ],
        fallbackText: "No competitors are being tracked yet.",
        thread_ts: question.thread_ts || undefined,
      });
      return;
    }

    const run = await createAgentRun({
      competitor_id: competitorIds[0],
      trigger: "manual",
    });
    runId = run.id;

    const result = await runChatAgent({
      query: question.question,
      workspace_id: question.workspace_id,
      competitor_ids: competitorIds,
      run_id: run.id,
    });

    await completeAgentRun(run.id, "completed");

    if (result.refused) {
      blocks = refusalBlocks(result.reason);
      fallbackText = "Signal does not have enough evidence to answer that.";
    } else {
      blocks = answerBlocks(result.answer, result.citations);
      fallbackText = result.answer.slice(0, 300);
    }
  } catch (error) {
    // Never strand the run row at "running" — the latency report reads those as
    // in-flight forever.
    if (runId) {
      await failRunIfRunning(runId).catch(() => undefined);
    }
    // The user asked a question in a channel and is waiting. Silence reads as
    // the bot being broken, which is worse than saying so.
    logger.error("slack: chat agent failed for a Slack question", {
      workspace_id: question.workspace_id,
      channel: question.channel,
      error: error instanceof Error ? error.message : String(error),
    });
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Something went wrong answering that. The failure is logged — try again in a moment.",
        },
      },
    ];
    fallbackText = "Signal could not answer that right now.";
  }

  await postMessageBestEffort({
    token: question.bot_token,
    channel: question.channel,
    blocks,
    fallbackText,
    thread_ts: question.thread_ts || undefined,
  });
}

export function initSlackQuestionWorker() {
  return registerWorker("slack-question", slackQuestionProcessor);
}
