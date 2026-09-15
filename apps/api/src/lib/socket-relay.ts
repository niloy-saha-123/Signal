// Cross-process bridge for ServerToClientEvents (packages/shared/src/socket-events.ts).
// The SocketIOServer only exists in the Express process (apps/api/src/api/index.ts), but the
// events it must emit originate in the standalone worker process (queues/registry.ts,
// agents/analysis/synthesis.ts, pipeline/deduplicator.ts) — a separate Node process with no
// direct reference to `io`. Both processes already share Redis, so a lightweight pub/sub
// channel carries the event across the process boundary: any process calls
// publishSocketEvent(...), and the Express process's wireSocketRelay(io) is the one
// subscriber that turns each message into a real io.emit(...) (or io.to(room).emit(...) for
// the room-scoped events below). wireSocketRelay also owns the connection-time
// competitor:join/leave listeners, since it's the one place with a reference to `io`.
import { z } from "zod";
import type { ClientToServerEvents, ServerToClientEvents } from "@signal/shared";
import { cacheRedis, redis } from "./redis-client";
import { logger } from "./logger";

const SOCKET_EVENTS_CHANNEL = "signal:socket-events";

interface RelayMessage<E extends keyof ServerToClientEvents> {
  event: E;
  payload: Parameters<ServerToClientEvents[E]>[0];
}

// signal:new and discovery:status_changed are room-scoped to their competitor — SignalFeed
// (the only client that ever joins a room) filters by competitor_id already, so routing
// server-side is a straight fan-out reduction, not a behavior change. alert:created stays a
// global io.emit(...): AlertBanner has no competitor-scoping prop by design (it surfaces
// alerts for anything, anywhere), so there is nothing to scope it to.
const ROOM_SCOPED_EVENTS: Partial<Record<keyof ServerToClientEvents, true>> = {
  "signal:new": true,
  "discovery:status_changed": true,
};

function competitorRoom(id: string): string {
  return `competitor:${id}`;
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

// Event names/payloads are checked against ServerToClientEvents — a typo or payload-shape
// drift here is a compile error, the same guarantee apps/web/lib/socket.ts's typed client
// already has, rather than only being caught (or not) at runtime.
type EmitArgs<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>;

export interface EmittableSocketServer {
  emit<E extends keyof ServerToClientEvents>(event: E, ...args: EmitArgs<E>): unknown;
  to(room: string): { emit<E extends keyof ServerToClientEvents>(event: E, ...args: EmitArgs<E>): unknown };
  on(event: "connection", listener: (socket: RelaySocket) => void): unknown;
}

// The slice of a socket.io `Socket` the relay needs for room membership — kept minimal
// (rather than importing socket.io's own `Socket` type) so this file's dependency on the
// real library stays confined to what it actually uses. `on`'s event/listener pair is still
// checked against ClientToServerEvents, same reasoning as EmittableSocketServer above — the
// listener parameter being typed `string` doesn't make it trustworthy at runtime (a client can
// send anything), so joinOrLeaveCompetitorRoom below still validates with zod regardless.
export interface RelaySocket {
  join(room: string): unknown;
  leave(room: string): unknown;
  on<E extends keyof ClientToServerEvents>(event: E, listener: ClientToServerEvents[E]): unknown;
}

const competitorIdSchema = z.string().uuid();

// Competitor ids arrive over a public socket from the browser — untrusted input, same trust
// boundary as any REST body/param. A malformed id is silently ignored (not thrown) so a bad
// client can't do anything worse than fail to join a room.
function joinOrLeaveCompetitorRoom(socket: RelaySocket, action: "join" | "leave", id: unknown): void {
  const parsed = competitorIdSchema.safeParse(id);
  if (!parsed.success) {
    logger.warn("Ignored malformed competitor room request", { action, id });
    return;
  }
  socket[action](competitorRoom(parsed.data));
}

// Called once from the Express process (createApiRuntime). Returns a close() so shutdown can
// tear the dedicated subscriber connection down alongside the rest of Redis.
export function wireSocketRelay(io: EmittableSocketServer): { close: () => Promise<void> } {
  io.on("connection", (socket) => {
    socket.on("competitor:join", (id) => joinOrLeaveCompetitorRoom(socket, "join", id));
    socket.on("competitor:leave", (id) => joinOrLeaveCompetitorRoom(socket, "leave", id));
  });
  // ioredis: a connection in subscribe mode can't run other commands, so this needs its own
  // connection rather than reusing an existing client. Duplicates `redis` (BullMQ's
  // maxRetriesPerRequest: null connection), not `cacheRedis` — this is a long-lived connection
  // that just sits subscribed, the same shape as BullMQ's own blocking connections, not a
  // bounded fail-fast cache op. cacheRedis's 2s connectTimeout/commandTimeout is tuned for
  // quick local cache reads and was cutting off the initial SUBSCRIBE handshake against a
  // remote TLS Redis (Upstash) before it could complete.
  const subscriber = redis.duplicate();
  subscriber.on("error", (err) =>
    logger.error("Socket relay subscriber error", {
      error: err instanceof Error ? err.message : String(err),
    })
  );
  subscriber.on("message", (channel, raw) => {
    if (channel !== SOCKET_EVENTS_CHANNEL) return;
    try {
      const { event, payload } = JSON.parse(raw) as RelayMessage<keyof ServerToClientEvents>;
      if (ROOM_SCOPED_EVENTS[event]) {
        // No cast: RelayMessage's payload type already includes competitor_id for every
        // room-scoped event. Still runtime-validated — the JSON.parse above is itself an
        // unchecked cast, and the producer is a separate worker process that can be on
        // different code during a rolling deploy (schema drift), so the declared type here is
        // a compile-time promise, not a runtime guarantee.
        const parsedId = competitorIdSchema.safeParse(payload.competitor_id);
        if (!parsedId.success) {
          logger.error("Dropped room-scoped socket event with invalid competitor_id", { event });
          return;
        }
        // `as never`: after destructuring RelayMessage<keyof ServerToClientEvents>, TS can no
        // longer correlate the now-widened `event` union with `payload`'s matching member —
        // a known limitation of generic emit signatures paired with a runtime-only union, not
        // an actual type hole (RelayMessage's own definition guarantees the two are paired
        // correctly by construction; EmittableSocketServer.emit's generic signature still
        // fully checks every *other* caller, e.g. anywhere a literal event name is emitted).
        io.to(competitorRoom(parsedId.data)).emit(event, payload as never);
      } else {
        io.emit(event, payload as never);
      }
    } catch (error) {
      logger.error("Failed to relay socket event", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  void subscriber.subscribe(SOCKET_EVENTS_CHANNEL).catch((error) => {
    logger.error("Failed to subscribe to socket events channel", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    close: async () => {
      await subscriber.quit().catch(() => subscriber.disconnect());
    },
  };
}
