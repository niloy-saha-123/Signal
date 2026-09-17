// LangGraph node — the 7th and final node in the analysis DAG, run conditionally only when the
// analysis is for the workspace's own-company competitor row (see the conditional edge in
// graph/analysis-graph.ts and the `is_own_company_run` flag seeded by analysis-worker.ts).
//
// It compares "us" against the workspace's real competitors and produces advisory
// "competitor did X, we haven't — possible reasons, possible responses" output, persisted as an
// alert against the own-company competitor_id. Unlike synthesisNode, this node is advisory-only
// and is NEVER fatal: synthesisNode has already called completeAgentRun(..., "completed", ...)
// before it runs, so a throw here would be too late to mark the run failed AND would trigger a
// full-graph BullMQ retry that re-bills all 6 upstream LLM calls. Its entire body is therefore
// wrapped so any error (DB, LLM, parse, createAlert) is logged and degrades to `{}`.
import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessage } from "@langchain/core/messages";
import type { AnalysisGraphStateType } from "../../graph/state";
import { logger } from "../../lib/logger";
import { getCompanyContext } from "../../lib/company-context";
import {
  listCompetitorsForWorkspace,
  getRecentSignalsByCompetitorIds,
  getLatestSignalScores,
  createAlert,
  type Competitor,
  type Signal,
} from "../../db/queries";
import { trackLatency } from "../../lib/latency-tracker";
import { trackCost } from "../../llm/cost-tracker";
import { selectModel, ANTHROPIC_MODEL_IDS } from "../../llm/adaptive-router";
import { getActivePrompt } from "../../llm/prompt-registry";
import { isLlmBudgetExhausted } from "./branch-node";
import { ComparativeSynthesisSchema } from "./contracts";

const AGENT_NAME = "comparative_synthesis" as const;

// "claude-sonnet" IS a DOWNGRADE_MAP key — selectModel can hand back either "claude-sonnet"
// or the downgraded "claude-haiku" here depending on today's spend (same as synthesis.ts).
const PREFERRED_MODEL = "claude-sonnet";

// Bounded client budget — same reasoning as every other LLM-calling agent in this codebase.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Same "don't blow the context window" bound as the other analysis agents.
const COMPARATIVE_INPUT_MAX_LENGTH = 24_000;

// Advisory output is medium-confidence by nature — it is a model's interpretation of gaps, not
// a measured threat. A fixed value (not derived from the model's free text) keeps the alert
// within the DB CHECK (0..1) without pretending precision we don't have.
const COMPARATIVE_CONFIDENCE = 0.5;

const SYSTEM_PROMPT_BASE =
  "You compare a company's own competitive posture against its tracked competitors and " +
  "produce advisory output for a product and growth team. Given the company's own recent " +
  "analysis (its Signal Score and its alert/digest/suppress decision) and each competitor's " +
  "recent activity, identify what competitors are doing that this company is not, the " +
  "possible reasons for each gap, and possible responses. You only advise — you never act. " +
  "Write a short headline-style summary of the overall comparison (max 200 characters), a " +
  "plain-language summary of the comparison (max 2000 characters), up to 10 observations " +
  "(each a `competitor_name` and a one-sentence `what_they_did`), and up to 10 gaps (each a " +
  "`gap` naming what the company hasn't done, up to 5 `possible_reasons` strings, and up to 5 " +
  "`possible_responses` strings). Keep every string concise and grounded in the activity " +
  "shown; do not invent competitor actions not present in the data.";

// One line per real competitor's most recent signal (bounded), plus their latest Signal Score
// when one exists — enough for the model to ground "competitor did X" claims without dumping
// raw_text (which can be arbitrarily large and is the thing COMPARATIVE_INPUT_MAX_LENGTH guards).
function buildContextText(input: {
  state: AnalysisGraphStateType;
  competitors: Competitor[];
  signalsByCompetitor: Map<string, Signal[]>;
  latestScores: Map<string, number | null>;
}): string {
  const { state, competitors, signalsByCompetitor, latestScores } = input;

  const lines = [
    "Our own posture:",
    `- Signal Score: ${state.signal_score ? `${state.signal_score.score}/100` : "N/A"}`,
    `- Decision: ${state.decision?.action ?? "N/A"}${state.decision?.reason ? ` — ${state.decision.reason}` : ""}`,
    "",
    "Competitor activity:",
  ];

  for (const competitor of competitors) {
    const signals = signalsByCompetitor.get(competitor.id) ?? [];
    const score = latestScores.get(competitor.id);
    lines.push(`- ${competitor.name}${score === null ? "" : ` (Signal Score: ${score}/100)`}:`);
    if (signals.length === 0) {
      lines.push("  (no recent signals)");
    }
    for (const signal of signals) {
      const title = signal.title ? signal.title : signal.raw_text.slice(0, 120);
      lines.push(`  - [${signal.source}] ${title}`);
    }
  }

  return lines.join("\n").slice(0, COMPARATIVE_INPUT_MAX_LENGTH);
}

