// Settles a due prediction against the evidence Signal actually collected.
//
// No language model decides a verdict here, and that is the central design
// choice of this file. A model asked "did this prediction come true?" will find
// a way to say yes — it is agreeable, it has the prediction text in front of it,
// and partial matches read as success in prose. A product whose entire claim is
// an honest track record cannot have its scoring done by something with a bias
// toward pleasing the reader.
//
// So resolution is row matching in code: terms present or absent, a release URL
// under the named repo or not, a pricing diff in the window or not. A model is
// allowed to write the human-readable note afterwards, and only after the verdict
// is already fixed. (This is the same split HockeyStack's Odin makes — executable
// analysis for the answer, generation only for the prose.)
//
// The three-way verdict matters as much as the matching. `unresolved` is not a
// softer `miss`: it means the window closed with no evidence either way, which
// says nothing about whether the forecast was good. Counting those as misses
// would make abstaining look identical to being wrong and would punish Signal
// for competitors that simply went quiet, or for its own collection gaps.
import type { ResolutionCriteria, SignalSource } from "@signal/shared";
import { listSignalsInWindow, listPricingDiffsInWindow } from "../../db/queries";
import { logger } from "../../lib/logger";

export type ResolutionStatus = "hit" | "miss" | "unresolved";

export interface ResolutionOutcome {
  status: ResolutionStatus;
  note: string;
  evidence_urls: string[];
}

// The fields resolution needs from a prediction row. Narrower than the full row
// so the resolver can be exercised without constructing one.
export interface ResolvablePrediction {
  id: string;
  competitor_id: string;
  workspace_id: string;
  created_at: Date;
  resolves_at: Date;
  resolution_criteria: ResolutionCriteria;
}

interface WindowSignal {
  id: string;
  source: string;
  source_url: string | null;
  title: string | null;
  raw_text: string;
  collected_at: Date;
}

interface WindowPricingDiff {
  id: string;
  diff: Record<string, unknown>;
  detected_at: Date;
}

// Every source Signal collects. Used when criteria do not narrow the search,
// so "was there any activity at all?" is answered over everything we have.
const ALL_SOURCES: SignalSource[] = [
  "reddit",
  "hn",
  "jobs",
  "changelog",
  "pricing",
  "github",
];

// Below this many signals in the window, an absence of matching evidence is more
// likely to be an absence of *any* evidence — a quiet competitor or a collector
// that did not run — than a genuine miss. A miss has to be earned by evidence
// that existed and disagreed.
// ponytail: a flat count across every source; a competitor whose only source is a
// low-volume changelog will look quiet at a threshold tuned for Reddit. Per-source
// expectations are the upgrade path if too many predictions land unresolved.
const MIN_SIGNALS_FOR_A_MISS = 3;

function haystack(signal: WindowSignal): string {
  return `${signal.title ?? ""}\n${signal.raw_text}`.toLowerCase();
}

function urlsOf(signals: WindowSignal[]): string[] {
  return signals
    .map((signal) => signal.source_url)
    .filter((url): url is string => Boolean(url));
}

// A release URL under the named repo. GitHub release links are
// https://github.com/<owner>/<repo>/releases/tag/<tag>, so both the repo segment
// and the /releases/ segment have to be present — a pull request mentioning the
// same term is intent, not a ship, and the prediction said release.
function isReleaseOf(signal: WindowSignal, repo: string): boolean {
  const url = signal.source_url?.toLowerCase() ?? "";
  return url.includes(`/${repo.toLowerCase()}/`) && url.includes("/releases/");
}

async function resolveSignalMatch(
  prediction: ResolvablePrediction,
  criteria: Extract<ResolutionCriteria, { kind: "signal_match" }>,
  now: Date
): Promise<ResolutionOutcome> {
  const signals = (await listSignalsInWindow(prediction.competitor_id, {
    from: prediction.created_at,
    to: earlierOf(prediction.resolves_at, now),
    sources: criteria.sources,
  })) as WindowSignal[];

  const terms = criteria.all_of.map((term) => term.toLowerCase());
  // Every term has to appear somewhere in the window — not necessarily in the
  // same signal, since a launch is often a release plus a blog post plus a
  // thread, but all of them present.
  const matching = signals.filter((signal) => {
    const text = haystack(signal);
    return terms.some((term) => text.includes(term));
  });
  const allTermsPresent = terms.every((term) =>
    signals.some((signal) => haystack(signal).includes(term))
  );

  if (allTermsPresent) {
    return {
      status: "hit",
      note: `All ${terms.length} required term(s) appeared across ${matching.length} signal(s) from ${criteria.sources.join(", ")}.`,
      evidence_urls: urlsOf(matching).slice(0, 10),
    };
  }

  if (signals.length < MIN_SIGNALS_FOR_A_MISS) {
    return {
      status: "unresolved",
      note: `Only ${signals.length} signal(s) collected from ${criteria.sources.join(", ")} in the window — too little activity to call this either way.`,
      evidence_urls: [],
    };
  }

  const missing = terms.filter(
    (term) => !signals.some((signal) => haystack(signal).includes(term))
  );
  return {
    status: "miss",
    note: `${signals.length} signal(s) were collected in the window, but ${missing.length} required term(s) never appeared: ${missing.join(", ")}.`,
    evidence_urls: urlsOf(signals).slice(0, 10),
  };
}

