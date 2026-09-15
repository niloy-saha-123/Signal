// Socket.io client singleton. Connects to the same NEXT_PUBLIC_API_URL host lib/api.ts
// uses — the API's Socket.io server shares the Express app's HTTP server and port
// (apps/api/src/api/index.ts).
//
// Deliberately no competitor-room join here: apps/api/src/api/index.ts constructs a
// SocketIOServer but never calls `.on("connection", ...)`, `.join()`, or `.emit()` anywhere
// in the codebase. Neither event in ServerToClientEvents has a producer yet — a client-side
// join emit would have no listener and do nothing. See
// .claude/loop/frontend/00-overview.md's Discovered Gaps before adding one.
import { io, type Socket } from "socket.io-client";
import type {
  AlertCreatedPayload,
  DiscoveryStatusChangedPayload,
  ServerToClientEvents,
} from "@signal/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type ClientSocket = Socket<ServerToClientEvents>;

let socket: ClientSocket | undefined;

export function getSocket(): ClientSocket {
  if (typeof window === "undefined") {
    throw new Error("getSocket() must only be called in the browser");
  }
  if (!socket) {
    socket = io(API_BASE);
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

// Test-only escape hatch — clears the module singleton between test cases so each test
// gets a fresh mock connection. Real app code never calls this.
export function __resetSocketForTests(): void {
  socket?.disconnect();
  socket = undefined;
}
