// Express route streaming ChatAgent responses via SSE.
//
// POST /api/chat
//   1. Strictly validate { query, competitor_ids, thread_id? } and 4xx with clean
//      JSON *before* any SSE header is sent (plan ruling 6).
//   2. Batch-verify every competitor id exists in the caller's workspace — 404
//      unknown_competitor listing the ids that don't (an id from another
//      workspace is indistinguishable from a nonexistent one, by design).
//   3. Create one agent_runs row (trigger 'manual', primary = first id) so the
//      latency rows ChatAgent writes have a run to foreign-key to (ruling 5).
//   4. Open text/event-stream, send `: open`, heartbeat every 15s, and abort the
//      agent when the client disconnects.
//   5. Stream the generateNode draft as zero-or-more `event: token` frames
//      (`data: {"text": "..."}`), then — after the citation check has corrected
//      or refused the draft — exactly one `event: result` carrying the whole
//      runtime-validated ChatAgentResult (a refusal is a normal, successful
//      result — never an error), then `event: done`. The result frame is the
//      correction frame: Phase 5's frontend reconciles it against the tokens
//      already rendered.
//   6. Operational failure after headers → a single `event: error` with a generic
//      body; err.message / stack never reach the client.
//   7. Complete the run 'completed' on a delivered result, 'failed' on an
//      operational error — exactly once. Nothing is written after disconnect.
//
// A `thread_id` may be supplied so a turn lands on an existing thread; when
// omitted a new chat thread is auto-created (title null, i.e. untitled) and the
// new id is used as the checkpointer's thread_id. After a delivered turn,
// touchChatThread bumps that thread's updated_at.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { streamChat as streamChatImpl } from "../agents/chat/chat-agent";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler } from "./http";

export interface ChatRouterDeps {
  getCompetitorsByIdsForWorkspace: typeof queries.getCompetitorsByIdsForWorkspace;
  createAgentRun: typeof queries.createAgentRun;
  completeAgentRun: typeof queries.completeAgentRun;
  createChatThread: typeof queries.createChatThread;
  touchChatThread: typeof queries.touchChatThread;
  streamChat: typeof streamChatImpl;
  finalizeRunTimeoutMs: number;
}

export const defaultChatRouterDeps: ChatRouterDeps = {
  getCompetitorsByIdsForWorkspace: queries.getCompetitorsByIdsForWorkspace,
  createAgentRun: queries.createAgentRun,
  completeAgentRun: queries.completeAgentRun,
  createChatThread: queries.createChatThread,
  touchChatThread: queries.touchChatThread,
  streamChat: streamChatImpl,
  finalizeRunTimeoutMs: 5_000,
};

const HEARTBEAT_MS = 15_000;

// Mirrors ChatAgentInputSchema's own bounds so the route rejects early with a
// clean 400; streamChat re-validates regardless.
const ChatBodySchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    competitor_ids: z.array(z.string().uuid()).min(1).max(25),
    thread_id: z.string().uuid().optional(),
  })
  .strict();

const uniq = (ids: string[]): string[] => [...new Set(ids)];

export function createChatRouter(deps: ChatRouterDeps = defaultChatRouterDeps): Router {
  const router = express.Router();
  router.use(express.json());
  router.use((req, res, next) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "no_workspace" });
      return;
    }
    next();
  });

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

      const found = await deps.getCompetitorsByIdsForWorkspace(competitorIds, req.workspaceId!);
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

      const threadId =
        parsed.data.thread_id ?? (await deps.createChatThread(req.workspaceId!)).id;

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
      // IncomingMessage `close` also fires after a normally completed request
      // body on modern Node, so it is not a disconnect signal. `aborted` is
      // premature-request-only; response `close` covers an SSE hang-up.
      req.on("aborted", onClose);
      res.on("close", onClose);

      let runSettled = false;
      const settleRun = async (status: "completed" | "failed"): Promise<void> => {
        if (runSettled) return;
        runSettled = true;
        let timeoutHandle: NodeJS.Timeout | undefined;
        const finalization = deps.completeAgentRun(run.id, status).then(
          () => ({ kind: "completed" as const }),
          (error: unknown) => ({ kind: "failed" as const, error })
        );
        const deadline = new Promise<{ kind: "timed_out" }>((resolve) => {
          timeoutHandle = setTimeout(
            () => resolve({ kind: "timed_out" }),
            deps.finalizeRunTimeoutMs
          );
          timeoutHandle.unref();
        });
        const outcome = await Promise.race([finalization, deadline]);
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (outcome.kind === "failed") {
          logger.error("chat: failed to finalize agent run", {
            run_id: run.id,
            status,
            error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
          });
        } else if (outcome.kind === "timed_out") {
          logger.error("chat: agent run finalization timed out", {
            run_id: run.id,
            status,
            timeout_ms: deps.finalizeRunTimeoutMs,
          });
        }
      };

      try {
        for await (const evt of deps.streamChat(
          {
            query,
            competitor_ids: competitorIds,
            workspace_id: req.workspaceId!,
            run_id: run.id,
            thread_id: threadId,
          },
          { signal: ac.signal }
        )) {
          if (clientGone) break;
          if (evt.kind === "token") {
            res.write(`event: token\ndata: ${JSON.stringify({ text: evt.text })}\n\n`);
          } else {
            // The citation check has corrected (or refused) the streamed draft —
            // this is the correction frame the frontend reconciles against.
            res.write(`event: result\ndata: ${JSON.stringify(evt.result)}\n\n`);
          }
        }
        if (clientGone) {
          await settleRun("completed");
          return;
        }
        res.write("event: done\ndata: {}\n\n");
        await settleRun("completed");
        await deps.touchChatThread(threadId).catch((err) => {
          logger.warn("chat: touchChatThread failed", {
            thread_id: threadId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } catch (err) {
        await settleRun("failed");
        if (clientGone || ac.signal.aborted) return;
        logger.error("chat: streamChat failed", {
          run_id: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
        res.write(`event: error\ndata: ${JSON.stringify({ error: "chat_failed" })}\n\n`);
      } finally {
        clearInterval(heartbeat);
        req.removeListener("aborted", onClose);
        res.removeListener("close", onClose);
        if (!res.writableEnded) res.end();
      }
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
