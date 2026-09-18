import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import type { ChatAgentResult } from "@signal/shared";

vi.mock("@/agents/chat/chat-agent", () => ({ streamChat: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createChatRouter, type ChatRouterDeps } from "@/api/chat";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "99999999-9999-4999-8999-999999999999";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const THREAD_ID = "44444444-4444-4444-8444-444444444444";

const ANSWER: ChatAgentResult = {
  refused: false,
  answer: "They shipped SSO in March.",
  citations: [
    {
      claim: "They shipped SSO in March.",
      chunk_id: "signal-1",
      source: "changelog",
      similarity_score: 0.92,
    },
  ],
};
const REFUSAL: ChatAgentResult = {
  refused: true,
  reason: "No stored signals matched this question.",
  suggested_query: "Ask about a specific competitor or feature.",
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeps(over: Partial<ChatRouterDeps> = {}): ChatRouterDeps {
  return {
    getCompetitorsByIdsForWorkspace: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id }))
    ) as any,
    getChatThreadForWorkspace: vi.fn(async () => ({ id: THREAD_ID })) as any,
    createAgentRun: vi.fn(async () => ({ id: RUN_ID })) as any,
    completeAgentRun: vi.fn(async () => undefined) as any,
    createChatThread: vi.fn(async () => ({ id: THREAD_ID })) as any,
    touchChatThread: vi.fn(async () => undefined) as any,
    streamChat: vi.fn(async function* () {
      yield { kind: "token", text: "They" } as const;
      yield { kind: "token", text: " shipped SSO" } as const;
      yield { kind: "result", result: ANSWER } as const;
    }) as any,
    finalizeRunTimeoutMs: 5_000,
    ...over,
  };
}

// Builds a throwaway app and records every chunk written to the SSE response,
// so assertions don't depend on client-side stream timing. Simulates
// requireAuth by stamping req.workspaceId unless withWorkspace is false.
function buildApp(
  deps: ChatRouterDeps,
  { withWorkspace = true }: { withWorkspace?: boolean } = {}
): { app: express.Express; writes: string[] } {
  const writes: string[] = [];
  const app = express();
  app.use((req, res, next) => {
    if (withWorkspace) (req as any).workspaceId = WORKSPACE_ID;
    const orig = res.write.bind(res);
    (res as any).write = (chunk: any, ...rest: any[]) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return (orig as any)(chunk, ...rest);
    };
    next();
  });
  app.use("/api/chat", createChatRouter(deps));
  return { app, writes };
}

interface CallResult {
  status: number;
  headers: Record<string, string>;
  text: string;
}

async function call(app: express.Express, body: unknown): Promise<CallResult> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text: await res.text(),
    };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const microflush = () => new Promise<void>((r) => setImmediate(r));
// Polls on a real timer (setTimeout is never faked in this suite) so socket-close
// and other network events get wall time to propagate.
async function waitUntil(fn: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise<void>((r) => setTimeout(r, 5));
  }
  throw new Error(`waitUntil timed out: ${label}`);
}

