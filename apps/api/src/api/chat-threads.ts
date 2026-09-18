// Thread management — the CRUD shell around the chat graph's checkpointed
// threads. A chat_threads row is the caller-facing handle; the compiled
// chatGraph's PostgresSaver holds the actual conversation state keyed by
// thread_id = chat_threads.id (see chat-graph.ts). This router only ever
// touches the checkpointer for reads/deletes AFTER confirming the row belongs
// to the caller's workspace — getChatThreadForWorkspace is the sole tenant
// boundary, since the checkpointer has no workspace concept.
import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as queries from "../db/queries";
import { getChatCheckpointer, getChatGraph, setupChatCheckpointer } from "../agents/chat/chat-graph";
import { resumeChat as resumeChatImpl } from "../agents/chat/chat-agent";
import type { ChatStreamEvent } from "../agents/chat/chat-agent";
import { listPendingConfirmationsForWorkspace } from "../agents/chat/confirmation-expiry";
import type { PendingConfirmation } from "../agents/chat/confirmation-expiry";
import type { ChatAgentResult } from "@signal/shared";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler, requireUuidParam } from "./http";

// Minimal checkpointer slice the router needs: read a thread's messages and
// drop a thread's checkpoint rows. The real PostgresSaver satisfies both, and
// tests inject a plain fake so no Postgres is required.
export interface ChatThreadCheckpointer {
  getTuple(config: { configurable: { thread_id: string } }): Promise<
    { checkpoint: { channel_values: { messages?: unknown } } } | undefined
  >;
  deleteThread(threadId: string): Promise<void>;
}

export interface CheckpointSummary {
  checkpoint_id: string;
  created_at: string | undefined;
  message_count: number;
}

export interface ChatThreadsRouterDeps {
  createChatThread: typeof queries.createChatThread;
  listChatThreadsForWorkspace: typeof queries.listChatThreadsForWorkspace;
  getChatThreadForWorkspace: typeof queries.getChatThreadForWorkspace;
  deleteChatThreadForWorkspace: typeof queries.deleteChatThreadForWorkspace;
  checkpointer: ChatThreadCheckpointer;
  // Time-travel: list a thread's checkpoints and fork from one to re-run
  // generation. Default impls use the compiled chat graph's checkpointer API.
  listCheckpoints: (threadId: string) => Promise<CheckpointSummary[]>;
  regenerate: (threadId: string, checkpointId: string) => Promise<ChatAgentResult>;
  // Resume a thread paused at a confirm gate (HITL mutation), streaming whatever
  // happens next over SSE.
  resumeChat: (
    threadId: string,
    decision: "approve" | "deny",
    opts?: { signal?: AbortSignal }
  ) => AsyncGenerator<ChatStreamEvent>;
  // List threads in the workspace currently paused at a confirm gate.
  listPendingConfirmations: (workspaceId: string) => Promise<PendingConfirmation[]>;
}

// The chat graph's getStateHistory yields snapshots newest-first; the picker
// wants oldest-first. Only the turn-start checkpoints (`next` = ["compact"]) are
// valid regenerate points — one per turn, at the user-question boundary — so the
// list filters to those. message_count is the length of the checkpoint's
// `messages` channel: assistant answer at message index i regenerates from the
// checkpoint with message_count === i, enough to render a picker without
// exposing full message bodies.
export async function listCheckpointsDefault(threadId: string): Promise<CheckpointSummary[]> {
  await setupChatCheckpointer();
  const graph = getChatGraph();
  const out: CheckpointSummary[] = [];
  for await (const snapshot of graph.getStateHistory({ configurable: { thread_id: threadId } })) {
    if (!snapshot.next.includes("compact")) continue;
    out.push({
      checkpoint_id: snapshot.config.configurable?.checkpoint_id ?? "",
      created_at: snapshot.createdAt,
      message_count: Array.isArray(snapshot.values?.messages) ? snapshot.values.messages.length : 0,
    });
  }
  return out.reverse();
}

// Fork-and-replay (LangGraph time travel): fork a fresh branch from the target
// checkpoint, then re-run generation from the turn start (compact). The reset
// values mirror compactNode's per-turn reset so the replayed turn starts with a
// clean nonce/loop/evidence state rather than stale prior-turn leftovers. The
// original checkpoint history is untouched — updateState + invoke(null,
// forkConfig) creates a child branch, never an edit-in-place.
export async function regenerateDefault(threadId: string, checkpointId: string): Promise<ChatAgentResult> {
  await setupChatCheckpointer();
  const graph = getChatGraph();
  const target = await graph.getState({
    configurable: { thread_id: threadId, checkpoint_id: checkpointId },
  });
  if (!target.values || Object.keys(target.values).length === 0) {
    throw new Error("chat-threads: unknown checkpoint");
  }
  const forkConfig = await graph.updateState(
    target.config,
    { nonce: randomUUID(), iterationCount: 0, loopMessages: [], evidence: [], draft: "" },
    "compact"
  );
  const result = await graph.invoke(null, forkConfig);
  return result.citation_result as ChatAgentResult;
}

export const defaultChatThreadsRouterDeps: ChatThreadsRouterDeps = {
  createChatThread: queries.createChatThread,
  listChatThreadsForWorkspace: queries.listChatThreadsForWorkspace,
  getChatThreadForWorkspace: queries.getChatThreadForWorkspace,
  deleteChatThreadForWorkspace: queries.deleteChatThreadForWorkspace,
  checkpointer: getChatCheckpointer() as unknown as ChatThreadCheckpointer,
  listCheckpoints: listCheckpointsDefault,
  regenerate: regenerateDefault,
  resumeChat: resumeChatImpl,
  listPendingConfirmations: listPendingConfirmationsForWorkspace,
};

const CreateThreadBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

const RegenerateBodySchema = z.object({
  checkpoint_id: z.string().min(1),
}).strict();

const ResumeBodySchema = z.object({ decision: z.enum(["approve", "deny"]) }).strict();

const HEARTBEAT_MS = 15_000;

// Checkpoint messages are BaseMessage instances carrying langchain internals
// (lc_*, response_metadata, usage_metadata) that don't survive JSON and don't
// belong on the wire. Reduce each to { type, content } and round-trip through
// JSON to strip anything non-serializable.
function serializeMessage(m: unknown): unknown {
  const msg = m as { getType?: () => string; content?: unknown };
  const type = typeof msg.getType === "function" ? msg.getType() : "message";
  return JSON.parse(JSON.stringify({ type, content: msg.content }));
}

export function createChatThreadsRouter(
  deps: ChatThreadsRouterDeps = defaultChatThreadsRouterDeps
): Router {
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
      const parsed = CreateThreadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const thread = await deps.createChatThread(req.workspaceId!, parsed.data.title);
      res.status(201).json(thread);
    })
  );

  router.get(
    "/",
    wrap(async (req, res) => {
      const threads = await deps.listChatThreadsForWorkspace(req.workspaceId!);
      res.status(200).json(threads);
    })
  );

  router.get(
    "/pending-confirmations",
    wrap(async (req, res) => {
      const pending = await deps.listPendingConfirmations(req.workspaceId!);
      res.status(200).json({ pending });
    })
  );

  router.get(
    "/:id/messages",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      const owned = await deps.getChatThreadForWorkspace(id, req.workspaceId!);
      if (!owned) {
        res.status(404).json({ error: "unknown_thread" });
        return;
      }
      const tuple = await deps.checkpointer.getTuple({ configurable: { thread_id: id } });
      const raw = tuple?.checkpoint?.channel_values?.messages ?? [];
      res.status(200).json({
        messages: (Array.isArray(raw) ? raw : []).map(serializeMessage),
      });
    })
  );

  router.get(
    "/:id/checkpoints",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      const owned = await deps.getChatThreadForWorkspace(id, req.workspaceId!);
      if (!owned) {
        res.status(404).json({ error: "unknown_thread" });
        return;
      }
      const checkpoints = await deps.listCheckpoints(id);
      res.status(200).json({ checkpoints });
    })
  );

  router.post(
    "/:id/regenerate",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      const parsed = RegenerateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const owned = await deps.getChatThreadForWorkspace(id, req.workspaceId!);
      if (!owned) {
        res.status(404).json({ error: "unknown_thread" });
        return;
      }
      const result = await deps.regenerate(id, parsed.data.checkpoint_id);
      res.status(200).json(result);
    })
  );

  router.post(
    "/:id/resume",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      const owned = await deps.getChatThreadForWorkspace(id, req.workspaceId!);
      if (!owned) {
        res.status(404).json({ error: "unknown_thread" });
        return;
      }
      const parsed = ResumeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      res.write(": open\n\n");

      let clientGone = false;
      const heartbeat = setInterval(() => {
        if (!clientGone) res.write(": ping\n\n");
      }, HEARTBEAT_MS);

      const ac = new AbortController();
      const onClose = () => {
        clientGone = true;
        ac.abort();
      };
      req.on("aborted", onClose);
      res.on("close", onClose);

      try {
        for await (const evt of deps.resumeChat(id, parsed.data.decision, { signal: ac.signal })) {
          if (clientGone) break;
          if (evt.kind === "token") {
            res.write(`event: token\ndata: ${JSON.stringify({ text: evt.text })}\n\n`);
          } else if (evt.kind === "confirm_required") {
            res.write(`event: confirm_required\ndata: ${JSON.stringify(evt.mutation)}\n\n`);
          } else {
            res.write(`event: result\ndata: ${JSON.stringify(evt.result)}\n\n`);
          }
        }
        if (!clientGone) res.write("event: done\ndata: {}\n\n");
      } catch (err) {
        if (!clientGone && !ac.signal.aborted) {
          logger.error("chat-threads: resume stream failed", {
            thread_id: id,
            error: err instanceof Error ? err.message : String(err),
          });
          res.write(`event: error\ndata: ${JSON.stringify({ error: "chat_failed" })}\n\n`);
        }
      } finally {
        clearInterval(heartbeat);
        req.removeListener("aborted", onClose);
        res.removeListener("close", onClose);
        if (!res.writableEnded) res.end();
      }
    })
  );

  router.delete(
    "/:id",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      const owned = await deps.getChatThreadForWorkspace(id, req.workspaceId!);
      if (!owned) {
        res.status(404).json({ error: "unknown_thread" });
        return;
      }
      await deps.deleteChatThreadForWorkspace(id, req.workspaceId!);
      // The metadata row is already gone; a checkpointer failure must not turn
      // that into a 500 — orphaned checkpoint rows are tolerable, a deleted
      // thread that errors is not.
      await deps.checkpointer.deleteThread(id).catch((err) => {
        logger.warn("chat-threads: checkpointer deleteThread failed", {
          thread_id: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      res.status(204).end();
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}