// apps/web/lib/chat-stream.ts
// SSE parsing + streaming POST for /api/chat. Native EventSource only supports GET, and this
// route is POST — hence a hand-rolled fetch()+ReadableStream reader. Route contract (see
// apps/api/src/api/chat.ts's own header comment): ": open"/": ping" comments (ignored),
// zero-or-more "event: token" frames (`data: {"text": "..."}` — a live draft), exactly one
// "event: result" carrying a ChatAgentResult (a refusal is a normal, successful result, never
// an error) that may correct the just-streamed draft, then "event: done". "event: error" means
// an operational failure — show a generic message, never the raw payload (mirrors the route's
// own "never leak internals" rule).
import type { ChatAgentResult } from "@signal/shared";
import { authHeader } from "./api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const GENERIC_ERROR_MESSAGE = "Signal couldn't answer that. Please try again.";

export interface ParsedSseEvent {
  event: string;
  data: string;
}

export interface StreamChatOptions {
  threadId?: string;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}

export function parseSseEvent(raw: string): ParsedSseEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) {
      event = line.slice("event: ".length);
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice("data: ".length));
    }
  }
  return event ? { event, data: dataLines.join("\n") } : null;
}

export async function streamChatResult(
  query: string,
  competitorIds: string[],
  onResult: (result: ChatAgentResult) => void,
  onError: (message: string) => void,
  options: StreamChatOptions = {}
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({
        query,
        competitor_ids: competitorIds,
        ...(options.threadId ? { thread_id: options.threadId } : {}),
      }),
      signal: options.signal,
    });
  } catch {
    onError(GENERIC_ERROR_MESSAGE);
    return;
  }

  if (!response.ok || !response.body) {
    onError(GENERIC_ERROR_MESSAGE);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseEvent(rawEvent);
        if (parsed) {
          if (parsed.event === "token") {
            const { text } = JSON.parse(parsed.data) as { text: string };
            options.onToken?.(text);
          } else if (parsed.event === "result") {
            onResult(JSON.parse(parsed.data) as ChatAgentResult);
          } else if (parsed.event === "error") {
            onError(GENERIC_ERROR_MESSAGE);
          } else if (parsed.event === "done") {
            return;
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch {
    onError(GENERIC_ERROR_MESSAGE);
  } finally {
    reader.releaseLock();
  }
}
