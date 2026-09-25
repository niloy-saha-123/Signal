// Slack events endpoint — where people talk to Signal from Slack.
//
// This route is deliberately thin. It authenticates the request, resolves which
// Signal workspace the Slack team maps to, and hands the question to a queue.
// It does not run the agent. Slack retries any request it does not get a
// response to within 3 seconds, and a chat-agent turn is routinely slower than
// that, so answering synchronously would have Slack re-deliver the same event
// and the user would get the same answer two or three times.
//
// Authentication is unusual here and worth stating plainly: there is no bearer
// token, because Slack has none to present. The HMAC signature IS the
// authentication, so verification runs before anything else — before the body
// is parsed as a structure, before a workspace is resolved, and long before any
// model budget is spent. An unsigned request must cost nothing.
//
// The raw body is required for verification, since Slack signed exact bytes and
// a re-serialised JSON object will not match.
//
// MOUNT ORDER IS LOAD-BEARING. body-parser sets `req._body` on the first parse
// and every later express.json() short-circuits on it, so if this router is
// mounted behind the app's global JSON parser its own `verify` hook never runs,
// `rawBody` is never captured, and every genuine Slack request fails signature
// verification. That failure mode is invisible from outside — a correct
// signature and a forged one both look the same — so the handler detects the
// missing raw body explicitly and answers 500 with a named error rather than
// 401, which would send whoever debugs it hunting for a wrong signing secret.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { verifySlackRequest } from "../integrations/slack/verify";
import { logger } from "../lib/logger";

export interface SlackQuestion {
  workspace_id: string;
  team_id: string;
  channel: string;
  user: string;
  question: string;
  thread_ts: string;
  bot_token: string;
  // Stable per-event key, used as the BullMQ job id so a redelivered Slack
  // event collapses onto the job the first delivery already created instead of
  // running the agent a second time and posting a second answer.
  dedupe_key: string;
}

export interface SlackRouterDeps {
  signingSecret: string;
  getSlackInstallation: typeof queries.getSlackInstallation;
  enqueueSlackQuestion: (question: SlackQuestion) => Promise<void>;
}

const SlackEventSchema = z.object({
  type: z.string(),
  challenge: z.string().optional(),
  team_id: z.string().optional(),
  event: z
    .object({
      type: z.string(),
      text: z.string().optional(),
      channel: z.string().optional(),
      user: z.string().optional(),
      bot_id: z.string().optional(),
      ts: z.string().optional(),
      thread_ts: z.string().optional(),
    })
    .optional(),
});

// Slack prefixes a mention with the bot's own user id. That token is addressing,
// not part of the question, and leaving it in makes the agent answer questions
// that appear to start with a user id.
function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

export function createSlackRouter(deps: SlackRouterDeps): Router {
  const router = express.Router();

  // Capture the exact bytes Slack signed. express.json()'s verify hook is the
  // only place they are still available.
  router.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    })
  );

  router.post("/events", async (req, res) => {
    const rawBody = (req as express.Request & { rawBody?: string }).rawBody;
    const timestamp = req.header("x-slack-request-timestamp") ?? "";
    const signature = req.header("x-slack-signature") ?? "";

    // A misconfigured mount order, not a bad request. Never answer 401 here:
    // that is indistinguishable from a signature failure and hides the actual
    // cause completely.
    if (rawBody === undefined) {
      logger.error(
        "slack: raw body unavailable — the Slack router must be mounted BEFORE the app's global express.json()",
        { hint: "body-parser sets req._body on first parse; later parsers skip their verify hook" }
      );
      res.status(500).json({ error: "slack_raw_body_unavailable" });
      return;
    }

    if (
      !verifySlackRequest({
        body: rawBody,
        timestamp,
        signature,
        secret: deps.signingSecret,
      })
    ) {
      // No detail in the response. An unauthenticated caller learns only that
      // it failed, not which check it failed.
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const parsed = SlackEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation" });
      return;
    }

    // Slack's one-time endpoint handshake.
    if (parsed.data.type === "url_verification") {
      res.status(200).json({ challenge: parsed.data.challenge ?? "" });
      return;
    }

    const event = parsed.data.event;
    const teamId = parsed.data.team_id;
    if (!event || !teamId) {
      res.status(200).json({ ok: true });
      return;
    }

    // Slack redelivers any event it does not see acked within 3 seconds. By the
    // time a retry arrives the original has almost always already been queued,
    // so re-processing it means a second agent run and a second answer in the
    // channel for one question. Drop retries.
    if ((req.header("x-slack-retry-num") ?? "") !== "") {
      logger.info("slack: ignoring a retry delivery", {
        team_id: teamId,
        retry_num: req.header("x-slack-retry-num"),
        retry_reason: req.header("x-slack-retry-reason"),
      });
      res.status(200).json({ ok: true });
      return;
    }

    // From here on nothing may throw past this handler. Express 4 does not
    // catch a rejected promise from an async handler, and an uncaught one means
    // no response at all — which Slack reads as a timeout and retries, turning
    // a transient database blip into duplicate answers and duplicate spend.
    let installation: Awaited<ReturnType<typeof deps.getSlackInstallation>>;
    try {
      installation = await deps.getSlackInstallation(teamId);
    } catch (error) {
      logger.error("slack: installation lookup failed — acking so Slack does not retry", {
        team_id: teamId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (!installation) {
      // A signed request from a Slack team nobody connected. Serving it would
      // mean running an agent with no workspace to scope it to.
      logger.warn("slack: event from an unmapped team", { team_id: teamId });
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    // Signal's own messages come back as events. Answering them would have the
    // bot talk to itself indefinitely.
    if (event.bot_id || event.user === installation.bot_user_id) {
      res.status(200).json({ ok: true });
      return;
    }

    if (event.type !== "app_mention" && event.type !== "message") {
      res.status(200).json({ ok: true });
      return;
    }

    const question = stripMention(event.text ?? "");
    if (!question || !event.channel) {
      res.status(200).json({ ok: true });
      return;
    }

    try {
      await deps.enqueueSlackQuestion({
        workspace_id: installation.workspace_id,
        team_id: teamId,
        channel: event.channel,
        user: event.user ?? "",
        question,
        // Reply in the thread when there is one, otherwise start a thread on
        // the message itself — so an answer never lands as a loose message in
        // a busy channel.
        thread_ts: event.thread_ts ?? event.ts ?? "",
        bot_token: installation.bot_token,
        // team_id + the event's own timestamp is unique per Slack event.
        dedupe_key: `${teamId}:${event.ts ?? ""}`,
      });
    } catch (error) {
      // Still ack. A non-200 makes Slack retry, and a retry against a broken
      // queue produces the same failure plus a duplicate if it later recovers.
      logger.error("slack: failed to enqueue a question — acking anyway", {
        team_id: teamId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    res.status(200).json({ ok: true });
  });

  return router;
}
