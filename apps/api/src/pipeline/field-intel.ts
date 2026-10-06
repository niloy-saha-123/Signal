// Teammate-submitted intel (a note, optionally with a link) becomes a 'field'
// signal. Shared by POST /competitors/:id/field-intel and the Slack modal.
// Callers check that the competitor belongs to the workspace first.
import * as queries from "../db/queries";
import { logger } from "../lib/logger";
import { enqueueInitialSignalPipeline } from "./recovery";
import { fetchPublicPageText } from "../agents/chat/fetch-url";
import { consumeChatInputBudget } from "../agents/chat/input-budget";

const FIELD_PAGE_MAX_CHARS = 12_000;

export interface FieldIntelDeps {
  consumeBudget: typeof consumeChatInputBudget;
  signalExistsBySourceUrl: typeof queries.signalExistsBySourceUrl;
  fetchPublicPageText: typeof fetchPublicPageText;
  createSignal: typeof queries.createSignal;
  enqueueInitialSignalPipeline: typeof enqueueInitialSignalPipeline;
}

export const defaultFieldIntelDeps: FieldIntelDeps = {
  consumeBudget: consumeChatInputBudget,
  signalExistsBySourceUrl: queries.signalExistsBySourceUrl,
  fetchPublicPageText,
  createSignal: queries.createSignal,
  enqueueInitialSignalPipeline,
};

export interface FieldIntelInput {
  workspace_id: string;
  competitor_id: string;
  note: string;
  url?: string;
  // `user:<uuid>` or `slack:<team>:<user>`
  submitted_by: string;
}

export type FieldIntelResult =
  | { status: "created"; signal_id: string; fetched: boolean }
  | { status: "duplicate" }
  | { status: "rate_limited" };

function fieldIntelText(
  note: string,
  url: string | undefined,
  pageText: string | null,
): string {
  const parts = [`Teammate note: ${note}`];
  if (url && pageText)
    parts.push(
      `Linked page (${url}):\n${pageText.slice(0, FIELD_PAGE_MAX_CHARS)}`,
    );
  return parts.join("\n\n");
}

export async function submitFieldIntel(
  deps: FieldIntelDeps,
  input: FieldIntelInput,
): Promise<FieldIntelResult> {
  const { workspace_id, competitor_id, note, url } = input;
  try {
    await deps.consumeBudget("field_intel", workspace_id);
  } catch {
    return { status: "rate_limited" };
  }

  if (
    url &&
    (await deps.signalExistsBySourceUrl(competitor_id, "field", url))
  ) {
    return { status: "duplicate" };
  }

  // The note is the teammate's evidence; the page is context. A page that
  // can't be fetched (private host, video, outage) never loses the note.
  let pageText: string | null = null;
  if (url) {
    try {
      pageText =
        (await deps.fetchPublicPageText(
          url,
          `field:fetch_url:${workspace_id}`,
        )) || null;
    } catch (err) {
      logger.warn("field intel page fetch failed — saving the note alone", {
        competitor_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const signal = await deps.createSignal({
    competitor_id,
    source: "field",
    source_url: url ?? null,
    title: note.split("\n")[0].slice(0, 120),
    raw_text: fieldIntelText(note, url, pageText),
    submitted_by: input.submitted_by,
  });
  // Lost a race with a concurrent submission of the same URL.
  if (!signal) return { status: "duplicate" };

  try {
    await deps.enqueueInitialSignalPipeline(signal.id);
  } catch (err) {
    // createSignal wrote the outbox row in the same transaction;
    // pipeline-recovery re-enqueues it.
    logger.error(
      "Failed to enqueue field intel pipeline — recovery will retry",
      {
        signal_id: signal.id,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
  return {
    status: "created",
    signal_id: signal.id,
    fetched: pageText !== null,
  };
}
