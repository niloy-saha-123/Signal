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
import {
  verifySlackState,
  type SlackOAuthConfig,
  type SlackOAuthResult,
} from "../integrations/slack/oauth";
import type { PendingSlackInstall } from "../integrations/slack/pending-install";
import { isSlackResponseUrl, openView } from "../integrations/slack/client";
import {
  forecastListBlocks,
  intelModal,
  INTEL_BLOCK,
  INTEL_MODAL_CALLBACK_ID,
  SIGNAL_USAGE,
} from "../integrations/slack/blocks";
import type { SlackIntel } from "../integrations/slack/intel-worker";
import { FieldIntelInputSchema } from "@signal/shared";
import { logger } from "../lib/logger";

export interface SlackQuestion {
  workspace_id: string;
  team_id: string;
  channel: string;
  user: string;
  question: string;
  thread_ts: string;
  // Set for /signal ask: the answer goes back through Slack's response_url
  // (works where the bot is not a channel member) instead of chat.postMessage.
  response_url?: string;
  // Stable per-event key, used as the BullMQ job id so a redelivered Slack
  // event collapses onto the job the first delivery already created instead of
  // running the agent a second time and posting a second answer.
  dedupe_key: string;
}

export interface SlackOAuthCallbackDeps {
  config: () => SlackOAuthConfig | null;
  exchangeCode: (config: SlackOAuthConfig, code: string) => Promise<SlackOAuthResult>;
  savePendingInstall: (pending: PendingSlackInstall) => Promise<string>;
  frontendUrl: string;
}

export interface SlackRouterDeps {
  signingSecret: string;
  getSlackInstallation: typeof queries.getSlackInstallation;
  deleteSlackInstallationForTeam: typeof queries.deleteSlackInstallationForTeam;
  enqueueSlackQuestion: (question: SlackQuestion) => Promise<void>;
  oauth: SlackOAuthCallbackDeps;
  commands: SlackCommandDeps;
}

export interface SlackCommandDeps {
  listCompetitorsForWorkspace: typeof queries.listCompetitorsForWorkspace;
  getCompetitorByIdForWorkspace: typeof queries.getCompetitorByIdForWorkspace;
  listPredictionsForWorkspace: typeof queries.listPredictionsForWorkspace;
  openView: typeof openView;
  enqueueSlackIntel: (intel: SlackIntel) => Promise<void>;
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
      subtype: z.string().optional(),
      channel_type: z.string().optional(),
      ts: z.string().optional(),
      thread_ts: z.string().optional(),
      tokens: z.object({ bot: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});

// Slack prefixes a mention with the bot's own user id. That token is addressing,
// not part of the question, and leaving it in makes the agent answer questions
// that appear to start with a user id.
function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

function ephemeral(text: string) {
  return { response_type: "ephemeral", text };
}

const CommandSchema = z.object({
  team_id: z.string().min(1),
  user_id: z.string().min(1),
  channel_id: z.string().default(""),
  text: z.string().default(""),
  response_url: z.string().default(""),
  trigger_id: z.string().default(""),
});

const SlackIdSchema = z.object({ id: z.string().min(1) });

const InteractionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message_action"),
    callback_id: z.string(),
    trigger_id: z.string(),
    team: SlackIdSchema,
    user: SlackIdSchema,
    message: z.object({ text: z.string().default("") }).default({ text: "" }),
  }),
  z.object({
    type: z.literal("view_submission"),
    team: SlackIdSchema,
    user: SlackIdSchema,
    view: z.object({
      id: z.string().min(1),
      callback_id: z.string(),
      state: z.object({
        values: z.record(
          z.string(),
          z.record(
            z.string(),
            z.object({
              value: z.string().nullable().optional(),
              selected_option: z.object({ value: z.string() }).nullable().optional(),
            })
          )
        ),
      }),
    }),
  }),
]);

// Slack renders links in message text as <https://x|label> or <https://x>.
const SLACK_LINK = /<(https?:\/\/[^|>\s]+)(?:\|([^>]*))?>/g;

