// Cross-process bridge for ServerToClientEvents (packages/shared/src/socket-events.ts).
// The SocketIOServer only exists in the Express process (apps/api/src/api/index.ts), but the
// events it must emit originate in the standalone worker process (queues/registry.ts,
// agents/analysis/synthesis.ts, pipeline/deduplicator.ts) — a separate Node process with no
// direct reference to `io`. Both processes already share Redis, so a lightweight pub/sub
// channel carries the event across the process boundary: any process calls
// publishSocketEvent(...), and the Express process's wireSocketRelay(io) is the one
// subscriber that turns each message into a real io.emit(...).
import type { ServerToClientEvents } from "@signal/shared";
import { cacheRedis } from "./redis-client";
import { logger } from "./logger";

const SOCKET_EVENTS_CHANNEL = "signal:socket-events";

interface RelayMessage<E extends keyof ServerToClientEvents> {
  event: E;
  payload: Parameters<ServerToClientEvents[E]>[0];
}

// Fire-and-forget by design, same as every other cacheRedis write in this codebase — a
// dropped live-update push is a UI staleness issue, never a correctness issue (every payload
// here is also readable over REST). Logged, not thrown, so a Redis blip can't fail the
// discovery/synthesis/dedup job that's just trying to notify the frontend.
export async function publishSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  payload: Parameters<ServerToClientEvents[E]>[0]
): Promise<void> {
  try {
    const message: RelayMessage<E> = { event, payload };
    await cacheRedis.publish(SOCKET_EVENTS_CHANNEL, JSON.stringify(message));
  } catch (error) {
    logger.error("Failed to publish socket event", {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface EmittableSocketServer {
  emit(event: string, ...args: unknown[]): unknown;
}

// Called once from the Express process (createApiRuntime). Returns a close() so shutdown can
// tear the dedicated subscriber connection down alongside the rest of Redis.
export function wireSocketRelay(io: EmittableSocketServer): { close: () => Promise<void> } {
  // ioredis: a connection in subscribe mode can't run other commands, so this needs its own
  // connection rather than reusing cacheRedis — same pattern as checkRedisReadiness's probe.
  const subscriber = cacheRedis.duplicate();
  subscriber.on("error", (err) => logger.error("Socket relay subscriber error", { error: err }));
  subscriber.on("message", (channel, raw) => {
    if (channel !== SOCKET_EVENTS_CHANNEL) return;
    try {
      const { event, payload } = JSON.parse(raw) as RelayMessage<keyof ServerToClientEvents>;
      io.emit(event, payload);
    } catch (error) {
      logger.error("Failed to relay socket event", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  void subscriber.subscribe(SOCKET_EVENTS_CHANNEL).catch((error) => {
    logger.error("Failed to subscribe to socket events channel", { error });
  });

  return {
    close: async () => {
      await subscriber.quit().catch(() => subscriber.disconnect());
    },
  };
}
