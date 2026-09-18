import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("@/agents/chat/chat-graph", () => ({ getChatCheckpointer: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createChatThreadsRouter,
  type ChatThreadsRouterDeps,
} from "@/api/chat-threads";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const THREAD_ID = "44444444-4444-4444-8444-444444444444";

function makeDeps(over: Partial<ChatThreadsRouterDeps> = {}): ChatThreadsRouterDeps {
  return {
    createChatThread: vi.fn(async () => ({ id: THREAD_ID })) as any,
    listChatThreadsForWorkspace: vi.fn(async () => []) as any,
    getChatThreadForWorkspace: vi.fn(async () => ({ id: THREAD_ID })) as any,
    deleteChatThreadForWorkspace: vi.fn(async () => undefined),
    checkpointer: {
      getTuple: vi.fn(async () => undefined),
      deleteThread: vi.fn(async () => undefined),
    },
    listCheckpoints: vi.fn(async () => []),
    regenerate: vi.fn(async () => ({
      refused: true as const,
      reason: "none",
      suggested_query: "try again",
    })),
    resumeChat: vi.fn() as any,
    listPendingConfirmations: vi.fn(async () => []),
    ...over,
  };
}

function buildApp(deps: ChatThreadsRouterDeps): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = WORKSPACE_ID;
    next();
  });
  app.use("/", createChatThreadsRouter(deps));
  return app;
}

describe("POST /api/chat-threads", () => {
  it("creates a thread for the caller's workspace and returns it with 201", async () => {
    const created = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Pricing" };
    const deps = makeDeps({ createChatThread: vi.fn(async () => created) as any });
    const res = await request(buildApp(deps)).post("/").send({ title: "Pricing" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(deps.createChatThread).toHaveBeenCalledWith(WORKSPACE_ID, "Pricing");
  });

  it("allows an omitted title and passes undefined", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).post("/").send({});

    expect(res.status).toBe(201);
    expect(deps.createChatThread).toHaveBeenCalledWith(WORKSPACE_ID, undefined);
  });

  it("rejects unknown body keys with 400", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).post("/").send({ surprise: true });

    expect(res.status).toBe(400);
    expect(deps.createChatThread).not.toHaveBeenCalled();
  });

  it("403s with no workspace", async () => {
    const deps = makeDeps();
    const app = express();
    app.use(express.json());
    app.use("/", createChatThreadsRouter(deps));

    const res = await request(app).post("/").send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "no_workspace" });
    expect(deps.createChatThread).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat-threads", () => {
  it("lists threads for the caller's workspace", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const deps = makeDeps({ listChatThreadsForWorkspace: vi.fn(async () => rows) as any });
    const res = await request(buildApp(deps)).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(deps.listChatThreadsForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
  });
});

