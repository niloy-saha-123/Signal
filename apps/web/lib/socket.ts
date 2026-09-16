// Socket.io client singleton. Connects to the same NEXT_PUBLIC_API_URL host lib/api.ts
// uses — the API's Socket.io server shares the Express app's HTTP server and port
// (apps/api/src/api/index.ts).
import { io, type Socket } from "socket.io-client";
import type {
  AlertCreatedPayload,
  ClientToServerEvents,
  DiscoveryStatusChangedPayload,
  ServerToClientEvents,
  SignalCreatedPayload,
} from "@signal/shared";
import { getSupabaseBrowserClient } from "./supabase-browser";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ClientSocket | undefined;
// Caches the in-flight connection attempt so two getSocket() calls made back-to-back
// (e.g. AlertBanner and SignalFeed mounting in the same tick) await the same io() call
// instead of each racing to open its own — `socket` alone can't do this since it's only
// assigned once the session lookup + io() have both resolved.
let socketPromise: Promise<ClientSocket> | undefined;

// Room membership lives on the server-side connection, not the client. Socket.IO's default
// reconnection (on by default, effectively infinite attempts) re-establishes the transport
// after a Wi-Fi drop or an API deploy, but the *new* server-side connection starts in zero
// rooms — the old one's membership is gone (socket.io's own disconnect cleanup leaves every
// room). Track what this tab wants joined and re-request it on every "connect", including the
// first one, so a dropped connection doesn't silently stop delivering room-scoped events.
const joinedCompetitorIds = new Set<string>();

async function connectSocket(): Promise<ClientSocket> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sock: ClientSocket = io(API_BASE, { auth: { token: session?.access_token } });
  sock.on("connect", () => {
    for (const id of joinedCompetitorIds) sock.emit("competitor:join", id);
  });
  return sock;
}

export function getSocket(): Promise<ClientSocket> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("getSocket() must only be called in the browser"));
  }
  if (socket) return Promise.resolve(socket);
  if (!socketPromise) {
    socketPromise = connectSocket()
      .then((sock) => {
        socket = sock;
        return sock;
      })
      .catch((err) => {
        // ponytail: allow a retry on the next call instead of caching a dead connection
        // forever — a transient getSession()/io() failure shouldn't brick sockets for the
        // rest of the tab's life.
        socketPromise = undefined;
        throw err;
      });
  }
  return socketPromise;
}

// getSocket() is now async, but a useEffect cleanup function must be synchronous — every
// on* subscriber below attaches its handler once the socket resolves and returns a
// synchronous unsubscribe immediately. `cancelled` covers the case where the component
// unmounts (cleanup runs) before that resolution lands: without it, the handler would
// attach after the caller already considers itself torn down, with nothing left to call
// `.off()` on it since `attachedSocket` wouldn't be set yet when cleanup ran.
// (A shared generic helper here fights socket.io-client's per-event listener typing —
// TS can't correlate a generic event-name parameter with its handler type across `.on`/
// `.off` — so the three subscribers are written out rather than abstracted.)

export function onDiscoveryStatusChanged(
  handler: (payload: DiscoveryStatusChangedPayload) => void
): () => void {
  let cancelled = false;
  let attachedSocket: ClientSocket | undefined;
  getSocket()
    .then((sock) => {
      if (cancelled) return;
      attachedSocket = sock;
      sock.on("discovery:status_changed", handler);
    })
    .catch(() => {
      // getSocket() only rejects for the SSR guard or a connection failure; either way
      // there's nothing to subscribe to, and the cleanup fn below is a no-op.
    });
  return () => {
    cancelled = true;
    attachedSocket?.off("discovery:status_changed", handler);
  };
}

export function onAlertCreated(handler: (payload: AlertCreatedPayload) => void): () => void {
  let cancelled = false;
  let attachedSocket: ClientSocket | undefined;
  getSocket()
    .then((sock) => {
      if (cancelled) return;
      attachedSocket = sock;
      sock.on("alert:created", handler);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    attachedSocket?.off("alert:created", handler);
  };
}

export function onSignalCreated(handler: (payload: SignalCreatedPayload) => void): () => void {
  let cancelled = false;
  let attachedSocket: ClientSocket | undefined;
  getSocket()
    .then((sock) => {
      if (cancelled) return;
      attachedSocket = sock;
      sock.on("signal:new", handler);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    attachedSocket?.off("signal:new", handler);
  };
}

export async function joinCompetitor(id: string): Promise<void> {
  joinedCompetitorIds.add(id);
  const sock = await getSocket();
  sock.emit("competitor:join", id);
}

export async function leaveCompetitor(id: string): Promise<void> {
  joinedCompetitorIds.delete(id);
  const sock = await getSocket();
  sock.emit("competitor:leave", id);
}

// Test-only escape hatch — clears the module singleton between test cases so each test
// gets a fresh mock connection. Real app code never calls this.
export function __resetSocketForTests(): void {
  socket?.disconnect();
  socket = undefined;
  socketPromise = undefined;
  joinedCompetitorIds.clear();
}
