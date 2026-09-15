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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ClientSocket | undefined;

// Room membership lives on the server-side connection, not the client. Socket.IO's default
// reconnection (on by default, effectively infinite attempts) re-establishes the transport
// after a Wi-Fi drop or an API deploy, but the *new* server-side connection starts in zero
// rooms — the old one's membership is gone (socket.io's own disconnect cleanup leaves every
// room). Track what this tab wants joined and re-request it on every "connect", including the
// first one, so a dropped connection doesn't silently stop delivering room-scoped events.
const joinedCompetitorIds = new Set<string>();

export function getSocket(): ClientSocket {
  if (typeof window === "undefined") {
    throw new Error("getSocket() must only be called in the browser");
  }
  if (!socket) {
    socket = io(API_BASE);
    socket.on("connect", () => {
      for (const id of joinedCompetitorIds) socket?.emit("competitor:join", id);
    });
  }
  return socket;
}

export function onDiscoveryStatusChanged(
  handler: (payload: DiscoveryStatusChangedPayload) => void
): () => void {
  const activeSocket = getSocket();
  activeSocket.on("discovery:status_changed", handler);
  return () => activeSocket.off("discovery:status_changed", handler);
}

export function onAlertCreated(handler: (payload: AlertCreatedPayload) => void): () => void {
  const activeSocket = getSocket();
  activeSocket.on("alert:created", handler);
  return () => activeSocket.off("alert:created", handler);
}

export function onSignalCreated(handler: (payload: SignalCreatedPayload) => void): () => void {
  const activeSocket = getSocket();
  activeSocket.on("signal:new", handler);
  return () => activeSocket.off("signal:new", handler);
}

export function joinCompetitor(id: string): void {
  joinedCompetitorIds.add(id);
  getSocket().emit("competitor:join", id);
}

export function leaveCompetitor(id: string): void {
  joinedCompetitorIds.delete(id);
  getSocket().emit("competitor:leave", id);
}

// Test-only escape hatch — clears the module singleton between test cases so each test
// gets a fresh mock connection. Real app code never calls this.
export function __resetSocketForTests(): void {
  socket?.disconnect();
  socket = undefined;
  joinedCompetitorIds.clear();
}
