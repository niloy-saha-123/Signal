import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const mockSockets: MockSocket[] = [];

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const socket: MockSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() };
    mockSockets.push(socket);
    return socket;
  }),
}));

import { io } from "socket.io-client";
import {
  __resetSocketForTests,
  getSocket,
  joinCompetitor,
  leaveCompetitor,
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

  it("joinCompetitor emits a competitor:join event with the id", () => {
    joinCompetitor("comp-1");
    expect(mockSockets[0].emit).toHaveBeenCalledWith("competitor:join", "comp-1");
  });

  it("leaveCompetitor emits a competitor:leave event with the id", () => {
    leaveCompetitor("comp-1");
    expect(mockSockets[0].emit).toHaveBeenCalledWith("competitor:leave", "comp-1");
  });

  it("re-joins every currently-joined competitor on connect (reconnect after a drop)", () => {
    joinCompetitor("comp-1");
    joinCompetitor("comp-2");
    const socket = mockSockets[0];
    const connectHandler = socket.on.mock.calls.find(([event]) => event === "connect")?.[1];
    expect(connectHandler).toBeDefined();

    socket.emit.mockClear();
    connectHandler!();

    expect(socket.emit).toHaveBeenCalledWith("competitor:join", "comp-1");
    expect(socket.emit).toHaveBeenCalledWith("competitor:join", "comp-2");
  });

  it("does not re-join a competitor after leaveCompetitor removed it", () => {
    joinCompetitor("comp-1");
    leaveCompetitor("comp-1");
    const socket = mockSockets[0];
    const connectHandler = socket.on.mock.calls.find(([event]) => event === "connect")?.[1];

    socket.emit.mockClear();
    connectHandler!();

    expect(socket.emit).not.toHaveBeenCalledWith("competitor:join", "comp-1");
  });

  it("__resetSocketForTests clears joined-competitor tracking too", () => {
    joinCompetitor("comp-1");
    __resetSocketForTests();
    getSocket();
    const socket = mockSockets[1];
    const connectHandler = socket.on.mock.calls.find(([event]) => event === "connect")?.[1];

    connectHandler!();

    expect(socket.emit).not.toHaveBeenCalledWith("competitor:join", "comp-1");
  });
});
