import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertCreatedPayload, SignalCreatedPayload } from "@signal/shared";

const { cacheRedisMock, subscriberMock, duplicateMock, loggerMock, getCompetitorByIdForWorkspaceMock } =
  vi.hoisted(() => {
    const subscriberMock = {
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };
    return {
      cacheRedisMock: { publish: vi.fn().mockResolvedValue(undefined) },
      subscriberMock,
      duplicateMock: vi.fn(() => subscriberMock),
      loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getCompetitorByIdForWorkspaceMock: vi.fn(),
    };
  });

vi.mock("@/lib/redis-client", () => ({
  redis: { duplicate: duplicateMock },
  cacheRedis: cacheRedisMock,
}));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/db/queries", () => ({ getCompetitorByIdForWorkspace: getCompetitorByIdForWorkspaceMock }));

import {
  joinOrLeaveCompetitorRoom,
  publishSocketEvent,
  wireSocketRelay,
  type EmittableSocketServer,
  type RelaySocket,
} from "@/lib/socket-relay";

function createFakeIo() {
  const toEmit = vi.fn();
  return {
    emit: vi.fn(),
    to: vi.fn(() => ({ emit: toEmit })),
    on: vi.fn(),
    toEmit,
  };
}

function getMessageHandler() {
  const call = subscriberMock.on.mock.calls.find(([event]) => event === "message");
  if (!call) throw new Error("no message handler registered");
  return call[1] as (channel: string, raw: string) => void;
}

function getConnectionHandler(io: ReturnType<typeof createFakeIo>) {
  const call = io.on.mock.calls.find(([event]) => event === "connection");
  if (!call) throw new Error("no connection handler registered");
  return call[1] as (socket: {
    on: ReturnType<typeof vi.fn>;
    join: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
    workspaceId: string;
  }) => void;
}

describe("publishSocketEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishes an event+payload to the socket events channel", async () => {
    const payload: SignalCreatedPayload = { id: "sig-1", competitor_id: "comp-1", source: "hn" };
    await publishSocketEvent("signal:new", payload);
    expect(cacheRedisMock.publish).toHaveBeenCalledWith(
      "signal:socket-events",
      JSON.stringify({ event: "signal:new", payload })
    );
  });

  it("logs and swallows a publish failure instead of throwing", async () => {
    cacheRedisMock.publish.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      publishSocketEvent("signal:new", { id: "sig-1", competitor_id: "comp-1", source: "hn" })
    ).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalled();
  });
});

