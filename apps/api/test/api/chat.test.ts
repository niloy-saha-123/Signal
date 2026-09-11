import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import type { ChatAgentResult } from "@signal/shared";

vi.mock("@/agents/chat/chat-agent", () => ({ runChatAgent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createChatRouter, type ChatRouterDeps } from "@/api/chat";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "99999999-9999-4999-8999-999999999999";

const ANSWER: ChatAgentResult = { refused: false, answer: "They shipped SSO in March.", citations: [] };
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
    getCompetitorsByIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))) as any,
    createAgentRun: vi.fn(async () => ({ id: RUN_ID })) as any,
    completeAgentRun: vi.fn(async () => undefined) as any,
    runChatAgent: vi.fn(async () => ANSWER) as any,
    ...over,
  };
}

// Builds a throwaway app and records every chunk written to the SSE response,
// so assertions don't depend on client-side stream timing.
function buildApp(deps: ChatRouterDeps): { app: express.Express; writes: string[] } {
  const writes: string[] = [];
  const app = express();
  app.use((_req, res, next) => {
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

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("POST /api/chat", () => {
  it("answer path: one result event with the validated result, then done, run completed", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, { query: "did they ship SSO?", competitor_ids: [C1] });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    expect([...res.text.matchAll(/^event: result$/gm)]).toHaveLength(1);
    const data = JSON.parse(/event: result\ndata: (.+)\n\n/.exec(res.text)![1]);
    expect(data).toEqual(ANSWER);
    expect(res.text.indexOf("event: result")).toBeLessThan(res.text.indexOf("event: done"));

    expect(deps.createAgentRun).toHaveBeenCalledWith({ competitor_id: C1, trigger: "manual" });
    expect(deps.completeAgentRun).toHaveBeenCalledTimes(1);
    expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
  });

  it("refusal path: delivered as a normal result event (not error, not non-200), run completed", async () => {
    const deps = makeDeps({ runChatAgent: vi.fn(async () => REFUSAL) as any });
    const res = await call(buildApp(deps).app, { query: "anything?", competitor_ids: [C1] });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("event: error");
    const data = JSON.parse(/event: result\ndata: (.+)\n\n/.exec(res.text)![1]);
    expect(data).toEqual(REFUSAL);
    expect(res.text).toContain("event: done");
    expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
  });

  it("validation fail: JSON 400 before any SSE header, no run created", async () => {
    const deps = makeDeps();
    const res = await call(buildApp(deps).app, { query: "   ", competitor_ids: [C1] });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(JSON.parse(res.text).error).toBe("validation");
    expect(deps.getCompetitorsByIds).not.toHaveBeenCalled();
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
      getCompetitorsByIds: vi.fn(async () => [{ id: C1 }]) as any,
    });
    const res = await call(buildApp(deps).app, { query: "hi", competitor_ids: [C1, C2] });

    expect(res.status).toBe(404);
    const body = JSON.parse(res.text);
    expect(body.error).toBe("unknown_competitor");
    expect(body.missing).toEqual([C2]);
    expect(deps.createAgentRun).not.toHaveBeenCalled();
  });

  it("operational failure: run failed + generic error event with the message redacted", async () => {
    const deps = makeDeps({
      runChatAgent: vi.fn(async () => {
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
    const runGate = deferred<ChatAgentResult>();
    let received: AbortSignal | undefined;
    const deps = makeDeps({
      runChatAgent: vi.fn(async (_input: any, opts: any) => {
        received = opts?.signal;
        return runGate.promise;
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

      await waitUntil(() => (deps.runChatAgent as any).mock.calls.length > 0, "agent invoked");
      req.socket?.destroy(); // client hangs up while runChatAgent is still pending

      await waitUntil(() => received?.aborted === true, "agent signal aborted");

      // agent resolves only after the client is already gone
      runGate.resolve(ANSWER);
      await waitUntil(() => (deps.completeAgentRun as any).mock.calls.length > 0, "run finalized");

      expect(deps.completeAgentRun).toHaveBeenCalledTimes(1);
      expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
      expect(writes.join("")).not.toContain("event: result");
      await microflush();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("heartbeat: writes ': ping' while runChatAgent is pending and clears the interval on end", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const runGate = deferred<ChatAgentResult>();
    const deps = makeDeps({ runChatAgent: vi.fn(async () => runGate.promise) as any });
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

      runGate.resolve(ANSWER);
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
});
