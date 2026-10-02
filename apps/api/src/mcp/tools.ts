// Read-only MCP tools. Every handler takes the workspace from the verified API
// token, never from tool arguments, and answers a foreign id exactly like a
// missing one so a token cannot probe other workspaces.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as queries from "../db/queries";
import {
  loadCompetitorProfile,
  type CompetitorProfileDeps,
} from "../api/competitor-profile";
import { hybridRetrieve } from "../retrieval";
import { runChatAgent } from "../agents/chat/chat-agent";
import { logger } from "../lib/logger";
import { fenceResult } from "./fence";

// Matches the chat agent's own cap on competitors per turn.
const MAX_ASK_COMPETITORS = 25;
const EXCERPT_CHARS = 600;

export class McpToolError extends Error {}

export interface McpToolDeps {
  listCompetitorsForWorkspace: typeof queries.listCompetitorsForWorkspace;
  getCompetitorsByIdsForWorkspace: typeof queries.getCompetitorsByIdsForWorkspace;
  profileDeps: CompetitorProfileDeps;
  listPredictionsForWorkspace: typeof queries.listPredictionsForWorkspace;
  getPredictionForWorkspace: typeof queries.getPredictionForWorkspace;
  listRoadmapLinks: typeof queries.listRoadmapLinks;
  hybridRetrieve: typeof hybridRetrieve;
  getSignalsByIds: typeof queries.getSignalsByIds;
  getDashboardSummaryForWorkspace: typeof queries.getDashboardSummaryForWorkspace;
  listAlertFeed: typeof queries.listAlertFeed;
  getLatestScoreForCompetitors: typeof queries.getLatestScoreForCompetitors;
  createAgentRun: typeof queries.createAgentRun;
  completeAgentRun: typeof queries.completeAgentRun;
  failRunIfRunning: typeof queries.failRunIfRunning;
  runChatAgent: typeof runChatAgent;
  // Charges the ask_signal budgets and takes an in-flight slot. Throws
  // McpToolError when over a limit; otherwise returns the slot's release.
  beginAsk: (ctx: McpContext) => Promise<() => void>;
}

export const defaultMcpToolDeps: Omit<McpToolDeps, "beginAsk"> = {
  listCompetitorsForWorkspace: queries.listCompetitorsForWorkspace,
  getCompetitorsByIdsForWorkspace: queries.getCompetitorsByIdsForWorkspace,
  profileDeps: {
    getCompetitorByIdForWorkspace: queries.getCompetitorByIdForWorkspace,
    getLatestSignalScores: queries.getLatestSignalScores,
    getSignalVolumeByDay: queries.getSignalVolumeByDay,
    getJobSignalsForHiringDelta: queries.getJobSignalsForHiringDelta,
    listPredictionsForWorkspace: queries.listPredictionsForWorkspace,
    listSignalFeed: queries.listSignalFeed,
  },
  listPredictionsForWorkspace: queries.listPredictionsForWorkspace,
  getPredictionForWorkspace: queries.getPredictionForWorkspace,
  listRoadmapLinks: queries.listRoadmapLinks,
  hybridRetrieve,
  getSignalsByIds: queries.getSignalsByIds,
  getDashboardSummaryForWorkspace: queries.getDashboardSummaryForWorkspace,
  listAlertFeed: queries.listAlertFeed,
  getLatestScoreForCompetitors: queries.getLatestScoreForCompetitors,
  createAgentRun: queries.createAgentRun,
  completeAgentRun: queries.completeAgentRun,
  failRunIfRunning: queries.failRunIfRunning,
  runChatAgent,
};

export interface McpContext {
  workspaceId: string;
  tokenId: string;
  // Aborts when the client disconnects, so a dropped ask_signal stops spending.
  signal?: AbortSignal;
}

type Competitor = Awaited<
  ReturnType<typeof queries.listCompetitorsForWorkspace>
>[number];
type Prediction = Awaited<
  ReturnType<typeof queries.listPredictionsForWorkspace>
>[number];
type Signal = Awaited<ReturnType<typeof queries.getSignalsByIds>>[number];

