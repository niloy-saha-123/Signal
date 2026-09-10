// Express route streaming ChatAgent responses via SSE.
//
// POST /api/chat
//   1. Strictly validate { query, competitor_ids } and 4xx with clean JSON
//      *before* any SSE header is sent (plan ruling 6).
//   2. Batch-verify every competitor id exists — 404 unknown_competitor listing
//      the ids that don't.
//   3. Create one agent_runs row (trigger 'manual', primary = first id) so the
//      latency rows ChatAgent writes have a run to foreign-key to (ruling 5).
//   4. Open text/event-stream, send `: open`, heartbeat every 15s, and abort the
//      agent when the client disconnects.
//   5. After runChatAgent resolves, emit exactly one `event: result` carrying the
//      whole runtime-validated ChatAgentResult (a refusal is a normal, successful
//      result — never an error), then `event: done`. Never stream draft tokens.
//   6. Operational failure after headers → a single `event: error` with a generic
//      body; err.message / stack never reach the client.
//   7. Complete the run 'completed' on a delivered result, 'failed' on an
//      operational error — exactly once. Nothing is written after disconnect.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { runChatAgent as runChatAgentImpl } from "../agents/chat/chat-agent";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler } from "./http";

export interface ChatRouterDeps {
  getCompetitorsByIds: typeof queries.getCompetitorsByIds;
  createAgentRun: typeof queries.createAgentRun;
  completeAgentRun: typeof queries.completeAgentRun;
  runChatAgent: typeof runChatAgentImpl;
}

export const defaultChatRouterDeps: ChatRouterDeps = {
  getCompetitorsByIds: queries.getCompetitorsByIds,
  createAgentRun: queries.createAgentRun,
  completeAgentRun: queries.completeAgentRun,
  runChatAgent: runChatAgentImpl,
};

const HEARTBEAT_MS = 15_000;

// Mirrors ChatAgentInputSchema's own bounds so the route rejects early with a
// clean 400; runChatAgent re-validates regardless.
const ChatBodySchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    competitor_ids: z.array(z.string().uuid()).min(1).max(25),
  })
  .strict();

const uniq = (ids: string[]): string[] => [...new Set(ids)];

export function createChatRouter(deps: ChatRouterDeps = defaultChatRouterDeps): Router {
  const router = express.Router();
  router.use(express.json());

  router.post(
    "/",
    wrap(async (req, res) => {
      // --- everything that can 4xx happens before a single SSE byte ---
      const parsed = ChatBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const { query } = parsed.data;
      const competitorIds = uniq(parsed.data.competitor_ids);

      const found = await deps.getCompetitorsByIds(competitorIds);
      if (found.length !== competitorIds.length) {
        const foundIds = new Set(found.map((c) => c.id));
        res.status(404).json({
          error: "unknown_competitor",
          missing: competitorIds.filter((id) => !foundIds.has(id)),
        });
        return;
      }

      const run = await deps.createAgentRun({
        competitor_id: competitorIds[0],
        trigger: "manual",
      });

      // --- SSE open: from here only stream events, never a status code ---
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      res.write(": open\n\n");
      res.on("error", (err) => {
        logger.warn("chat: SSE response stream error", {
          run_id: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      let clientGone = false;
      const heartbeat = setInterval(() => {
        if (!clientGone) res.write(": ping\n\n");
      }, HEARTBEAT_MS);

      const ac = new AbortController();
      const onClose = () => {
        clientGone = true;
        ac.abort();
      };
      // `req` close covers a hang-up before the response stream is torn down;
      // `res` close covers the client dropping the SSE connection mid-stream.
      req.on("close", onClose);
      res.on("close", onClose);

      let runSettled = false;
      const settleRun = async (status: "completed" | "failed"): Promise<void> => {
        if (runSettled) return;
        runSettled = true;
        try {
          await deps.completeAgentRun(run.id, status);
        } catch (err) {
          logger.error("chat: failed to finalize agent run", {
            run_id: run.id,
            status,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      try {
        const result = await deps.runChatAgent(
          { query, competitor_ids: competitorIds, run_id: run.id },
          { signal: ac.signal }
        );
        if (clientGone) {
          await settleRun("completed");
          return;
        }
        // One verified result — refusal or answer — then done. No draft tokens.
        res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
        res.write("event: done\ndata: {}\n\n");
        await settleRun("completed");
      } catch (err) {
        await settleRun("failed");
        if (clientGone || ac.signal.aborted) return;
        logger.error("chat: runChatAgent failed", {
          run_id: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
        res.write(`event: error\ndata: ${JSON.stringify({ error: "chat_failed" })}\n\n`);
      } finally {
        clearInterval(heartbeat);
        req.removeListener("close", onClose);
        res.removeListener("close", onClose);
        if (!res.writableEnded) res.end();
      }
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
