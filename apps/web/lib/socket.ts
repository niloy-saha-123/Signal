// Socket.io client singleton with typed events for scoped real-time competitor alert delivery.
"use client";

import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@signal/shared";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000");
  }
  return socket;
}

export function joinCompetitorRoom(competitorId: string): void {
  getSocket().emit("join_competitor", competitorId);
}
