// "Add to Slack" OAuth v2. The state parameter is the only thing that ties a
// returning browser to a Signal workspace: the callback is public (Slack
// redirects a browser there with no bearer token), so state is HMAC-signed and
// short-lived, and the callback trusts nothing else about who is installing.
import { createHmac, timingSafeEqual } from "node:crypto";
import { safeFetch } from "../../lib/safe-fetch";

export const SLACK_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "incoming-webhook",
] as const;
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 100_000;

export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function slackOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): SlackOAuthConfig | null {
  const clientId = env.SLACK_CLIENT_ID;
  const clientSecret = env.SLACK_CLIENT_SECRET;
  const apiUrl = env.API_PUBLIC_URL;
  if (!clientId || !clientSecret || !apiUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${apiUrl.replace(/\/+$/, "")}/api/slack/oauth/callback`,
  };
}

export interface SlackState {
  workspace_id: string;
  user_id: string;
  exp: number;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSlackState(
  input: { workspace_id: string; user_id: string },
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      exp: now + STATE_TTL_MS,
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySlackState(
  state: string,
  secret: string,
  now = Date.now(),
): SlackState | null {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, given] = parts;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;

  let parsed: Partial<SlackState>;
  try {
    parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<SlackState>;
  } catch {
    return null;
  }
  if (
    typeof parsed.workspace_id !== "string" ||
    typeof parsed.user_id !== "string" ||
    typeof parsed.exp !== "number" ||
    parsed.exp < now
  ) {
    return null;
  }
  return {
    workspace_id: parsed.workspace_id,
    user_id: parsed.user_id,
    exp: parsed.exp,
  };
}

export function buildSlackAuthorizeUrl(
  config: SlackOAuthConfig,
  state: string,
): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", SLACK_SCOPES.join(","));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface SlackOAuthResult {
  team_id: string;
  team_name: string | null;
  bot_token: string;
  bot_user_id: string;
  channel_id: string;
  channel_name: string | null;
}

interface OAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: { channel_id?: string; channel?: string };
}

// Slack answers failures with HTTP 200 and ok:false, so both are checked.
// Error messages carry Slack's error code only — never the code, secret or token.
export async function exchangeSlackCode(
  config: SlackOAuthConfig,
  code: string,
): Promise<SlackOAuthResult> {
  const res = await safeFetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_RESPONSE_BYTES,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Slack oauth.v2.access returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as OAuthAccessResponse;
  if (!body.ok)
    throw new Error(
      `Slack oauth.v2.access failed: ${body.error ?? "unknown_error"}`,
    );
  const teamId = body.team?.id;
  const channelId = body.incoming_webhook?.channel_id;
  if (!body.access_token || !body.bot_user_id || !teamId || !channelId) {
    throw new Error("Slack oauth.v2.access response missing required fields");
  }
  return {
    team_id: teamId,
    team_name: body.team?.name ?? null,
    bot_token: body.access_token,
    bot_user_id: body.bot_user_id,
    channel_id: channelId,
    channel_name: body.incoming_webhook?.channel ?? null,
  };
}

export async function revokeSlackToken(token: string): Promise<void> {
  const res = await safeFetch("https://slack.com/api/auth.revoke", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_RESPONSE_BYTES,
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok)
    throw new Error(
      `Slack auth.revoke failed: ${body.error ?? "unknown_error"}`,
    );
}
