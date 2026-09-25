// Slack request signature verification.
//
// This is the only thing standing between the events endpoint and the open
// internet. The endpoint is unauthenticated by necessity — Slack has no bearer
// token to present — so the signature is the authentication, and everything
// downstream of it (resolving a workspace, running the chat agent, spending
// model budget) is gated on this function returning true.
//
// Slack signs `v0:{timestamp}:{raw body}` with HMAC-SHA256 under the app's
// signing secret. Two properties matter and both are load-bearing:
//
//   1. The comparison is constant-time. A byte-by-byte early-exit compare leaks
//      how much of a guessed signature was correct, which is enough to forge
//      one a byte at a time.
//   2. The timestamp is checked. The signature itself never expires, so without
//      a freshness window a single captured request could be replayed forever.
//
// Every failure path returns false rather than throwing. This runs on an
// unauthenticated endpoint, so an exception would be a 500 that tells an
// attacker they found an unhandled input.
import crypto from "node:crypto";

// Slack's own recommendation. Wide enough for clock skew between their servers
// and ours, narrow enough that a captured request stops being useful quickly.
export const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 60 * 5;

export interface SlackVerificationInput {
  // The raw request body, exactly as received. A re-serialised JSON object will
  // not match — key order and whitespace both change the bytes Slack signed.
  body: string;
  timestamp: string;
  signature: string;
  secret: string;
}

export function verifySlackRequest(input: SlackVerificationInput, now = Date.now()): boolean {
  // An unset secret fails closed. Treating "no secret configured" as "skip the
  // check" would silently open the endpoint on any deploy that forgot the
  // environment variable — the failure mode nobody notices until it is abused.
  if (!input.secret) return false;
  if (!input.signature.startsWith("v0=")) return false;

  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const ageSeconds = Math.abs(Math.floor(now / 1000) - timestampSeconds);
  if (ageSeconds > SLACK_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = `v0=${crypto
    .createHmac("sha256", input.secret)
    .update(`v0:${input.timestamp}:${input.body}`)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(input.signature, "utf8");

  // timingSafeEqual throws when the lengths differ, and a throw here would be a
  // 500 on an unauthenticated endpoint. The length check itself is not a leak:
  // the expected signature's length is fixed and public.
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
