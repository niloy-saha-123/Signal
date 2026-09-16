import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const mockSockets: MockSocket[] = [];

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const socket: MockSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() };
    mockSockets.push(socket);
    return socket;
  }),
}));

vi.mock("../../lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: getSessionMock },
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

// Waits for every already-queued microtask (getSocket()'s internal getSession()/io()
// promise chain included) to flush before assertions run.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("lib/socket", () => {
  beforeEach(() => {
    mockSockets.length = 0;
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3000");
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    __resetSocketForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    __resetSocketForTests();
  });

  it("rejects when called outside the browser", async () => {
    vi.stubGlobal("window", undefined);
    await expect(getSocket()).rejects.toThrow(/browser/);
  });

  it("creates one socket.io-client connection to NEXT_PUBLIC_API_URL with the session token", async () => {
    const socket = await getSocket();
    expect(io).toHaveBeenCalledWith("http://localhost:3000", { auth: { token: "token-123" } });
    expect(socket).toBe(mockSockets[0]);
  });

  it("connects with an undefined token when there is no session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await getSocket();
    expect(io).toHaveBeenCalledWith("http://localhost:3000", { auth: { token: undefined } });
  });

  it("returns the same socket instance on repeated calls (singleton)", async () => {
    const first = await getSocket();
    const second = await getSocket();
    expect(second).toBe(first);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it("does not open a second connection when getSocket() is called twice before the first resolves", async () => {
    const firstPromise = getSocket();
    const secondPromise = getSocket();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBe(second);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it("retries the connection on the next call after a failed getSession()/io() attempt", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("network down"));
    await expect(getSocket()).rejects.toThrow("network down");
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    const socket = await getSocket();
    expect(socket).toBe(mockSockets[0]);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it("__resetSocketForTests disconnects and clears the singleton", async () => {
    const first = await getSocket();
    __resetSocketForTests();
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    const second = await getSocket();
    expect(second).not.toBe(first);
    expect(io).toHaveBeenCalledTimes(2);
  });

  it("onDiscoveryStatusChanged registers and unsubscribes a handler once the socket resolves", async () => {
    const handler = vi.fn();
    const unsubscribe = onDiscoveryStatusChanged(handler);
    await flushMicrotasks();
    const socket = mockSockets[0];
    expect(socket.on).toHaveBeenCalledWith("discovery:status_changed", handler);
    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith("discovery:status_changed", handler);
  });

  it("onAlertCreated registers and unsubscribes a handler once the socket resolves", async () => {
    const handler = vi.fn();
    const unsubscribe = onAlertCreated(handler);
    await flushMicrotasks();
    const socket = mockSockets[0];
    expect(socket.on).toHaveBeenCalledWith("alert:created", handler);
    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith("alert:created", handler);
  });

  it("onSignalCreated registers and unsubscribes a handler once the socket resolves", async () => {
    const handler = vi.fn();
    const unsubscribe = onSignalCreated(handler);
    await flushMicrotasks();
    const socket = mockSockets[0];
    expect(socket.on).toHaveBeenCalledWith("signal:new", handler);
    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith("signal:new", handler);
  });

  it("unsubscribing before getSocket() resolves prevents the handler from ever being attached", async () => {
    const handler = vi.fn();
    const unsubscribe = onAlertCreated(handler);
    unsubscribe(); // cleanup runs before the getSession()/io() promise chain settles
    await flushMicrotasks();
    // No socket in mockSockets ever had .on("alert:created", handler) called on it —
    // the cancelled flag suppressed the attach entirely once the promise resolved.
    for (const socket of mockSockets) {
      expect(socket.on).not.toHaveBeenCalledWith("alert:created", handler);
    }
  });

  it("joinCompetitor emits a competitor:join event with the id", async () => {
    await joinCompetitor("comp-1");
    expect(mockSockets[0].emit).toHaveBeenCalledWith("competitor:join", "comp-1");
  });

  it("leaveCompetitor emits a competitor:leave event with the id", async () => {
    await leaveCompetitor("comp-1");
    expect(mockSockets[0].emit).toHaveBeenCalledWith("competitor:leave", "comp-1");
  });

  it("re-joins every currently-joined competitor on connect (reconnect after a drop)", async () => {
    await joinCompetitor("comp-1");
    await joinCompetitor("comp-2");
    const socket = mockSockets[0];
    const connectHandler = socket.on.mock.calls.find(([event]) => event === "connect")?.[1];
    expect(connectHandler).toBeDefined();

    socket.emit.mockClear();
    connectHandler!();

    expect(socket.emit).toHaveBeenCalledWith("competitor:join", "comp-1");
    expect(socket.emit).toHaveBeenCalledWith("competitor:join", "comp-2");
  });

  it("does not re-join a competitor after leaveCompetitor removed it", async () => {
    await joinCompetitor("comp-1");
    await leaveCompetitor("comp-1");
    const socket = mockSockets[0];
    const connectHandler = socket.on.mock.calls.find(([event]) => event === "connect")?.[1];

    socket.emit.mockClear();
    connectHandler!();

    expect(socket.emit).not.toHaveBeenCalledWith("competitor:join", "comp-1");
  });

  it("__resetSocketForTests clears joined-competitor tracking too", async () => {
    await joinCompetitor("comp-1");
    __resetSocketForTests();
    await getSocket();
    const socket = mockSockets[1];
    const connectHandler = socket.on.mock.calls.find(([event]) => event === "connect")?.[1];

    connectHandler!();

    expect(socket.emit).not.toHaveBeenCalledWith("competitor:join", "comp-1");
  });
});
