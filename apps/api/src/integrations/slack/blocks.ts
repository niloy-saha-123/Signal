// Block Kit rendering for everything Signal posts into Slack.
//
// A Slack message is read out of context — days later, on a phone, by someone
// who did not open Signal and will not click through. That constrains the copy
// more than the product UI does:
//
//   - Name the competitor. "They" is useless in a channel.
//   - A probability, a resolution date and an evidence count travel together.
//     A probability with no date is not a prediction; a prediction with no
//     evidence count hides how thin it is.
//   - Never phrase a forecast as a certainty, no matter how high the number.
//     The whole product rests on the claim that Signal says what it actually
//     believes, and a Slack message is where that claim is most likely to be
//     screenshotted.
//   - Announce misses as plainly as hits. A ledger that only broadcasts wins is
//     marketing wearing a track record's clothes.
import type { WeeklyDigest } from "../../db/queries";

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

// Names, patterns and statements come from users or LLM output over scraped
// content. Unescaped, "<!channel>" pings the channel and "<url|label>" renders
// a disguised link.
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function section(markdown: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text: markdown } };
}

function context(markdown: string): SlackBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text: markdown }] };
}

function divider(): SlackBlock {
  return { type: "divider" };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// Fixed locale and UTC. A date rendered in the server's local zone would drift
// with deploy environment, and a resolution date that shifts by a day is a date
// nobody can hold the system to.
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export interface PredictionMessage {
  statement: string;
  competitor_name: string;
  probability: number;
  resolves_at: Date;
  evidence_count: number;
  pattern_type: string;
}

export function predictionBlocks(prediction: PredictionMessage): SlackBlock[] {
  return [
    section(`*${escapeMrkdwn(prediction.competitor_name)}* — new prediction`),
    section(escapeMrkdwn(prediction.statement)),
    context(
      [
        `*${percent(prediction.probability)}* likely`,
        `resolves ${formatDate(prediction.resolves_at)}`,
        `based on ${plural(prediction.evidence_count, "signal")}`,
      ].join("  ·  ")
    ),
    context(
      "Signal states a probability, not an outcome. This will be marked hit or miss on the resolution date."
    ),
  ];
}

export interface ResolutionMessage {
  statement: string;
  competitor_name: string;
  probability: number;
  status: "hit" | "miss" | "unresolved";
  resolution_note: string;
  resolution_evidence_urls: string[];
  brier_score: number | null;
}

const STATUS_LABEL: Record<ResolutionMessage["status"], string> = {
  hit: "Hit",
  miss: "Miss",
  unresolved: "Unresolved",
};

export function resolutionBlocks(resolution: ResolutionMessage): SlackBlock[] {
  const blocks: SlackBlock[] = [
    section(
      `*${escapeMrkdwn(resolution.competitor_name)}* — prediction resolved: *${STATUS_LABEL[resolution.status]}*`
    ),
    section(escapeMrkdwn(resolution.statement)),
    context(`Signal said *${percent(resolution.probability)}*`),
    section(escapeMrkdwn(resolution.resolution_note)),
  ];

  if (resolution.resolution_evidence_urls.length > 0) {
    blocks.push(
      context(
        resolution.resolution_evidence_urls
          .slice(0, 3)
          .map((url) => `<${escapeMrkdwn(url)}|evidence>`)
          .join("  ·  ")
      )
    );
  }

  // An unresolved window carries no score, and the absence is rendered as an
  // absence. Printing 0 here would read as a flawless call on a prediction that
  // was never actually settled.
  if (resolution.status === "unresolved") {
    blocks.push(
      context("No score recorded — an unresolved window says nothing about accuracy.")
    );
  }

  return blocks;
}

export interface AlertMessage {
  competitor_name: string;
  pattern: string;
  confidence: number;
  interpretation: string;
  recommended_actions: Array<{ type?: unknown; detail?: unknown }>;
}

export function alertBlocks(alert: AlertMessage): SlackBlock[] {
  const blocks: SlackBlock[] = [
    section(`*${escapeMrkdwn(alert.competitor_name)}* — ${escapeMrkdwn(alert.pattern)}`),
    context(`*${percent(alert.confidence)}* confidence`),
    section(escapeMrkdwn(alert.interpretation)),
  ];

  const actions = alert.recommended_actions
    .map((action) => {
      const label = typeof action.type === "string" ? escapeMrkdwn(action.type) : null;
      const detail = typeof action.detail === "string" ? escapeMrkdwn(action.detail) : null;
      if (!detail) return null;
      return label ? `*${label}* — ${detail}` : detail;
    })
    .filter((line): line is string => line !== null);

  if (actions.length > 0) {
    blocks.push(divider(), section(actions.slice(0, 5).join("\n")));
  }

  return blocks;
}

// Weekly digest. Hits and misses are listed side by side, same rule as
// resolutionBlocks: a digest that only reports wins is not a track record.
export function digestBlocks(
  digest: WeeklyDigest,
  appUrl: string
): { blocks: SlackBlock[]; fallbackText: string } {
  const blocks: SlackBlock[] = [
    section(
      `*Signal weekly digest* — ${plural(digest.alert_count, "alert")}, ` +
        `${plural(digest.new_forecast_count, "new forecast")}, ${digest.settled.length} settled`
    ),
  ];
  if (digest.top_alerts.length) {
    blocks.push(
      divider(),
      section(
        "*Top alerts*\n" +
          digest.top_alerts
            .map((a) => `• *${escapeMrkdwn(a.competitor_name)}*: ${escapeMrkdwn(a.pattern)} (${percent(a.confidence)} confidence)`)
            .join("\n")
      )
    );
  }
  if (digest.new_forecasts.length) {
    blocks.push(
      divider(),
      section(
        "*New forecasts*\n" +
          digest.new_forecasts
            .map((f) => `• *${escapeMrkdwn(f.competitor_name)}*: ${escapeMrkdwn(f.statement)} — ${percent(f.probability)}`)
            .join("\n")
      )
    );
  }
  if (digest.settled.length) {
    blocks.push(
      divider(),
      section(
        "*Settled this week*\n" +
          digest.settled
            .map((s) => `• ${s.status === "hit" ? "Hit" : "Miss"} — *${escapeMrkdwn(s.competitor_name)}*: ${escapeMrkdwn(s.statement)}`)
            .join("\n")
      )
    );
  }
  blocks.push(
    context(`${plural(digest.open_count, "open forecast")} · <${appUrl}/briefing|Open the briefing in Signal>`)
  );
  return {
    blocks,
    fallbackText:
      `Signal weekly digest: ${plural(digest.alert_count, "alert")}, ` +
      `${plural(digest.new_forecast_count, "new forecast")}, ${digest.settled.length} settled`,
  };
}

// ── /signal and "Send to Signal" ──────────────────────────────────────────

export const SIGNAL_USAGE = [
  "*/signal* commands:",
  "• `/signal ask <question>`: Signal answers in this channel",
  "• `/signal forecast <competitor>`: that competitor's open forecasts (only you see it)",
  "• `/signal intel [url] [note]`: file a link or note under a competitor",
  "Or use *Send to Signal* from any message's ⋯ menu.",
].join("\n");

export interface ForecastLine {
  statement: string;
  probability: number;
  resolves_at: Date;
}

export function forecastListBlocks(competitorName: string, forecasts: ForecastLine[]): SlackBlock[] {
  const name = escapeMrkdwn(competitorName);
  if (forecasts.length === 0) {
    return [section(`No open forecasts for *${name}*. Signal forecasts only when several independent signals agree.`)];
  }
  return [
    section(`*${name}* — ${plural(forecasts.length, "open forecast")}`),
    ...forecasts.map((f) =>
      section(
        `${escapeMrkdwn(f.statement)}\n*${percent(f.probability)}* likely  ·  resolves ${formatDate(f.resolves_at)}`
      )
    ),
  ];
}

export const INTEL_MODAL_CALLBACK_ID = "signal_intel";
export const INTEL_BLOCK = { competitor: "competitor", url: "url", note: "note" } as const;

const SLACK_OPTIONS_MAX = 100;
const NOTE_MAX = 4_000;

function plainText(text: string) {
  return { type: "plain_text", text, emoji: false };
}

export function intelModal(
  competitors: Array<{ id: string; name: string }>,
  prefill: { url?: string; note?: string }
): Record<string, unknown> {
  const base = { type: "modal", callback_id: INTEL_MODAL_CALLBACK_ID, title: plainText("Send to Signal") };
  if (competitors.length === 0) {
    return {
      ...base,
      close: plainText("Close"),
      blocks: [section("This workspace isn't tracking any competitors yet. Add one in Signal first.")],
    };
  }
  const sorted = [...competitors].sort((a, b) => a.name.localeCompare(b.name));
  const options = sorted.slice(0, SLACK_OPTIONS_MAX).map((c) => ({
    text: plainText(c.name.slice(0, 75)),
    value: c.id,
  }));
  const note = prefill.note?.slice(0, NOTE_MAX);
  return {
    ...base,
    submit: plainText("Save"),
    close: plainText("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: INTEL_BLOCK.competitor,
        label: plainText("Competitor"),
        element: {
          type: "static_select",
          action_id: "value",
          placeholder: plainText("Pick a competitor"),
          options,
          ...(options.length === 1 ? { initial_option: options[0] } : {}),
        },
        ...(sorted.length > SLACK_OPTIONS_MAX
          ? { hint: plainText(`Showing the first ${SLACK_OPTIONS_MAX} competitors A–Z. File the rest from Signal.`) }
          : {}),
      },
      {
        type: "input",
        block_id: INTEL_BLOCK.url,
        optional: true,
        label: plainText("Link"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: plainText("https://"),
          ...(prefill.url ? { initial_value: prefill.url.slice(0, 2_000) } : {}),
        },
      },
      {
        type: "input",
        block_id: INTEL_BLOCK.note,
        label: plainText("What did you learn?"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: NOTE_MAX,
          ...(note ? { initial_value: note } : {}),
        },
      },
    ],
  };
}