const streamInput = (deps: ChatRouterDeps) => (deps.streamChat as any).mock.calls[0][0];

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("POST /api/chat", () => {
  it("answer path: open, tokens, one result, done in order; run completed; thread touched", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, {
      query: "did they ship SSO?",
      competitor_ids: [C1],
      thread_id: THREAD_ID,
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const tokens = [...res.text.matchAll(/^event: token\ndata: (.+)\n\n/gm)].map(
      (m) => JSON.parse(m[1]).text
    );
    expect(tokens).toEqual(["They", " shipped SSO"]);

    expect([...res.text.matchAll(/^event: result$/gm)]).toHaveLength(1);
    const data = JSON.parse(/event: result\ndata: (.+)\n\n/.exec(res.text)![1]);
    expect(data).toEqual(ANSWER);

    const open = res.text.indexOf(": open");
    const firstToken = res.text.indexOf("event: token");
    const result = res.text.indexOf("event: result");
    const done = res.text.indexOf("event: done");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(open).toBeLessThan(firstToken);
    expect(firstToken).toBeLessThan(result);
    expect(result).toBeLessThan(done);

    expect(deps.createAgentRun).toHaveBeenCalledWith({ competitor_id: C1, trigger: "manual" });
    expect(deps.completeAgentRun).toHaveBeenCalledTimes(1);
    expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
    expect(deps.touchChatThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it("refusal path: zero tokens, delivered as a normal result event, run completed", async () => {
    const deps = makeDeps({
      streamChat: vi.fn(async function* () {
        yield { kind: "result", result: REFUSAL } as const;
      }) as any,
    });
    const res = await call(buildApp(deps).app, {
      query: "anything?",
      competitor_ids: [C1],
      thread_id: THREAD_ID,
    });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("event: error");
    expect(res.text).not.toContain("event: token");
    const data = JSON.parse(/event: result\ndata: (.+)\n\n/.exec(res.text)![1]);
    expect(data).toEqual(REFUSAL);
    expect(res.text).toContain("event: done");
    expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
  });

  it("thread_id omitted: auto-creates a thread with the workspace id and uses it", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, { query: "hi", competitor_ids: [C1] });

    expect(res.status).toBe(200);
    expect(deps.createChatThread).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(streamInput(deps).thread_id).toBe(THREAD_ID);
    expect(deps.touchChatThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it("thread_id provided: does not create a thread, streams with the provided id", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, {
      query: "hi",
      competitor_ids: [C1],
      thread_id: THREAD_ID,
    });

    expect(res.status).toBe(200);
    expect(deps.getChatThreadForWorkspace).toHaveBeenCalledWith(THREAD_ID, WORKSPACE_ID);
    expect(deps.createChatThread).not.toHaveBeenCalled();
    expect(streamInput(deps).thread_id).toBe(THREAD_ID);
    expect(deps.touchChatThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it("supplied thread_id from another workspace: 404 unknown_thread, no run, no SSE", async () => {
    const deps = makeDeps({
      getChatThreadForWorkspace: vi.fn(async () => undefined) as any,
    });
    const res = await call(buildApp(deps).app, {
      query: "hi",
      competitor_ids: [C1],
      thread_id: THREAD_ID,
    });

    expect(res.status).toBe(404);
    expect(JSON.parse(res.text).error).toBe("unknown_thread");
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(deps.getChatThreadForWorkspace).toHaveBeenCalledWith(THREAD_ID, WORKSPACE_ID);
    expect(deps.createAgentRun).not.toHaveBeenCalled();
    expect(deps.createChatThread).not.toHaveBeenCalled();
    expect(deps.touchChatThread).not.toHaveBeenCalled();
  });

  it("invalid thread_id: 400 before any run or thread is created", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, {
      query: "hi",
      competitor_ids: [C1],
      thread_id: "not-a-uuid",
    });

    expect(res.status).toBe(400);
    expect(deps.createAgentRun).not.toHaveBeenCalled();
    expect(deps.createChatThread).not.toHaveBeenCalled();
  });

  it("validation fail: JSON 400 before any SSE header, no run created", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, { query: "   ", competitor_ids: [C1] });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(JSON.parse(res.text).error).toBe("validation");
    expect(deps.getCompetitorsByIdsForWorkspace).not.toHaveBeenCalled();
    expect(deps.createAgentRun).not.toHaveBeenCalled();
  });

  it("rejects unknown body keys with 400", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, {
      query: "hi",
      competitor_ids: [C1],
      surprise: true,
    });
    expect(res.status).toBe(400);
    expect(deps.createAgentRun).not.toHaveBeenCalled();
  });

  it("unknown competitor: 404 unknown_competitor listing the missing id, no run created", async () => {
    const deps = makeDeps({
      getCompetitorsByIdsForWorkspace: vi.fn(async () => [{ id: C1 }]) as any,
    });
    const res = await call(buildApp(deps).app, { query: "hi", competitor_ids: [C1, C2] });

    expect(res.status).toBe(404);
    const body = JSON.parse(res.text);
    expect(body.error).toBe("unknown_competitor");
    expect(body.missing).toEqual([C2]);
    expect(deps.createAgentRun).not.toHaveBeenCalled();
    expect(deps.createChatThread).not.toHaveBeenCalled();
  });

  it("competitor from another workspace: same unknown_competitor 404 as a nonexistent id", async () => {
    // C2 exists, but belongs to a different workspace — getCompetitorsByIdsForWorkspace
    // (scoped by req.workspaceId) simply won't return it, indistinguishable from
    // C2 not existing at all.
    const deps = makeDeps({
      getCompetitorsByIdsForWorkspace: vi.fn(async (ids: string[], workspaceId: string) =>
        ids.filter((id) => id === C1).map((id) => ({ id }))
      ) as any,
    });
    const res = await call(buildApp(deps).app, { query: "hi", competitor_ids: [C1, C2] });

    expect(res.status).toBe(404);
    const body = JSON.parse(res.text);
    expect(body.error).toBe("unknown_competitor");
    expect(body.missing).toEqual([C2]);
    expect(deps.getCompetitorsByIdsForWorkspace).toHaveBeenCalledWith(
      expect.arrayContaining([C1, C2]),
      WORKSPACE_ID
    );
    expect(deps.createAgentRun).not.toHaveBeenCalled();
  });

  it("no workspace on request: 403 no_workspace, no lookup attempted", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps, { withWorkspace: false }).app, {
      query: "hi",
      competitor_ids: [C1],
    });

    expect(res.status).toBe(403);
    expect(JSON.parse(res.text).error).toBe("no_workspace");
    expect(deps.getCompetitorsByIdsForWorkspace).not.toHaveBeenCalled();
    expect(deps.createAgentRun).not.toHaveBeenCalled();
  });

  it("emits a confirm_required frame when the turn pauses at a mutation gate", async () => {
    const deps = makeDeps({
      streamChat: vi.fn(async function* () {
        yield {
          kind: "confirm_required",
          mutation: { tool_name: "create_competitor", description: "Create competitor Acme?", arguments: { name: "Acme", domain: "acme.com" } },
        } as const;
      }) as any,
    });
    const res = await call(buildApp(deps).app, { query: "add Acme", competitor_ids: [C1] });

    expect(res.status).toBe(200);
    expect(res.text).toContain("event: confirm_required");
    expect(res.text).toContain("create_competitor");
    expect(res.text).not.toContain("event: result");
    expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
  });

  it("operational failure: run failed + generic error event with the message redacted", async () => {
    const deps = makeDeps({
      streamChat: vi.fn(async function* () {
        throw new Error("pinecone exploded: SUPERSECRET connection string");
      }) as any,
    });
    const res = await call(buildApp(deps).app, { query: "hi", competitor_ids: [C1] });

    expect(res.status).toBe(200);
    expect(res.text).toContain("event: error");
    expect(res.text).toContain('data: {"error":"chat_failed"}');
    expect(res.text).not.toContain("SUPERSECRET");
    expect(res.text).not.toContain("pinecone exploded");
    expect(res.text).not.toContain("event: result");
    expect(deps.completeAgentRun).toHaveBeenCalledTimes(1);
    expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "failed");
  });

  it("client disconnect mid-run: aborts the agent, finalizes the run once, writes no result", async () => {
    const runGate = deferred<void>();
    let received: AbortSignal | undefined;
    const deps = makeDeps({
      streamChat: vi.fn(async function* (_input: any, opts: any) {
        received = opts?.signal;
        await runGate.promise;
        yield { kind: "result", result: ANSWER } as const;
      }) as any,
    });
    const { app, writes } = buildApp(deps);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      // Raw http so we can hard-kill the socket — undici pools connections and
      // an aborted fetch doesn't reliably reach the server as a close.
      const req = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/chat",
        headers: { "content-type": "application/json" },
      });
      req.on("error", () => {});
      req.end(JSON.stringify({ query: "hi", competitor_ids: [C1] }));

      await waitUntil(() => received !== undefined, "agent invoked");
      req.socket?.destroy(); // client hangs up while streamChat is still pending

      await waitUntil(() => received?.aborted === true, "agent signal aborted");

      // agent resolves only after the client is already gone
      runGate.resolve();
      await waitUntil(() => (deps.completeAgentRun as any).mock.calls.length > 0, "run finalized");

      expect(deps.completeAgentRun).toHaveBeenCalledTimes(1);
      expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
      expect(writes.join("")).not.toContain("event: result");
      await microflush();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("heartbeat: writes ': ping' while streaming and clears the interval on end", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const runGate = deferred<void>();
    const deps = makeDeps({
      streamChat: vi.fn(async function* () {
        await runGate.promise;
        yield { kind: "result", result: ANSWER } as const;
      }) as any,
    });
    const { app, writes } = buildApp(deps);
    const server = app.listen(0);
    const controller = new AbortController();
    try {
      const { port } = server.address() as AddressInfo;
      const done = fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "hi", competitor_ids: [C1] }),
        signal: controller.signal,
      }).catch(() => undefined);

      await waitUntil(() => writes.join("").includes(": open"), "SSE opened");
      expect(writes.join("")).not.toContain(": ping");

      const pings = () => writes.filter((w) => w === ": ping\n\n").length;
      vi.advanceTimersByTime(15_000);
      expect(pings()).toBe(1);
      vi.advanceTimersByTime(15_000);
      expect(pings()).toBe(2);

      runGate.resolve();
      await waitUntil(() => writes.join("").includes("event: done"), "result delivered");

      const afterDone = pings();
      vi.advanceTimersByTime(60_000); // interval must be cleared — no further pings
      expect(pings()).toBe(afterDone);

      controller.abort();
      await done;
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("closes the stream after the finalization deadline when the database never settles", async () => {
    const deps = makeDeps({
      completeAgentRun: vi.fn(() => new Promise<void>(() => undefined)) as any,
      finalizeRunTimeoutMs: 10,
    });

    const res = await call(buildApp(deps).app, {
      query: "hi",
      competitor_ids: [C1],
    });

    expect(res.text).toContain("event: result");
    expect(res.text).toContain("event: done");
    expect(deps.completeAgentRun).toHaveBeenCalledOnce();
  });

  it("accepts multipart attachments and forwards them on streamChat.turn without creating a company document", async () => {
    const deps = makeDeps();
    const { app } = buildApp(deps);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const form = new FormData();
      form.set("query", "summarize this");
      form.set("competitor_ids", JSON.stringify([C1]));
      form.set("thread_id", THREAD_ID);
      form.append(
        "attachments",
        new Blob(["Q3 goal: expand SMB"], { type: "text/plain" }),
        "notes.txt"
      );
      const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        body: form,
      });
      expect(res.status).toBe(200);
      const turn = streamInput(deps).turn;
      expect(turn.documents).toEqual([{ filename: "notes.txt", text: "Q3 goal: expand SMB" }]);
      expect(turn.images).toEqual([]);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rejects SVG attachments with JSON 400 before SSE opens", async () => {
    const deps = makeDeps();
    const { app } = buildApp(deps);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const form = new FormData();
      form.set("query", "look at this");
      form.set("competitor_ids", JSON.stringify([C1]));
      form.append(
        "attachments",
        new Blob(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], { type: "image/svg+xml" }),
        "evil.svg"
      );
      const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        body: form,
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(JSON.parse(await res.text()).message).toMatch(/SVG/i);
      expect(deps.streamChat).not.toHaveBeenCalled();
      expect(deps.createAgentRun).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});