import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const mockSockets: MockSocket[] = [];

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const socket: MockSocket = { on: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
    mockSockets.push(socket);
    return socket;
  }),
}));

import { io } from "socket.io-client";
import {
  __resetSocketForTests,
  getSocket,
  onAlertCreated,
  onDiscoveryStatusChanged,
  onSignalCreated,
} from "../../lib/socket";

describe("lib/socket", () => {
  beforeEach(() => {
    mockSockets.length = 0;
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3000");
    __resetSocketForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    __resetSocketForTests();
  });

  it("throws when called outside the browser", () => {
    vi.stubGlobal("window", undefined);
    expect(() => getSocket()).toThrow(/browser/);
  });

  it("creates one socket.io-client connection to NEXT_PUBLIC_API_URL", () => {
    const socket = getSocket();
    expect(io).toHaveBeenCalledWith("http://localhost:3000");
    expect(socket).toBe(mockSockets[0]);
  });

  it("returns the same socket instance on repeated calls (singleton)", () => {
    const first = getSocket();
    const second = getSocket();
    expect(second).toBe(first);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it("__resetSocketForTests disconnects and clears the singleton", () => {
    const first = getSocket();
    __resetSocketForTests();
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    const second = getSocket();
    expect(second).not.toBe(first);
    expect(io).toHaveBeenCalledTimes(2);
  });

  it("onDiscoveryStatusChanged registers and unsubscribes a handler", () => {
    const handler = vi.fn();
    const unsubscribe = onDiscoveryStatusChanged(handler);
    const socket = mockSockets[0];
    expect(socket.on).toHaveBeenCalledWith("discovery:status_changed", handler);
    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith("discovery:status_changed", handler);
  });

  it("onAlertCreated registers and unsubscribes a handler", () => {
    const handler = vi.fn();
    const unsubscribe = onAlertCreated(handler);
    const socket = mockSockets[0];
    expect(socket.on).toHaveBeenCalledWith("alert:created", handler);
    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith("alert:created", handler);
  });

  it("onSignalCreated registers and unsubscribes a handler", () => {
    const handler = vi.fn();
    const unsubscribe = onSignalCreated(handler);
    const socket = mockSockets[0];
    expect(socket.on).toHaveBeenCalledWith("signal:new", handler);
    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith("signal:new", handler);
  });
});
