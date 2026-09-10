import http, { type Server as HttpServer } from "node:http";
import express, { type ErrorRequestHandler, type Express } from "express";
import { Server as SocketIOServer } from "socket.io";
import { createCompetitorRouter } from "./competitors";
import { createSignalRouter } from "./signals";
import { createAlertRouter } from "./alerts";
import { createChatRouter } from "./chat";
import { createCompanyProfileRouter } from "./company-profile";
import { queues } from "../queues/registry";
import { closeRedisConnections } from "../lib/redis-client";
import { closeDatabase } from "../db/client";
import { logger } from "../lib/logger";

const JSON_BODY_LIMIT = "100kb";
const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ApiEnvironment {
  DATABASE_URL?: string;
  REDIS_URL?: string;
  PORT?: string;
}

export function validateApiEnvironment(env: ApiEnvironment = process.env): { port: number } {
  const missing = ["DATABASE_URL", "REDIS_URL"].filter(
    (key) => !env[key as keyof ApiEnvironment]?.trim()
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return { port };
}

export const apiErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  logger.error("Unhandled API error", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  if (res.headersSent) return;
  const httpError = error as { type?: string; status?: number };
  if (httpError.type === "entity.too.large" || httpError.status === 413) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }
  if (httpError.type === "entity.parse.failed" || (error instanceof SyntaxError && httpError.status === 400)) {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  res.status(500).json({ error: "internal" });
};

export function createApiApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
  app.use("/api/competitors", createCompetitorRouter());
  app.use("/api/signals", createSignalRouter());
  app.use("/api/alerts", createAlertRouter());
  app.use("/api/chat", createChatRouter());
  app.use("/api/company-profile", createCompanyProfileRouter());
  app.use(apiErrorHandler);
  return app;
}

interface ClosableSocketServer {
  close(callback?: () => void): unknown;
}

export interface ApiRuntimeOverrides {
  app?: Express;
  server?: HttpServer;
  io?: ClosableSocketServer;
  closeQueues?: () => Promise<void>;
  closeRedis?: () => Promise<void>;
  closeDatabase?: () => Promise<void>;
}

async function closeSocketServer(io: ClosableSocketServer): Promise<void> {
  await new Promise<void>((resolve) => io.close(() => resolve()));
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    const forceHandle = setTimeout(() => {
      server.closeAllConnections?.();
    }, SHUTDOWN_TIMEOUT_MS);
    forceHandle.unref();
    server.close((error) => {
      clearTimeout(forceHandle);
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createApiRuntime(overrides: ApiRuntimeOverrides = {}) {
  const app = overrides.app ?? createApiApp();
  const server = overrides.server ?? http.createServer(app);
  const io = overrides.io ?? new SocketIOServer(server, { serveClient: false });
  const closeQueues =
    overrides.closeQueues ??
    (() => Promise.allSettled(Object.values(queues).map((queue) => queue.close())).then(() => undefined));
  const closeRedis = overrides.closeRedis ?? closeRedisConnections;
  const closeDb = overrides.closeDatabase ?? closeDatabase;
  let closePromise: Promise<void> | undefined;

  return {
    app,
    server,
    io,
    async start(port: number): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(port, () => {
          server.removeListener("error", onError);
          logger.info("Signal API listening", { port });
          resolve();
        });
      });
    },
    close(): Promise<void> {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const failures: unknown[] = [];
        for (const operation of [
          () => closeSocketServer(io),
          () => closeHttpServer(server),
          closeQueues,
          closeRedis,
          closeDb,
        ]) {
          try {
            await operation();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, "API resource shutdown failed");
        }
      })();
      return closePromise;
    },
  };
}

export async function startApiFromEnvironment(env: ApiEnvironment = process.env) {
  const runtime = createApiRuntime();
  try {
    const { port } = validateApiEnvironment(env);
    await runtime.start(port);
  } catch (error) {
    await runtime.close().catch((shutdownError) => {
      logger.error("API cleanup after startup failure failed", { error: shutdownError });
    });
    throw error;
  }

  const shutdown = () => {
    void runtime.close().catch((error) => {
      logger.error("API shutdown failed", { error });
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return runtime;
}

if (require.main === module) {
  void startApiFromEnvironment().catch(async (error) => {
    logger.error("API startup failed", { error });
    process.exitCode = 1;
  });
}