async function resolveGithubRelease(
  prediction: ResolvablePrediction,
  criteria: Extract<ResolutionCriteria, { kind: "github_release" }>,
  now: Date
): Promise<ResolutionOutcome> {
  const signals = (await listSignalsInWindow(prediction.competitor_id, {
    from: prediction.created_at,
    to: earlierOf(prediction.resolves_at, now),
    sources: ["github"],
  })) as WindowSignal[];

  const releases = signals.filter((signal) => isReleaseOf(signal, criteria.repo));
  const mentions = criteria.mentions.map((mention) => mention.toLowerCase());
  const matching = releases.filter((release) => {
    const text = haystack(release);
    return mentions.some((mention) => text.includes(mention));
  });

  if (matching.length > 0) {
    return {
      status: "hit",
      note: `${matching.length} release(s) of ${criteria.repo} mentioned ${mentions.join(" or ")}.`,
      evidence_urls: urlsOf(matching).slice(0, 10),
    };
  }

  if (releases.length === 0) {
    return {
      status: "unresolved",
      note: `${criteria.repo} published no releases in the window, so there is nothing to judge this against.`,
      evidence_urls: [],
    };
  }

  return {
    status: "miss",
    note: `${criteria.repo} published ${releases.length} release(s) in the window and none mentioned ${mentions.join(" or ")}.`,
    evidence_urls: urlsOf(releases).slice(0, 10),
  };
}

async function resolvePricingChange(
  prediction: ResolvablePrediction,
  criteria: Extract<ResolutionCriteria, { kind: "pricing_change" }>,
  now: Date
): Promise<ResolutionOutcome> {
  const diffs = (await listPricingDiffsInWindow(prediction.competitor_id, {
    from: prediction.created_at,
    to: earlierOf(prediction.resolves_at, now),
  })) as WindowPricingDiff[];

  if (diffs.length === 0) {
    // No diff means the watcher saw no change, or never ran. Those are not
    // distinguishable from here, and calling it a miss would score Signal on its
    // own collection gaps rather than on the quality of the forecast.
    return {
      status: "unresolved",
      note: "No pricing change was recorded in the window — the watcher either saw no movement or did not run.",
      evidence_urls: [],
    };
  }

  const matching =
    criteria.direction === "any"
      ? diffs
      : diffs.filter((entry) => entry.diff?.direction === criteria.direction);

  if (matching.length > 0) {
    return {
      status: "hit",
      note:
        criteria.direction === "any"
          ? `${matching.length} pricing change(s) were recorded in the window.`
          : `${matching.length} pricing ${criteria.direction}(s) were recorded in the window.`,
      evidence_urls: [],
    };
  }

  return {
    status: "miss",
    note: `${diffs.length} pricing change(s) were recorded, but none was a ${criteria.direction}.`,
    evidence_urls: [],
  };
}

// The window always ends at the earlier of the due date and now, so a prediction
// checked early is judged only on evidence that exists yet — and one checked late
// never counts evidence that arrived after it came due.
function earlierOf(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export async function resolvePredictionCriteria(
  prediction: ResolvablePrediction,
  now: Date
): Promise<ResolutionOutcome> {
  const criteria = prediction.resolution_criteria;

  switch (criteria.kind) {
    case "signal_match":
      return resolveSignalMatch(prediction, criteria, now);
    case "github_release":
      return resolveGithubRelease(prediction, criteria, now);
    case "pricing_change":
      return resolvePricingChange(prediction, criteria, now);
    default: {
      // The union is closed and Zod-validated on the way in, so this is
      // unreachable through normal paths — but a row written before a future
      // variant existed would land here, and silently scoring it would corrupt
      // the ledger. Leave it unresolved and say so.
      const exhaustive: never = criteria;
      logger.error("prediction resolver: unknown resolution criteria kind — leaving unresolved", {
        prediction_id: prediction.id,
        criteria: exhaustive,
      });
      return {
        status: "unresolved",
        note: "This prediction's resolution criteria are not recognised by the current resolver.",
        evidence_urls: [],
      };
    }
  }
}

export { ALL_SOURCES, MIN_SIGNALS_FOR_A_MISS };
