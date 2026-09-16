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