const competitorView = (c: Competitor) => ({
  id: c.id,
  name: c.name,
  domain: c.domain,
  is_own_company: c.is_own_company,
  is_active: c.is_active,
});

const forecastView = (p: Prediction) => ({
  id: p.id,
  competitor_id: p.competitor_id,
  statement: p.statement,
  probability: p.probability,
  pattern_type: p.pattern_type,
  status: p.status,
  resolves_at: p.resolves_at,
  evidence_count: p.evidence_count,
  // null = not scored, never zero.
  brier_score: p.brier_score,
});

const signalView = (s: Signal) => ({
  id: s.id,
  competitor_id: s.competitor_id,
  source: s.source,
  title: s.title,
  url: s.source_url,
  excerpt: s.raw_text.slice(0, EXCERPT_CHARS),
  quality_score: s.quality_score,
  collected_at: s.collected_at,
});

async function requireOwnCompetitors(
  deps: McpToolDeps,
  ids: string[],
  workspaceId: string,
): Promise<string[]> {
  const unique = [...new Set(ids)];
  const owned = await deps.getCompetitorsByIdsForWorkspace(unique, workspaceId);
  if (owned.length !== unique.length)
    throw new McpToolError("Competitor not found in this workspace.");
  return unique;
}

// Default scope when a tool gets no competitor_ids: the competitors the
// workspace actively watches, capped like a chat turn so fan-out stays bounded.
async function defaultCompetitorIds(deps: McpToolDeps, workspaceId: string): Promise<string[]> {
  return (await deps.listCompetitorsForWorkspace(workspaceId))
    .filter((c) => c.is_active && !c.is_own_company)
    .map((c) => c.id)
    .slice(0, MAX_ASK_COMPETITORS);
}

function isTimeoutOrAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export function createMcpToolHandlers(deps: McpToolDeps) {
  return {
    async list_competitors(ctx: McpContext) {
      const rows = await deps.listCompetitorsForWorkspace(ctx.workspaceId);
      return { competitors: rows.map(competitorView) };
    },

    async get_competitor_profile(
      ctx: McpContext,
      args: { competitor_id: string },
    ) {
      const profile = await loadCompetitorProfile(
        ctx.workspaceId,
        args.competitor_id,
        deps.profileDeps,
      );
      if (!profile)
        throw new McpToolError("Competitor not found in this workspace.");
      return {
        competitor: competitorView(profile.competitor),
        score: profile.score,
        history: profile.history,
        hiring: profile.hiring,
        coverage: profile.coverage,
        open_forecasts: profile.forecasts.map(forecastView),
        recent_evidence: profile.signals.slice(0, 20).map(signalView),
      };
    },

    async list_forecasts(
      ctx: McpContext,
      args: {
        status?: Prediction["status"];
        competitor_id?: string;
        limit?: number;
      },
    ) {
      const rows = await deps.listPredictionsForWorkspace({
        workspace_id: ctx.workspaceId,
        status: args.status,
        competitor_id: args.competitor_id,
        limit: args.limit ?? 20,
      });
      return { forecasts: rows.map(forecastView) };
    },

    async get_forecast(ctx: McpContext, args: { forecast_id: string }) {
      const row = await deps.getPredictionForWorkspace(
        args.forecast_id,
        ctx.workspaceId,
      );
      if (!row) throw new McpToolError("Forecast not found in this workspace.");
      const links = await deps.listRoadmapLinks(row.id, ctx.workspaceId);
      return {
        ...forecastView(row),
        horizon_days: row.horizon_days,
        resolution_criteria: row.resolution_criteria,
        resolved_at: row.resolved_at,
        resolution_note: row.resolution_note,
        resolution_evidence_urls: row.resolution_evidence_urls,
        created_at: row.created_at,
        roadmap_links: links.map((l) => ({
          title: l.title,
          url: l.url,
          stance: l.stance,
        })),
      };
    },

    async search_evidence(
      ctx: McpContext,
      args: { query: string; competitor_ids?: string[]; limit?: number },
    ) {
      const ids = args.competitor_ids?.length
        ? await requireOwnCompetitors(
            deps,
            args.competitor_ids,
            ctx.workspaceId,
          )
        : await defaultCompetitorIds(deps, ctx.workspaceId);
      if (ids.length === 0) return { results: [] };
      const limit = args.limit ?? 10;
      const chunks = await deps.hybridRetrieve(args.query, ids, limit);
      const allowed = new Set(ids);
      const rows = await deps.getSignalsByIds(
        chunks.slice(0, limit).map((c) => c.id),
      );
      const byId = new Map(
        rows.filter((r) => allowed.has(r.competitor_id)).map((r) => [r.id, r]),
      );
      return {
        results: chunks
          .map((c) => byId.get(c.id))
          .filter((r): r is Signal => r !== undefined)
          .map(signalView),
      };
    },

    async get_briefing(ctx: McpContext) {
      const competitors = (
        await deps.listCompetitorsForWorkspace(ctx.workspaceId)
      ).filter((c) => !c.is_own_company);
      const ids = competitors.map((c) => c.id);
      const [summary, alerts, open, scores] = await Promise.all([
        deps.getDashboardSummaryForWorkspace(ctx.workspaceId),
        ids.length
          ? deps.listAlertFeed({
              workspace_id: ctx.workspaceId,
              competitor_ids: ids,
              limit: 6,
            })
          : [],
        deps.listPredictionsForWorkspace({
          workspace_id: ctx.workspaceId,
          status: "open",
          limit: 50,
        }),
        deps.getLatestScoreForCompetitors(ids),
      ]);
      const latest = new Map(scores.map((row) => [row.competitor_id, row]));
      return {
        summary,
        what_moved: alerts.slice(0, 6).map((a) => ({
          id: a.id,
          competitor_id: a.competitor_id,
          pattern: a.pattern,
          confidence: a.confidence,
          interpretation: a.interpretation,
          recommended_actions: a.recommended_actions,
          created_at: a.created_at,
        })),
        resolving_soon: [...open]
          .sort((a, b) => a.resolves_at.getTime() - b.resolves_at.getTime())
          .slice(0, 5)
          .map(forecastView),
        pulse: competitors.map((c) => ({
          competitor_id: c.id,
          name: c.name,
          score: latest.get(c.id)?.score ?? null,
          delta_7d: latest.get(c.id)?.delta_7d ?? null,
        })),
      };
    },

    async ask_signal(ctx: McpContext, args: { question: string; competitor_ids?: string[] }) {
      // Validate before charging the budget, so a bad id costs nothing.
      const ids = args.competitor_ids?.length
        ? await requireOwnCompetitors(deps, args.competitor_ids, ctx.workspaceId)
        : await defaultCompetitorIds(deps, ctx.workspaceId);
      if (ids.length === 0) throw new McpToolError("This workspace is not tracking any competitors yet.");

      const release = await deps.beginAsk(ctx);
      try {
        const run = await deps.createAgentRun({ competitor_id: ids[0], trigger: "manual" });
        let result: Awaited<ReturnType<typeof runChatAgent>>;
        try {
          result = await deps.runChatAgent(
            {
              query: args.question,
              workspace_id: ctx.workspaceId,
              competitor_ids: ids,
              run_id: run.id,
              read_only: true,
            },
            { signal: ctx.signal }
          );
        } catch (error) {
          await deps.failRunIfRunning(run.id).catch(() => undefined);
          if (isTimeoutOrAbort(error)) {
            throw new McpToolError("Signal took too long to answer. Try a narrower question.");
          }
          throw error;
        }
        // The answer is already paid for; a bookkeeping failure must not lose it.
        await deps.completeAgentRun(run.id, "completed").catch((error) => {
          logger.warn("mcp: failed to complete agent run", {
            run_id: run.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return result;
      } finally {
        release();
      }
    },
  };
}

export type McpToolHandlers = ReturnType<typeof createMcpToolHandlers>;

const uuid = z.string().uuid();

export function registerMcpTools(
  server: McpServer,
  ctx: McpContext,
  handlers: McpToolHandlers,
): void {
  const run =
    <A>(name: keyof McpToolHandlers, fn: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      const started = Date.now();
      try {
        const data = await fn(args);
        logger.info("mcp: tool call", {
          tool: name,
          workspace_id: ctx.workspaceId,
          token_id: ctx.tokenId,
          duration_ms: Date.now() - started,
          ok: true,
        });
        return {
          content: [{ type: "text" as const, text: fenceResult(data) }],
        };
      } catch (error) {
        const known = error instanceof McpToolError;
        logger[known ? "info" : "error"]("mcp: tool call", {
          tool: name,
          workspace_id: ctx.workspaceId,
          token_id: ctx.tokenId,
          duration_ms: Date.now() - started,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: known ? error.message : "Signal hit an internal error.",
            },
          ],
        };
      }
    };
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };

  server.registerTool(
    "list_competitors",
    {
      description:
        "List the competitors this Signal workspace tracks (including the workspace's own company).",
      annotations: { title: "List competitors", ...readOnly },
    },
    run("list_competitors", () => handlers.list_competitors(ctx)),
  );

  server.registerTool(
    "get_competitor_profile",
    {
      description:
        "A competitor's battlecard: momentum score and history, hiring changes, which sources are live, " +
        "open forecasts, and recent evidence.",
      inputSchema: { competitor_id: uuid },
      annotations: { title: "Competitor profile", ...readOnly },
    },
    run("get_competitor_profile", (args: { competitor_id: string }) =>
      handlers.get_competitor_profile(ctx, args),
    ),
  );

  server.registerTool(
    "list_forecasts",
    {
      description:
        "List Signal's forecasts about competitors, newest first. Filter by status (open, hit, miss, unresolved, " +
        "void) or competitor. A null brier_score means not scored, not zero.",
      inputSchema: {
        status: z
          .enum(["open", "hit", "miss", "unresolved", "void"])
          .optional(),
        competitor_id: uuid.optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { title: "List forecasts", ...readOnly },
    },
    run(
      "list_forecasts",
      (args: Parameters<McpToolHandlers["list_forecasts"]>[1]) =>
        handlers.list_forecasts(ctx, args),
    ),
  );

  server.registerTool(
    "get_forecast",
    {
      description:
        "One forecast in full: resolution criteria, outcome once settled, and the team's linked roadmap items.",
      inputSchema: { forecast_id: uuid },
      annotations: { title: "Get forecast", ...readOnly },
    },
    run("get_forecast", (args: { forecast_id: string }) =>
      handlers.get_forecast(ctx, args),
    ),
  );

  server.registerTool(
    "search_evidence",
    {
      description:
        "Search the evidence Signal has collected about competitors (posts, changelogs, jobs, docs, news...). " +
        "Omit competitor_ids to search every competitor.",
      inputSchema: {
        query: z.string().trim().min(1).max(500),
        competitor_ids: z.array(uuid).min(1).max(25).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      annotations: { title: "Search evidence", ...readOnly },
    },
    run(
      "search_evidence",
      (args: Parameters<McpToolHandlers["search_evidence"]>[1]) =>
        handlers.search_evidence(ctx, args),
    ),
  );

  server.registerTool(
    "get_briefing",
    {
      description:
        "The workspace's briefing: what moved recently, forecasts resolving soonest, and each competitor's score pulse.",
      annotations: { title: "Briefing", ...readOnly },
    },
    run("get_briefing", () => handlers.get_briefing(ctx)),
  );

  server.registerTool(
    "ask_signal",
    {
      description:
        "Ask Signal a question. It answers only from collected evidence, with citations, and declines when the " +
        "evidence is thin. Slower and rate-limited; prefer the other tools for lookups.",
      inputSchema: {
        question: z.string().trim().min(1).max(2000),
        competitor_ids: z
          .array(uuid)
          .min(1)
          .max(MAX_ASK_COMPETITORS)
          .optional(),
      },
      annotations: { title: "Ask Signal", ...readOnly },
    },
    run("ask_signal", (args: { question: string; competitor_ids?: string[] }) =>
      handlers.ask_signal(ctx, args),
    ),
  );
}