describe("GET /api/chat-threads/:id/messages", () => {
  it("returns serialized messages for an owned thread", async () => {
    const deps = makeDeps({
      checkpointer: {
        getTuple: vi.fn(async () => ({
          checkpoint: {
            channel_values: {
              messages: [
                { getType: () => "human", content: "who shipped SSO?", lc_kwargs: { secret: () => {} } },
                {
                  getType: () => "ai",
                  content: "Acme shipped SSO in March.",
                  response_metadata: { model: "claude" },
                },
              ],
            },
          },
        })),
        deleteThread: vi.fn(),
      },
    });
    const res = await request(buildApp(deps)).get(`/${THREAD_ID}/messages`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toEqual({ type: "human", content: "who shipped SSO?" });
    expect(res.body.messages[1]).toEqual({ type: "ai", content: "Acme shipped SSO in March." });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(deps.getChatThreadForWorkspace).toHaveBeenCalledWith(THREAD_ID, WORKSPACE_ID);
    expect(deps.checkpointer.getTuple).toHaveBeenCalledWith({
      configurable: { thread_id: THREAD_ID },
    });
  });

  it("returns an empty list when the checkpointer has no tuple for the thread", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).get(`/${THREAD_ID}/messages`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [] });
  });

  it("404s (and never touches the checkpointer) on a foreign-workspace thread", async () => {
    const deps = makeDeps({ getChatThreadForWorkspace: vi.fn(async () => undefined) });
    const res = await request(buildApp(deps)).get(`/${THREAD_ID}/messages`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "unknown_thread" });
    expect(deps.checkpointer.getTuple).not.toHaveBeenCalled();
  });

  it("400s on a malformed id", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).get("/not-a-uuid/messages");

    expect(res.status).toBe(400);
    expect(deps.getChatThreadForWorkspace).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat-threads/:id/checkpoints", () => {
  it("returns the thread's checkpoints for an owned thread", async () => {
    const rows = [
      { checkpoint_id: "cp-1", created_at: "2026-09-16T00:00:00Z", message_count: 1 },
      { checkpoint_id: "cp-3", created_at: "2026-09-16T00:01:00Z", message_count: 3 },
    ];
    const deps = makeDeps({ listCheckpoints: vi.fn(async () => rows) });
    const res = await request(buildApp(deps)).get(`/${THREAD_ID}/checkpoints`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checkpoints: rows });
    expect(deps.getChatThreadForWorkspace).toHaveBeenCalledWith(THREAD_ID, WORKSPACE_ID);
    expect(deps.listCheckpoints).toHaveBeenCalledWith(THREAD_ID);
  });

  it("404s on a foreign-workspace thread without listing checkpoints", async () => {
    const deps = makeDeps({ getChatThreadForWorkspace: vi.fn(async () => undefined) });
    const res = await request(buildApp(deps)).get(`/${THREAD_ID}/checkpoints`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "unknown_thread" });
    expect(deps.listCheckpoints).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat-threads/:id/regenerate", () => {
  it("regenerates from a checkpoint and returns the new result", async () => {
    const regenerated = { refused: false, answer: "new answer", citations: [] } as any;
    const deps = makeDeps({ regenerate: vi.fn(async () => regenerated) });
    const res = await request(buildApp(deps))
      .post(`/${THREAD_ID}/regenerate`)
      .send({ checkpoint_id: "cp-3" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(regenerated);
    expect(deps.getChatThreadForWorkspace).toHaveBeenCalledWith(THREAD_ID, WORKSPACE_ID);
    expect(deps.regenerate).toHaveBeenCalledWith(THREAD_ID, "cp-3");
  });

  it("400s on a missing checkpoint_id", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).post(`/${THREAD_ID}/regenerate`).send({});

    expect(res.status).toBe(400);
    expect(deps.regenerate).not.toHaveBeenCalled();
  });

  it("404s on a foreign-workspace thread without regenerating", async () => {
    const deps = makeDeps({ getChatThreadForWorkspace: vi.fn(async () => undefined) });
    const res = await request(buildApp(deps))
      .post(`/${THREAD_ID}/regenerate`)
      .send({ checkpoint_id: "cp-3" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "unknown_thread" });
    expect(deps.regenerate).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat-threads/:id/resume", () => {
  function events(from: unknown[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const e of from) yield e;
      },
    };
  }

  it("streams the resumed events over SSE with the decision", async () => {
    const deps = makeDeps({
      resumeChat: vi.fn(() =>
        events([
          { kind: "token", text: "Created " },
          { kind: "result", result: { refused: false, answer: "Created competitor", citations: [] } },
        ])
      ) as any,
    });
    const res = await request(buildApp(deps))
      .post(`/${THREAD_ID}/resume`)
      .send({ decision: "approve" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain("event: token");
    expect(res.text).toContain("event: result");
    expect(res.text).toContain("event: done");
    expect(deps.resumeChat).toHaveBeenCalledWith(THREAD_ID, "approve", expect.any(Object));
  });

  it("streams confirm_required when the resumed turn pauses again", async () => {
    const deps = makeDeps({
      resumeChat: vi.fn(() =>
        events([
          { kind: "confirm_required", mutation: { tool_name: "update_company_goals", description: "Add goal?", arguments: {} } },
        ])
      ) as any,
    });
    const res = await request(buildApp(deps))
      .post(`/${THREAD_ID}/resume`)
      .send({ decision: "approve" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("event: confirm_required");
    expect(res.text).toContain("update_company_goals");
  });

  it("400s on an invalid decision without resuming", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).post(`/${THREAD_ID}/resume`).send({ decision: "maybe" });

    expect(res.status).toBe(400);
    expect(deps.resumeChat).not.toHaveBeenCalled();
  });

  it("404s on a foreign-workspace thread without resuming", async () => {
    const deps = makeDeps({ getChatThreadForWorkspace: vi.fn(async () => undefined) });
    const res = await request(buildApp(deps))
      .post(`/${THREAD_ID}/resume`)
      .send({ decision: "approve" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "unknown_thread" });
    expect(deps.resumeChat).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat-threads/pending-confirmations", () => {
  it("lists threads paused at a confirm gate for the caller's workspace", async () => {
    const deps = makeDeps({
      listPendingConfirmations: vi.fn(async () => [
        { thread_id: THREAD_ID, mutations: [{ tool_name: "create_competitor", description: "Create competitor?", arguments: {} }], created_at: "2026-09-17T00:00:00Z" },
      ]),
    });
    const res = await request(buildApp(deps)).get("/pending-confirmations");

    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(1);
    expect(deps.listPendingConfirmations).toHaveBeenCalledWith(WORKSPACE_ID);
  });
});

describe("DELETE /api/chat-threads/:id", () => {
  it("deletes the metadata row and the checkpointer state, returning 204", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).delete(`/${THREAD_ID}`);

    expect(res.status).toBe(204);
    expect(deps.deleteChatThreadForWorkspace).toHaveBeenCalledWith(THREAD_ID, WORKSPACE_ID);
    expect(deps.checkpointer.deleteThread).toHaveBeenCalledWith(THREAD_ID);
    expect(deps.checkpointer.deleteThread).toHaveBeenCalledTimes(1);
  });

  it("still 204s when the checkpointer delete fails after the row is gone", async () => {
    const deps = makeDeps({
      checkpointer: {
        getTuple: vi.fn(),
        deleteThread: vi.fn(async () => {
          throw new Error("checkpoint deleted");
        }),
      },
    });
    const res = await request(buildApp(deps)).delete(`/${THREAD_ID}`);

    expect(res.status).toBe(204);
    expect(deps.deleteChatThreadForWorkspace).toHaveBeenCalledWith(THREAD_ID, WORKSPACE_ID);
  });

  it("404s on a foreign-workspace thread and does not delete anything", async () => {
    const deps = makeDeps({ getChatThreadForWorkspace: vi.fn(async () => undefined) });
    const res = await request(buildApp(deps)).delete(`/${THREAD_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "unknown_thread" });
    expect(deps.deleteChatThreadForWorkspace).not.toHaveBeenCalled();
    expect(deps.checkpointer.deleteThread).not.toHaveBeenCalled();
  });
});