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
    section(`*${prediction.competitor_name}* — new prediction`),
    section(prediction.statement),
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
      `*${resolution.competitor_name}* — prediction resolved: *${STATUS_LABEL[resolution.status]}*`
    ),
    section(resolution.statement),
    context(`Signal said *${percent(resolution.probability)}*`),
    section(resolution.resolution_note),
  ];

  if (resolution.resolution_evidence_urls.length > 0) {
    blocks.push(
      context(
        resolution.resolution_evidence_urls
          .slice(0, 3)
          .map((url) => `<${url}|evidence>`)
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
    section(`*${alert.competitor_name}* — ${alert.pattern}`),
    context(`*${percent(alert.confidence)}* confidence`),
    section(alert.interpretation),
  ];

  const actions = alert.recommended_actions
    .map((action) => {
      const label = typeof action.type === "string" ? action.type : null;
      const detail = typeof action.detail === "string" ? action.detail : null;
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
            .map((a) => `• *${a.competitor_name}*: ${a.pattern} (${percent(a.confidence)} confidence)`)
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
            .map((f) => `• *${f.competitor_name}*: ${f.statement} — ${percent(f.probability)}`)
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
            .map((s) => `• ${s.status === "hit" ? "Hit" : "Miss"} — *${s.competitor_name}*: ${s.statement}`)
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
