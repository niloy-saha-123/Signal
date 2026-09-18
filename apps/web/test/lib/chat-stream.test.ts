// apps/web/test/lib/chat-stream.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitationResult, RefusalResult } from "@signal/shared";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock("../../lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: getSessionMock },
  }),
}));

import { parseSseEvent, streamChatResult } from "../../lib/chat-stream";

describe("parseSseEvent", () => {
  it("parses an event block into event name and data", () => {
    expect(parseSseEvent('event: result\ndata: {"a":1}')).toEqual({
      event: "result",
      data: '{"a":1}',
    });
  });

  it("joins multiple data lines with a newline, per the SSE spec", () => {
    expect(parseSseEvent("event: result\ndata: line1\ndata: line2")).toEqual({
      event: "result",
      data: "line1\nline2",
    });
  });

  it("returns null for a comment-only block with no event line", () => {
    expect(parseSseEvent(": open")).toBeNull();
    expect(parseSseEvent(": ping")).toBeNull();
  });
});

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const citationResult: CitationResult = {
  refused: false,
  answer: "Acme cut Pro tier pricing 20% last week.",
  citations: [
    { claim: "Pro tier now $79/mo", chunk_id: "chunk-1", source: "pricing", similarity_score: 0.9 },
  ],
};

const refusalResult: RefusalResult = {
  refused: true,
  reason: "No grounded evidence for that claim.",
  suggested_query: "What pricing changes has Acme made this month?",
};

describe("streamChatResult", () => {
  const BASE = "http://localhost:3000";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", BASE);
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("POSTs to /api/chat with the query and competitor_ids", async () => {
    const body = streamOf(": open\n\n", "event: done\ndata: {}\n\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    );
    const onResult = vi.fn();
    const onError = vi.fn();
    await streamChatResult("What changed?", ["comp-1"], onResult, onError);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/chat`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "What changed?", competitor_ids: ["comp-1"] }),
      })
    );
  });

  it("accumulates onToken across token frames, then settles with onResult", async () => {
    const body = streamOf(
      ": open\n\n",
      'event: token\ndata: {"text":"Acme "}\n\n',
      'event: token\ndata: {"text":"cut pricing"}\n\n',
      `event: result\ndata: ${JSON.stringify(citationResult)}\n\n`,
      "event: done\ndata: {}\n\n"
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const onResult = vi.fn();
    const onToken = vi.fn();
    await streamChatResult("q", ["comp-1"], onResult, vi.fn(), { onToken });
    expect(onToken.mock.calls.map((c) => c[0])).toEqual(["Acme ", "cut pricing"]);
    expect(onResult).toHaveBeenCalledWith(citationResult);
  });

  it("includes thread_id in the body only when a threadId option is supplied", async () => {
    const body = streamOf("event: done\ndata: {}\n\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await streamChatResult("q", ["comp-1"], vi.fn(), vi.fn(), {
      threadId: "33333333-3333-3333-3333-333333333333",
    });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/chat`,
      expect.objectContaining({
        body: JSON.stringify({
          query: "q",
          competitor_ids: ["comp-1"],
          thread_id: "33333333-3333-3333-3333-333333333333",
        }),
      })
    );
  });

  it("calls onResult with the parsed CitationResult and never onError", async () => {
    const body = streamOf(
      ": open\n\n",
      `event: result\ndata: ${JSON.stringify(citationResult)}\n\n`,
      "event: done\ndata: {}\n\n"
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const onResult = vi.fn();
    const onError = vi.fn();
    await streamChatResult("q", ["comp-1"], onResult, onError);
    expect(onResult).toHaveBeenCalledWith(citationResult);
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onResult with a RefusalResult unchanged — a refusal is not an error", async () => {
    const body = streamOf(`event: result\ndata: ${JSON.stringify(refusalResult)}\n\n`, "event: done\ndata: {}\n\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const onResult = vi.fn();
    const onError = vi.fn();
    await streamChatResult("q", ["comp-1"], onResult, onError);
    expect(onResult).toHaveBeenCalledWith(refusalResult);
    expect(onError).not.toHaveBeenCalled();
  });

  it("correctly reassembles an event split across multiple stream chunks", async () => {
    const fullEvent = `event: result\ndata: ${JSON.stringify(citationResult)}\n\n`;
    const splitPoint = Math.floor(fullEvent.length / 2);
    const body = streamOf(
      fullEvent.slice(0, splitPoint),
      fullEvent.slice(splitPoint),
      "event: done\ndata: {}\n\n"
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const onResult = vi.fn();
    const onError = vi.fn();
    await streamChatResult("q", ["comp-1"], onResult, onError);
    expect(onResult).toHaveBeenCalledWith(citationResult);
  });

  it("calls onError with a generic message on an event: error, not the raw payload", async () => {
    const body = streamOf('event: error\ndata: {"error":"chat_failed"}\n\n');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const onResult = vi.fn();
    const onError = vi.fn();
    await streamChatResult("q", ["comp-1"], onResult, onError);
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const [message] = onError.mock.calls[0];
    expect(message).not.toContain("chat_failed");
  });

  it("calls onError when the fetch itself rejects (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const onResult = vi.fn();
    const onError = vi.fn();
    await streamChatResult("q", ["comp-1"], onResult, onError);
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("calls onError on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    );
    const onResult = vi.fn();
    const onError = vi.fn();
    await streamChatResult("q", ["comp-1"], onResult, onError);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("routes a mid-stream reader rejection to onError and does not throw", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: token\ndata: {"text":"partial"}\n\n'));
        controller.error(new Error("connection reset"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const onResult = vi.fn();
    const onError = vi.fn();
    await expect(
      streamChatResult("q", ["comp-1"], onResult, onError)
    ).resolves.toBeUndefined();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const [message] = onError.mock.calls[0];
    expect(message).not.toContain("connection reset");
  });

  it("POSTs multipart FormData when attachments are supplied", async () => {
    const body = streamOf(": open\n\n", "event: done\ndata: {}\n\n");
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await streamChatResult("What changed?", ["comp-1"], vi.fn(), vi.fn(), {
      threadId: "thread-1",
      attachments: [file],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/chat`,
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("query")).toBe("What changed?");
    expect(form.get("competitor_ids")).toBe(JSON.stringify(["comp-1"]));
    expect(form.get("thread_id")).toBe("thread-1");
    expect(form.get("attachments")).toBeInstanceOf(File);
  });
});
