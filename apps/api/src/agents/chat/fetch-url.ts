// fetch_url — the chat agent's single outbound-URL choke point. Policy:
// public http(s) pages only, video hosts refused, content-type allowlisted,
// HTML stripped to text, 1 MB / 10s cap, every redirect hop re-validated.
import { withCircuitBreaker } from "../../reliability/circuit-breaker";
import { assertPublicUrl, safeFetch } from "../../lib/safe-fetch";
import { extractHtmlText } from "../../lib/html-text";
import { consumeChatInputBudget } from "./input-budget";

export const FETCH_URL_MAX_BYTES = 1_000_000;
export const FETCH_URL_TIMEOUT_MS = 10_000;

const VIDEO_HOST_SUFFIXES = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "vimeo.com",
  "loom.com",
  "tiktok.com",
  "dailymotion.com",
  "twitch.tv",
  "streamable.com",
  "wistia.com",
  "wistia.net",
  "brightcove.com",
  "netflix.com",
];

const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/xml",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
]);

export type FetchUrlErrorCode = "ssrf" | "video" | "content_type" | "budget" | "http";

export class FetchUrlError extends Error {
  constructor(
    message: string,
    readonly code: FetchUrlErrorCode
  ) {
    super(message);
    this.name = "FetchUrlError";
  }
}

export function isVideoHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  return VIDEO_HOST_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export async function assertFetchableUrl(url: string): Promise<void> {
  try {
    await assertPublicUrl(url);
  } catch (err) {
    throw new FetchUrlError(err instanceof Error ? err.message : String(err), "ssrf");
  }
  if (isVideoHost(new URL(url).hostname)) {
    throw new FetchUrlError("video hosts cannot be fetched", "video");
  }
}

function toText(contentType: string, body: string): string {
  if (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === ""
  ) {
    return extractHtmlText(body);
  }
  return body;
}

export async function fetchUrlPage(url: string, workspaceId: string): Promise<string> {
  await assertFetchableUrl(url);
  try {
    await consumeChatInputBudget("fetch_url", workspaceId);
  } catch (err) {
    throw new FetchUrlError(err instanceof Error ? err.message : String(err), "budget");
  }

  const res = await withCircuitBreaker("chat:fetch_url", () =>
    safeFetch(url, {
      signal: AbortSignal.timeout(FETCH_URL_TIMEOUT_MS),
      maxBytes: FETCH_URL_MAX_BYTES,
      assertHop: assertFetchableUrl,
    })
  );

  if (res.status < 200 || res.status >= 300) {
    throw new FetchUrlError(`fetch_url received HTTP ${res.status}`, "http");
  }

  const type = mediaType(res.headers.get("content-type"));
  if (type.startsWith("video/")) {
    throw new FetchUrlError("video hosts cannot be fetched", "video");
  }
  if (!ALLOWED_CONTENT_TYPES.has(type)) {
    throw new FetchUrlError(`disallowed content-type: ${type || "(missing)"}`, "content_type");
  }

  return toText(type, await res.text());
}