export function prefillFromMessage(text: string): { url?: string; note?: string } {
  const url = SLACK_LINK.exec(text)?.[1];
  SLACK_LINK.lastIndex = 0;
  const note = text
    .replace(SLACK_LINK, (_m, href: string, label?: string) => label || href)
    .replace(/<[@#!][^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
  return { url, note: note || undefined };
}

// `intel https://x some note` → url + note; a leading non-URL word is note.
function parseIntelArgs(args: string): { url?: string; note?: string } {
  const unwrapped = args.replace(SLACK_LINK, (_m, href: string) => href).trim();
  const [first, ...rest] = unwrapped.split(/\s+/);
  if (first && /^https?:\/\//i.test(first)) return { url: first, note: rest.join(" ") || undefined };
  return { note: unwrapped || undefined };
}

function matchCompetitor<T extends { name: string }>(competitors: T[], query: string): T | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const exact = competitors.find((c) => c.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = competitors.filter((c) => c.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : undefined;
}

const FORECASTS_SHOWN = 5;

export function createSlackRouter(deps: SlackRouterDeps): Router {
  const router = express.Router();

  // Capture the exact bytes Slack signed. express.json()'s verify hook is the
  // only place they are still available.
  // Events arrive as JSON; slash commands and interactions as form posts.
  const captureRawBody = (req: express.Request, _res: express.Response, buf: Buffer) => {
    (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
  };
  router.use(express.json({ verify: captureRawBody }));
  router.use(express.urlencoded({ extended: false, verify: captureRawBody }));

  // True when the request carries a valid Slack signature; otherwise answers
  // and returns false.
  function authenticated(req: express.Request, res: express.Response): boolean {
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
      return false;
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
      return false;
    }
    return true;
  }

  // Resolves the Signal installation for a signed command or interaction.
  // Answers (200, so Slack shows the text) and returns null when it can't.
  async function installationFor(teamId: string, res: express.Response) {
    try {
      const installation = teamId ? await deps.getSlackInstallation(teamId) : undefined;
      if (installation) return installation;
      res.status(200).json(ephemeral("This Slack workspace isn't connected to Signal. Connect it in Signal's Settings."));
    } catch (error) {
      logger.error("slack: installation lookup failed", {
        team_id: teamId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(200).json(ephemeral("Signal couldn't look up this workspace right now. Try again in a moment."));
    }
    return null;
  }

  router.post("/events", async (req, res) => {
    if (!authenticated(req, res)) return;

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

    // Uninstalled, or its bot token revoked: the row can never post again.
    if (
      event.type === "app_uninstalled" ||
      (event.type === "tokens_revoked" && (event.tokens?.bot?.length ?? 0) > 0)
    ) {
      try {
        await deps.deleteSlackInstallationForTeam(teamId);
        logger.info("slack: installation removed", { team_id: teamId, reason: event.type });
      } catch (error) {
        logger.error("slack: failed to remove an uninstalled installation", {
          team_id: teamId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      res.status(200).json({ ok: true });
      return;
    }

    // Signal's own messages come back as events. Answering them would have the
    // bot talk to itself indefinitely.
    if (event.bot_id || event.user === installation.bot_user_id) {
      res.status(200).json({ ok: true });
      return;
    }

    // Plain messages count only as DMs to the bot. Edits, joins and other
    // subtyped messages are not questions.
    const isDm = event.type === "message" && event.channel_type === "im" && !event.subtype;
    if (event.type !== "app_mention" && !isDm) {
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
        // a busy channel. A DM is a conversation already: answer inline.
        thread_ts: isDm ? (event.thread_ts ?? "") : (event.thread_ts ?? event.ts ?? ""),
        // team_id + the event's own timestamp is unique per Slack event. "-", not
        // ":": BullMQ rejects custom job ids containing ":".
        dedupe_key: `${teamId}-${event.ts ?? ""}`,
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

  router.post("/commands", async (req, res) => {
    if (!authenticated(req, res)) return;
    const parsed = CommandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation" });
      return;
    }
    const command = parsed.data;
    const installation = await installationFor(command.team_id, res);
    if (!installation) return;
    const workspaceId = installation.workspace_id;

    const trimmed = command.text.trim();
    const space = trimmed.search(/\s/);
    const sub = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
    const args = space === -1 ? "" : trimmed.slice(space + 1).trim();

    try {
      if (sub === "ask") {
        if (!args) {
          res.status(200).json(ephemeral("Ask a question: `/signal ask what is Acme planning?`"));
          return;
        }
        if (!isSlackResponseUrl(command.response_url)) {
          res.status(400).json({ error: "validation" });
          return;
        }
        await deps.enqueueSlackQuestion({
          workspace_id: workspaceId,
          team_id: command.team_id,
          channel: command.channel_id,
          user: command.user_id,
          question: args,
          thread_ts: "",
          response_url: command.response_url,
          dedupe_key: `${command.team_id}-cmd-${command.trigger_id || Date.now()}`,
        });
        res.status(200).json(ephemeral("Looking into it. The answer will post here."));
        return;
      }

      if (sub === "forecast" || sub === "forecasts") {
        const competitors = (await deps.commands.listCompetitorsForWorkspace(workspaceId)).filter((c) => c.is_active);
        const competitor = matchCompetitor(competitors, args);
        if (!competitor) {
          const names = competitors.map((c) => c.name).join(", ");
          res
            .status(200)
            .json(
              ephemeral(
                competitors.length === 0
                  ? "This workspace isn't tracking any competitors yet."
                  : `${args ? `No single competitor matches "${args}".` : "Which competitor?"} Try one of: ${names}`
              )
            );
          return;
        }
        const forecasts = await deps.commands.listPredictionsForWorkspace({
          workspace_id: workspaceId,
          competitor_id: competitor.id,
          status: "open",
          limit: FORECASTS_SHOWN,
          soonest_first: true,
        });
        res.status(200).json({
          response_type: "ephemeral",
          text: `${competitor.name}: ${forecasts.length} open forecast(s)`,
          blocks: forecastListBlocks(competitor.name, forecasts),
        });
        return;
      }

      if (sub === "intel") {
        const competitors = (await deps.commands.listCompetitorsForWorkspace(workspaceId)).filter((c) => c.is_active);
        await deps.commands.openView(installation.bot_token, command.trigger_id, intelModal(competitors, parseIntelArgs(args)));
        res.status(200).end();
        return;
      }
    } catch (error) {
      logger.error("slack: /signal command failed", {
        team_id: command.team_id,
        subcommand: sub,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(200).json(ephemeral("Something went wrong. The failure is logged — try again in a moment."));
      return;
    }

    res.status(200).json(ephemeral(SIGNAL_USAGE));
  });

  router.post("/interactions", async (req, res) => {
    if (!authenticated(req, res)) return;
    let payload: z.infer<typeof InteractionSchema>;
    try {
      const raw = typeof req.body?.payload === "string" ? JSON.parse(req.body.payload) : null;
      const parsed = InteractionSchema.safeParse(raw);
      if (!parsed.success) {
        // Block actions and other interaction types Signal doesn't use.
        res.status(200).end();
        return;
      }
      payload = parsed.data;
    } catch {
      res.status(400).json({ error: "validation" });
      return;
    }

    const installation = await installationFor(payload.team.id, res);
    if (!installation) return;
    const workspaceId = installation.workspace_id;

    try {
      if (payload.type === "message_action") {
        if (payload.callback_id !== "send_to_signal") {
          res.status(200).end();
          return;
        }
        const competitors = (await deps.commands.listCompetitorsForWorkspace(workspaceId)).filter((c) => c.is_active);
        await deps.commands.openView(
          installation.bot_token,
          payload.trigger_id,
          intelModal(competitors, prefillFromMessage(payload.message.text))
        );
        res.status(200).end();
        return;
      }

      if (payload.view.callback_id !== INTEL_MODAL_CALLBACK_ID) {
        res.status(200).end();
        return;
      }
      const values = payload.view.state.values;
      const competitorId = values[INTEL_BLOCK.competitor]?.value?.selected_option?.value ?? "";
      const url = values[INTEL_BLOCK.url]?.value?.value?.trim() || undefined;
      const note = values[INTEL_BLOCK.note]?.value?.value ?? "";

      const errors: Record<string, string> = {};
      const input = FieldIntelInputSchema.safeParse({ note, ...(url ? { url } : {}) });
      if (!input.success) {
        for (const issue of input.error.issues) {
          const field = issue.path[0] === "url" ? INTEL_BLOCK.url : INTEL_BLOCK.note;
          errors[field] ??= field === INTEL_BLOCK.url ? "Enter an http(s) link." : "Add a note (up to 4,000 characters).";
        }
      }
      const competitor = /^[0-9a-f-]{36}$/i.test(competitorId)
        ? await deps.commands.getCompetitorByIdForWorkspace(competitorId, workspaceId)
        : undefined;
      if (!competitor) errors[INTEL_BLOCK.competitor] = "Pick a competitor.";
      if (Object.keys(errors).length > 0 || !input.success || !competitor) {
        res.status(200).json({ response_action: "errors", errors });
        return;
      }

      await deps.commands.enqueueSlackIntel({
        workspace_id: workspaceId,
        team_id: payload.team.id,
        user: payload.user.id,
        competitor_id: competitor.id,
        note: input.data.note,
        url: input.data.url,
        dedupe_key: `${payload.team.id}-view-${payload.view.id}`,
      });
      res.status(200).end();
    } catch (error) {
      logger.error("slack: interaction failed", {
        team_id: payload.team.id,
        type: payload.type,
        error: error instanceof Error ? error.message : String(error),
      });
      if (payload.type === "view_submission") {
        res.status(200).json({
          response_action: "errors",
          errors: { [INTEL_BLOCK.note]: "Signal couldn't save this right now. Try again in a moment." },
        });
      } else {
        res.status(200).end();
      }
    }
  });

  // Where Slack sends the browser back after "Add to Slack". Public by
  // necessity (no bearer token rides a browser redirect), so it must NOT write
  // anything: the signed state only proves who started the install, not who is
  // finishing it. The result is parked and the signed-in confirm binds it.
  router.get("/oauth/callback", async (req, res) => {
    const back = (query: string) => res.redirect(302, `${deps.oauth.frontendUrl}/settings?${query}`);

    if (typeof req.query.error === "string") {
      back("slack=cancelled");
      return;
    }
    const config = deps.oauth.config();
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const rawState = typeof req.query.state === "string" ? req.query.state : "";
    const state = config ? verifySlackState(rawState, config.clientSecret) : null;
    if (!config || !code || !state) {
      back("slack=error");
      return;
    }

    try {
      const result = await deps.oauth.exchangeCode(config, code);
      const id = await deps.oauth.savePendingInstall({
        workspace_id: state.workspace_id,
        user_id: state.user_id,
        result,
      });
      back(`slack_install=${id}`);
    } catch (error) {
      logger.error("slack: install failed", {
        workspace_id: state.workspace_id,
        error: error instanceof Error ? error.message : String(error),
      });
      back("slack=error");
    }
  });

  return router;
}
