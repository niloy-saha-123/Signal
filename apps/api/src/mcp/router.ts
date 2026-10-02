// POST /mcp — stateless Streamable HTTP MCP endpoint. Each request gets a fresh
// server and transport: no sessions to store or expire, and the workspace comes
// from the token on that request alone.
import express, { Router, type RequestHandler } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { cacheRedis } from "../lib/redis-client";
import { logger } from "../lib/logger";
import { requireApiToken, defaultApiTokenAuthDeps, type ApiTokenAuthDeps } from "./auth";
import { hitFixedWindow } from "./rate-limit";
import {
  createMcpToolHandlers,
  defaultMcpToolDeps,
  McpToolError,
  registerMcpTools,
  type McpContext,
  type McpToolDeps,
} from "./tools";

export const MCP_REQUESTS_PER_MINUTE = 60;
export const ASK_SIGNAL_PER_HOUR = 20;
// Tokens are cheap to mint, so the workspace has its own ask budget on top of
// each token's.
export const ASK_SIGNAL_PER_WORKSPACE_PER_HOUR = 40;
export const ASK_SIGNAL_IN_FLIGHT_PER_WORKSPACE = 2;

type RateLimiter = (key: string, limit: number, windowSeconds: number) => ReturnType<typeof hitFixedWindow>;

export interface McpRouterDeps {
  auth: ApiTokenAuthDeps;
  tools: Omit<McpToolDeps, "beginAsk">;
  rateLimit: RateLimiter;
  version: string;
}

export const defaultMcpRouterDeps: McpRouterDeps = {
  auth: defaultApiTokenAuthDeps,
  tools: defaultMcpToolDeps,
  rateLimit: (key, limit, windowSeconds) => hitFixedWindow(cacheRedis, key, limit, windowSeconds),
  version: "1.0.0",
};

const methodNotAllowed: RequestHandler = (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createMcpRouter(deps: McpRouterDeps = defaultMcpRouterDeps): Router {
  const router = express.Router();
  router.get("/", methodNotAllowed);
  router.delete("/", methodNotAllowed);
  router.use(requireApiToken(deps.auth));

  // One JSON-RPC message per request. A batch would let one HTTP request carry
  // up to 100 tool calls past the per-request limit below.
  router.use((req, res, next) => {
    if (Array.isArray(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Batch requests are not supported." },
        id: null,
      });
      return;
    }
    next();
  });

  // Fails open: a Redis outage should not take MCP reads down with it. The
  // expensive path (ask_signal) has its own limits that fail closed.
  router.use((req, res, next) => {
    deps
      .rateLimit(`mcp:rl:req:${req.apiTokenId}`, MCP_REQUESTS_PER_MINUTE, 60)
      .then(({ allowed, retryAfterSeconds }) => {
        if (allowed) return next();
        logger.info("mcp: request rate limited", { token_id: req.apiTokenId, workspace_id: req.workspaceId });
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.status(429).json({ error: "rate_limited" });
      })
      .catch((error) => {
        logger.warn("mcp: request rate limit unavailable, allowing", { error: errorMessage(error) });
        next();
      });
  });

  // ponytail: in-process in-flight count, so the cap is per API instance; move it
  // to Redis if the API runs more than one replica.
  const inFlight = new Map<string, number>();

  const beginAsk = async (ctx: McpContext) => {
    const current = inFlight.get(ctx.workspaceId) ?? 0;
    if (current >= ASK_SIGNAL_IN_FLIGHT_PER_WORKSPACE) {
      throw new McpToolError("Signal is already answering questions for this workspace. Try again in a moment.");
    }
    let results: Awaited<ReturnType<RateLimiter>>[];
    try {
      results = await Promise.all([
        deps.rateLimit(`mcp:rl:ask:${ctx.tokenId}`, ASK_SIGNAL_PER_HOUR, 3600),
        deps.rateLimit(`mcp:rl:ask:ws:${ctx.workspaceId}`, ASK_SIGNAL_PER_WORKSPACE_PER_HOUR, 3600),
      ]);
    } catch (error) {
      logger.warn("mcp: ask_signal rate limit unavailable, refusing", { error: errorMessage(error) });
      throw new McpToolError("ask_signal is temporarily unavailable. Try again shortly.");
    }
    if (!results.every((r) => r.allowed)) {
      throw new McpToolError(
        `ask_signal is limited to ${ASK_SIGNAL_PER_HOUR} questions per hour per token and ` +
          `${ASK_SIGNAL_PER_WORKSPACE_PER_HOUR} per workspace.`
      );
    }
    // Re-read after the await: another call may have taken a slot meanwhile.
    const now = inFlight.get(ctx.workspaceId) ?? 0;
    if (now >= ASK_SIGNAL_IN_FLIGHT_PER_WORKSPACE) {
      throw new McpToolError("Signal is already answering questions for this workspace. Try again in a moment.");
    }
    inFlight.set(ctx.workspaceId, now + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (inFlight.get(ctx.workspaceId) ?? 1) - 1;
      if (left <= 0) inFlight.delete(ctx.workspaceId);
      else inFlight.set(ctx.workspaceId, left);
    };
  };
  const handlers = createMcpToolHandlers({ ...deps.tools, beginAsk });

  router.post("/", async (req, res) => {
    const abort = new AbortController();
    const server = new McpServer({ name: "signal", version: deps.version });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      abort.abort();
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    try {
      registerMcpTools(
        server,
        { workspaceId: req.workspaceId!, tokenId: req.apiTokenId!, signal: abort.signal },
        handlers
      );
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("mcp: request failed", {
        workspace_id: req.workspaceId,
        token_id: req.apiTokenId,
        error: errorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
      }
    }
  });

  return router;
}
