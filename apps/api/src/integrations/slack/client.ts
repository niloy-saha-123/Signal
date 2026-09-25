// Slack Web API client.
//
// No SDK. Everything Signal needs from Slack is one authenticated POST with a
// JSON body, and the existing safeFetch already provides the timeout and byte
// cap a new dependency would bring with it.
//
// Slack's API is unusual in one way worth knowing: a failed call still returns
// HTTP 200. The real result is `{ ok: false, error: "..." }` in the body, so a
// caller that only checks the status code will believe every message was
// delivered, including the ones that were not.
import { safeFetch } from "../../lib/safe-fetch";
import { withCircuitBreaker } from "../../reliability/circuit-breaker";
import { logger } from "../../lib/logger";
import type { SlackBlock } from "./blocks";

const SLACK_API_ROOT = "https://slack.com/api";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export const SLACK_SERVICE_NAME = "slack";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

async function slackPost(
  method: string,
  token: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  // Host is the hardcoded slack.com constant, never derived from user data, so
  // there is no SSRF surface here. safeFetch is used for its timeout and cap.
  const response = await safeFetch(`${SLACK_API_ROOT}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_RESPONSE_BYTES,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Slack ${method} returned HTTP ${response.status}`);
  }

  const parsed = JSON.parse(await response.text()) as SlackApiResponse;
  // The 200-with-ok:false case. Without this, every delivery failure looks like
  // a success.
  if (!parsed.ok) {
    throw new Error(`Slack ${method} failed: ${parsed.error ?? "unknown_error"}`);
  }
  return parsed;
}

export interface PostMessageInput {
  token: string;
  channel: string;
  blocks: SlackBlock[];
  // Shown in notifications and by clients that cannot render blocks. Slack
  // sends a blocks-only message as an empty notification without it.
  fallbackText: string;
  thread_ts?: string;
}

export async function postMessage(input: PostMessageInput): Promise<{ ts: string }> {
  const result = await withCircuitBreaker(SLACK_SERVICE_NAME, () =>
    slackPost("chat.postMessage", input.token, {
      channel: input.channel,
      blocks: input.blocks,
      text: input.fallbackText,
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
    })
  );
  return { ts: result.ts ?? "" };
}

// Delivery is never allowed to fail the work that produced the message. A Slack
// outage must not cost a day's analysis run or leave a resolved prediction
// unrecorded — the durable artifact is already in Postgres, and Slack is a
// notification channel on top of it.
export async function postMessageBestEffort(input: PostMessageInput): Promise<void> {
  try {
    await postMessage(input);
  } catch (error) {
    logger.error("slack: message delivery failed — continuing", {
      channel: input.channel,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
