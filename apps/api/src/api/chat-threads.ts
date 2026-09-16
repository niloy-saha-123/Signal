// Thread management — the CRUD shell around the chat graph's checkpointed
// threads. A chat_threads row is the caller-facing handle; the compiled
// chatGraph's PostgresSaver holds the actual conversation state keyed by
// thread_id = chat_threads.id (see chat-graph.ts). This router only ever
// touches the checkpointer for reads/deletes AFTER confirming the row belongs
// to the caller's workspace — getChatThreadForWorkspace is the sole tenant
// boundary, since the checkpointer has no workspace concept.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { getChatCheckpointer } from "../agents/chat/chat-graph";
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

export interface ChatThreadsRouterDeps {
  createChatThread: typeof queries.createChatThread;
  listChatThreadsForWorkspace: typeof queries.listChatThreadsForWorkspace;
  getChatThreadForWorkspace: typeof queries.getChatThreadForWorkspace;
  deleteChatThreadForWorkspace: typeof queries.deleteChatThreadForWorkspace;
  checkpointer: ChatThreadCheckpointer;
}

export const defaultChatThreadsRouterDeps: ChatThreadsRouterDeps = {
  createChatThread: queries.createChatThread,
  listChatThreadsForWorkspace: queries.listChatThreadsForWorkspace,
  getChatThreadForWorkspace: queries.getChatThreadForWorkspace,
  deleteChatThreadForWorkspace: queries.deleteChatThreadForWorkspace,
  checkpointer: getChatCheckpointer() as unknown as ChatThreadCheckpointer,
};

const CreateThreadBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

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