// Map the structured output onto alerts columns per R5: pattern = headline, interpretation =
// the why/reasons prose (summary + per-gap reasons), evidence = the "competitor did X"
// observations, recommended_actions = the possible responses flattened to {action}.
function buildAlertInput(parsed: { headline: string; summary: string; observations: { competitor_name: string; what_they_did: string }[]; gaps: { gap: string; possible_reasons: string[]; possible_responses: string[] }[] }): Omit<Parameters<typeof createAlert>[0], "run_id" | "competitor_id"> {
  const interpretationLines = [parsed.summary];
  for (const gap of parsed.gaps) {
    interpretationLines.push(`${gap.gap} — ${gap.possible_reasons.join("; ")}`);
  }

  return {
    pattern: parsed.headline,
    confidence: COMPARATIVE_CONFIDENCE,
    evidence: parsed.observations.map((observation) => ({
      competitor_name: observation.competitor_name,
      what_they_did: observation.what_they_did,
    })),
    interpretation: interpretationLines.join("\n\n"),
    vulnerability_window_days: null,
    recommended_actions: parsed.gaps.flatMap((gap) =>
      gap.possible_responses.map((response) => ({ action: response }))
    ),
    supporting_cluster_ids: [],
  };
}

export async function comparativeSynthesisNode(
  state: AnalysisGraphStateType
): Promise<Partial<AnalysisGraphStateType>> {
  try {
    // Only the workspace's OTHER active competitors are compared against "us".
    const competitors = (await listCompetitorsForWorkspace(state.workspace_id)).filter(
      (competitor) => !competitor.is_own_company && competitor.is_active
    );
    if (competitors.length === 0) {
      return {};
    }

    const competitorIds = competitors.map((competitor) => competitor.id);

    const [signals, scoreRows] = await Promise.all([
      getRecentSignalsByCompetitorIds(competitorIds),
      Promise.all(competitorIds.map((id) => getLatestSignalScores(id, 1))),
    ]);

    const signalsByCompetitor = new Map<string, Signal[]>();
    for (const signal of signals) {
      const list = signalsByCompetitor.get(signal.competitor_id) ?? [];
      list.push(signal);
      signalsByCompetitor.set(signal.competitor_id, list);
    }
    const latestScores = new Map<string, number | null>();
    competitors.forEach((competitor, index) => {
      const rows = scoreRows[index] ?? [];
      latestScores.set(competitor.id, rows.length > 0 ? rows[0].score : null);
    });

    const companyContext = await getCompanyContext(state.workspace_id);
    const promptText = (await getActivePrompt(AGENT_NAME)) ?? SYSTEM_PROMPT_BASE;
    const systemPrompt = companyContext ? `${promptText}\n\n${companyContext}` : promptText;

    const contextText = buildContextText({
      state,
      competitors,
      signalsByCompetitor,
      latestScores,
    });

    let parsed: typeof ComparativeSynthesisSchema._type;

    // Budget gate: skip the ChatAnthropic call on budget exhaustion (the node is advisory, so
    // a skip degrades to `{}` cleanly rather than a synthesized alert).
    if (await isLlmBudgetExhausted(AGENT_NAME, state)) {
      return {};
    }

    const modelAlias = await selectModel(PREFERRED_MODEL, true);
    const chatModel = new ChatAnthropic({
      model: ANTHROPIC_MODEL_IDS[modelAlias] ?? modelAlias,
      clientOptions: { timeout: LLM_TIMEOUT_MS },
      maxRetries: LLM_MAX_RETRIES,
    });
    const structuredModel = chatModel.withStructuredOutput(ComparativeSynthesisSchema, {
      includeRaw: true,
    });

    const telemetryContext = {
      competitorId: state.competitor_id,
      identity: { kind: "run" as const, runId: state.run_id },
    };
    const { raw, parsed: maybeParsed } = await trackLatency(AGENT_NAME, telemetryContext, () =>
      structuredModel.invoke([
        ["system", systemPrompt],
        ["human", contextText],
      ])
    );

    const usage = (raw as AIMessage).usage_metadata;
    await trackCost(
      AGENT_NAME,
      modelAlias,
      usage?.input_tokens ?? 0,
      usage?.output_tokens ?? 0,
      telemetryContext
    );

    if (!maybeParsed) {
      logger.error("comparative_synthesis: structured output failed schema validation", {
        competitor_id: state.competitor_id,
        run_id: state.run_id,
        failure: "invalid_structured_output",
      });
      return {};
    }
    parsed = maybeParsed;

    await createAlert({
      ...buildAlertInput(parsed),
      competitor_id: state.competitor_id,
      run_id: state.run_id,
    });

    return { comparative_synthesis: parsed };
  } catch (error) {
    // R7: degrade, never throw. synthesisNode already closed the run "completed"; a throw here
    // would both be too late to mark it failed and trigger a full-graph retry re-billing all 6
    // upstream LLM calls.
    logger.error("comparative_synthesis: node failed — degrading to empty result", {
      agent_name: AGENT_NAME,
      competitor_id: state.competitor_id,
      run_id: state.run_id,
      error,
    });
    return {};
  }
}
