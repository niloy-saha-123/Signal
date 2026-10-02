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
  type McpToolDeps,
} from "./tools";

export const MCP_REQUESTS_PER_MINUTE = 60;
export const ASK_SIGNAL_PER_HOUR = 20;

type RateLimiter = (key: string, limit: number, windowSeconds: number) => ReturnType<typeof hitFixedWindow>;

export interface McpRouterDeps {
  auth: ApiTokenAuthDeps;
  tools: Omit<McpToolDeps, "checkAskLimit">;
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

export function createMcpRouter(deps: McpRouterDeps = defaultMcpRouterDeps): Router {
  const router = express.Router();
  router.get("/", methodNotAllowed);
  router.delete("/", methodNotAllowed);
  router.use(requireApiToken(deps.auth));

  // Fails open: a Redis outage should not take MCP reads down with it. The
  // expensive path (ask_signal) has its own limit that fails closed.
  router.use((req, res, next) => {
    deps
      .rateLimit(`mcp:rl:req:${req.apiTokenId}`, MCP_REQUESTS_PER_MINUTE, 60)
      .then(({ allowed, retryAfterSeconds }) => {
        if (allowed) return next();
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.status(429).json({ error: "rate_limited" });
      })
      .catch((error) => {
        logger.warn("mcp: request rate limit unavailable, allowing", {
          error: error instanceof Error ? error.message : String(error),
        });
        next();
      });
  });

  const checkAskLimit = async (tokenId: string) => {
    let allowed: boolean;
    try {
      ({ allowed } = await deps.rateLimit(`mcp:rl:ask:${tokenId}`, ASK_SIGNAL_PER_HOUR, 3600));
    } catch (error) {
      logger.warn("mcp: ask_signal rate limit unavailable, refusing", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new McpToolError("ask_signal is temporarily unavailable. Try again shortly.");
    }
    if (!allowed) {
      throw new McpToolError(`ask_signal is limited to ${ASK_SIGNAL_PER_HOUR} questions per hour per token.`);
    }
  };
  const handlers = createMcpToolHandlers({ ...deps.tools, checkAskLimit });

  router.post("/", async (req, res) => {
    const server = new McpServer({ name: "signal", version: deps.version });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      registerMcpTools(server, { workspaceId: req.workspaceId!, tokenId: req.apiTokenId! }, handlers);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("mcp: request failed", { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
      }
    }
  });

  return router;
}