describe("wireSocketRelay", () => {
  beforeEach(() => vi.clearAllMocks());

  const COMPETITOR_ID_1 = "11111111-1111-1111-1111-111111111111";
  const COMPETITOR_ID_2 = "22222222-2222-2222-2222-222222222222";

  it("routes signal:new to the payload's competitor room", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const payload: SignalCreatedPayload = { id: "sig-1", competitor_id: COMPETITOR_ID_1, source: "hn" };
    getMessageHandler()("signal:socket-events", JSON.stringify({ event: "signal:new", payload }));
    expect(io.to).toHaveBeenCalledWith(`competitor:${COMPETITOR_ID_1}`);
    expect(io.toEmit).toHaveBeenCalledWith("signal:new", payload);
    expect(io.emit).not.toHaveBeenCalled();
  });

  it("routes discovery:status_changed to the payload's competitor room", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const payload = { competitor_id: COMPETITOR_ID_2, discovery_status: "completed" as const };
    getMessageHandler()(
      "signal:socket-events",
      JSON.stringify({ event: "discovery:status_changed", payload })
    );
    expect(io.to).toHaveBeenCalledWith(`competitor:${COMPETITOR_ID_2}`);
    expect(io.toEmit).toHaveBeenCalledWith("discovery:status_changed", payload);
  });

  it("drops a room-scoped event with a malformed competitor_id and logs it, instead of routing to 'competitor:undefined'", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const payload = { id: "sig-1", competitor_id: "not-a-uuid", source: "hn" };
    getMessageHandler()("signal:socket-events", JSON.stringify({ event: "signal:new", payload }));
    expect(io.to).not.toHaveBeenCalled();
    expect(io.emit).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Dropped room-scoped socket event with invalid competitor_id",
      { event: "signal:new" }
    );
  });

  it("broadcasts alert:created globally, not to a room", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const payload: AlertCreatedPayload = {
      id: "alert-1",
      competitor_id: "comp-1",
      pattern: "pricing_cut",
      confidence: 0.9,
    };
    getMessageHandler()("signal:socket-events", JSON.stringify({ event: "alert:created", payload }));
    expect(io.emit).toHaveBeenCalledWith("alert:created", payload);
    expect(io.to).not.toHaveBeenCalled();
  });

  it("ignores messages on other channels", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    getMessageHandler()("some-other-channel", JSON.stringify({ event: "alert:created", payload: {} }));
    expect(io.emit).not.toHaveBeenCalled();
  });

  it("logs and swallows a malformed relay message instead of throwing", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    expect(() => getMessageHandler()("signal:socket-events", "not json")).not.toThrow();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("joins a socket to a competitor room on a valid competitor:join within its own workspace", async () => {
    getCompetitorByIdForWorkspaceMock.mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      workspace_id: "ws-1",
    });
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const socket = { on: vi.fn(), join: vi.fn(), leave: vi.fn(), workspaceId: "ws-1" };
    getConnectionHandler(io)(socket);
    const joinHandler = socket.on.mock.calls.find(([event]) => event === "competitor:join")![1];
    joinHandler("11111111-1111-1111-1111-111111111111");
    await vi.waitFor(() => expect(socket.join).toHaveBeenCalled());
    expect(socket.join).toHaveBeenCalledWith("competitor:11111111-1111-1111-1111-111111111111");
    expect(getCompetitorByIdForWorkspaceMock).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "ws-1"
    );
  });

  it("rejects a competitor:join for a competitor outside the socket's workspace", async () => {
    getCompetitorByIdForWorkspaceMock.mockResolvedValue(undefined);
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const socket = { on: vi.fn(), join: vi.fn(), leave: vi.fn(), workspaceId: "ws-2" };
    getConnectionHandler(io)(socket);
    const joinHandler = socket.on.mock.calls.find(([event]) => event === "competitor:join")![1];
    joinHandler("11111111-1111-1111-1111-111111111111");
    await vi.waitFor(() => expect(getCompetitorByIdForWorkspaceMock).toHaveBeenCalled());
    expect(socket.join).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith("Rejected competitor:join outside caller's workspace", {
      competitorId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("leaves a socket's competitor room on a valid competitor:leave without a workspace check", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const socket = { on: vi.fn(), join: vi.fn(), leave: vi.fn(), workspaceId: "ws-1" };
    getConnectionHandler(io)(socket);
    const leaveHandler = socket.on.mock.calls.find(([event]) => event === "competitor:leave")![1];
    leaveHandler("11111111-1111-1111-1111-111111111111");
    expect(socket.leave).toHaveBeenCalledWith("competitor:11111111-1111-1111-1111-111111111111");
    expect(getCompetitorByIdForWorkspaceMock).not.toHaveBeenCalled();
  });

  it("ignores a non-string competitor:join payload", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const socket = { on: vi.fn(), join: vi.fn(), leave: vi.fn(), workspaceId: "ws-1" };
    getConnectionHandler(io)(socket);
    const joinHandler = socket.on.mock.calls.find(([event]) => event === "competitor:join")![1];
    joinHandler({ malicious: "payload" });
    joinHandler(12345);
    joinHandler(null);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it("ignores a malformed (non-uuid) competitor:join id", () => {
    const io = createFakeIo();
    wireSocketRelay(io as unknown as EmittableSocketServer);
    const socket = { on: vi.fn(), join: vi.fn(), leave: vi.fn(), workspaceId: "ws-1" };
    getConnectionHandler(io)(socket);
    const joinHandler = socket.on.mock.calls.find(([event]) => event === "competitor:join")![1];
    joinHandler("not-a-uuid");
    joinHandler("");
    expect(socket.join).not.toHaveBeenCalled();
  });

  it("returns a close() that quits the subscriber connection", async () => {
    const io = createFakeIo();
    const relay = wireSocketRelay(io as unknown as EmittableSocketServer);
    await relay.close();
    expect(subscriberMock.quit).toHaveBeenCalledTimes(1);
  });
});

describe("joinOrLeaveCompetitorRoom", () => {
  beforeEach(() => vi.clearAllMocks());

  const COMPETITOR_UUID = "11111111-1111-1111-1111-111111111111";

  it("only joins when the competitor belongs to the socket's workspace", async () => {
    const getCompetitorByIdForWorkspace = vi.fn(async (id: string, wsId: string) =>
      wsId === "ws-1" ? { id, workspace_id: "ws-1" } : undefined
    );
    const socket = { join: vi.fn(), leave: vi.fn(), on: vi.fn(), workspaceId: "ws-2" } as unknown as RelaySocket;
    await joinOrLeaveCompetitorRoom(socket, "join", COMPETITOR_UUID, {
      getCompetitorByIdForWorkspace: getCompetitorByIdForWorkspace as never,
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it("joins when the competitor does belong to the socket's workspace", async () => {
    const getCompetitorByIdForWorkspace = vi.fn(async (id: string, wsId: string) =>
      wsId === "ws-1" ? { id, workspace_id: "ws-1" } : undefined
    );
    const socket = { join: vi.fn(), leave: vi.fn(), on: vi.fn(), workspaceId: "ws-1" } as unknown as RelaySocket;
    await joinOrLeaveCompetitorRoom(socket, "join", COMPETITOR_UUID, {
      getCompetitorByIdForWorkspace: getCompetitorByIdForWorkspace as never,
    });
    expect(socket.join).toHaveBeenCalledWith(`competitor:${COMPETITOR_UUID}`);
  });

  it("leaves without consulting the workspace check", async () => {
    const getCompetitorByIdForWorkspace = vi.fn();
    const socket = { join: vi.fn(), leave: vi.fn(), on: vi.fn(), workspaceId: "ws-1" } as unknown as RelaySocket;
    await joinOrLeaveCompetitorRoom(socket, "leave", COMPETITOR_UUID, { getCompetitorByIdForWorkspace });
    expect(socket.leave).toHaveBeenCalledWith(`competitor:${COMPETITOR_UUID}`);
    expect(getCompetitorByIdForWorkspace).not.toHaveBeenCalled();
  });

  it("ignores a malformed id without calling the workspace check", async () => {
    const getCompetitorByIdForWorkspace = vi.fn();
    const socket = { join: vi.fn(), leave: vi.fn(), on: vi.fn(), workspaceId: "ws-1" } as unknown as RelaySocket;
    await joinOrLeaveCompetitorRoom(socket, "join", "not-a-uuid", { getCompetitorByIdForWorkspace });
    expect(socket.join).not.toHaveBeenCalled();
    expect(getCompetitorByIdForWorkspace).not.toHaveBeenCalled();
  });
});
