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

// ok:false answers that mean Slack itself is struggling. Every other error code
// (not_in_channel, invalid_auth, token_revoked, ...) is one workspace's problem
// and must not count against the breaker shared by every workspace.
const TRANSPORT_ERRORS = new Set([
  "ratelimited",
  "service_unavailable",
  "fatal_error",
  "internal_error",
]);

async function slackPost(
  method: string,
  token: string,
  body: Record<string, unknown>,
  timeoutMs = REQUEST_TIMEOUT_MS
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
    signal: AbortSignal.timeout(timeoutMs),
    maxBytes: MAX_RESPONSE_BYTES,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Slack ${method} returned HTTP ${response.status}`);
  }

  const parsed = JSON.parse(await response.text()) as SlackApiResponse;
  // The 200-with-ok:false case. Without this, every delivery failure looks like
  // a success.
  if (!parsed.ok && TRANSPORT_ERRORS.has(parsed.error ?? "")) {
    throw new Error(`Slack ${method} failed: ${parsed.error}`);
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
  if (!result.ok) {
    throw new Error(`Slack chat.postMessage failed: ${result.error ?? "unknown_error"}`);
  }
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

// Slack voids a trigger_id 3 seconds after the click, so views.open gets a
// short timeout and no retry.
const VIEWS_OPEN_TIMEOUT_MS = 2_500;

export async function openView(token: string, triggerId: string, view: Record<string, unknown>): Promise<void> {
  const result = await withCircuitBreaker(SLACK_SERVICE_NAME, () =>
    slackPost("views.open", token, { trigger_id: triggerId, view }, VIEWS_OPEN_TIMEOUT_MS)
  );
  if (!result.ok) throw new Error(`Slack views.open failed: ${result.error ?? "unknown_error"}`);
}

// response_url comes from a signed Slack payload, but it is still a URL we
// were handed, so only Slack's own hook host is ever fetched.
export function isSlackResponseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "hooks.slack.com" && !parsed.port;
  } catch {
    return false;
  }
}

export interface ResponseUrlMessage {
  response_type: "in_channel" | "ephemeral";
  blocks: SlackBlock[];
  text: string;
}

export async function postToResponseUrl(url: string, message: ResponseUrlMessage): Promise<void> {
  if (!isSlackResponseUrl(url)) throw new Error("refusing a response_url outside hooks.slack.com");
  const response = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_RESPONSE_BYTES,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Slack response_url returned HTTP ${response.status}`);
  }
}
