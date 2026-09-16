import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, setupCheckpointerMock, registerWorkerMock, loggerMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  setupCheckpointerMock: vi.fn(),
  registerWorkerMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/agents/discovery-search/discovery-graph", () => ({
  discoveryGraph: { invoke: invokeMock },
  DISCOVERY_RECURSION_LIMIT: 15,
  setupDiscoveryCheckpointer: setupCheckpointerMock,
}));

vi.mock("@/queues/registry", () => ({
  registerWorker: registerWorkerMock,
}));

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

import {
  DiscoveryJobDataSchema,
  createDiscoveryJobProcessor,
  discoveryJobProcessor,
  initDiscoveryWorker,
} from "@/agents/discovery-search/discovery-worker";
import { DISCOVERY_RECURSION_LIMIT } from "@/agents/discovery-search/discovery-graph";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";

function job(data: unknown = { workspace_id: WORKSPACE_ID }) {
  return { id: "job-1", data, attemptsMade: 0, opts: { attempts: 1 } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockResolvedValue({});
  setupCheckpointerMock.mockResolvedValue(undefined);
  registerWorkerMock.mockReturnValue({ name: "discovery-search" });
});

describe("discovery job processor", () => {
  it("rejects malformed BullMQ data before setting up the checkpointer or invoking the graph", async () => {
    await expect(discoveryJobProcessor(job({ workspace_id: "ws-1" }))).rejects.toThrow();
    expect(setupCheckpointerMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("sets up the checkpointer, then invokes the graph with the workspace_id as thread id and the recursion limit", async () => {
    await expect(discoveryJobProcessor(job())).resolves.toBeUndefined();

    expect(setupCheckpointerMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(
      { workspace_id: WORKSPACE_ID },
      { configurable: { thread_id: WORKSPACE_ID }, recursionLimit: DISCOVERY_RECURSION_LIMIT }
    );
  });

  it("propagates a graph failure to BullMQ for retry", async () => {
    const graphError = new Error("provider unavailable");
    invokeMock.mockRejectedValueOnce(graphError);

    await expect(discoveryJobProcessor(job())).rejects.toBe(graphError);
  });
});

describe("createDiscoveryJobProcessor", () => {
  it("defaults the checkpointer setup to setupDiscoveryCheckpointer, injectable for tests", async () => {
    const stubSetup = vi.fn().mockResolvedValue(undefined);
    const processor = createDiscoveryJobProcessor(
      { invoke: invokeMock } as never,
      { setupCheckpointer: stubSetup }
    );

    await processor(job());

    expect(stubSetup).toHaveBeenCalledTimes(1);
    expect(setupCheckpointerMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith(
      { workspace_id: WORKSPACE_ID },
      { configurable: { thread_id: WORKSPACE_ID }, recursionLimit: DISCOVERY_RECURSION_LIMIT }
    );
  });
});

describe("initDiscoveryWorker", () => {
  it("registers the discovery processor without import-time worker creation", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();
    const worker = initDiscoveryWorker();
    expect(registerWorkerMock).toHaveBeenCalledWith("discovery-search", discoveryJobProcessor);
    expect(worker).toEqual({ name: "discovery-search" });
  });
});

describe("DiscoveryJobDataSchema", () => {
  it("requires a uuid workspace_id", () => {
    expect(DiscoveryJobDataSchema.safeParse({ workspace_id: WORKSPACE_ID }).success).toBe(true);
    expect(DiscoveryJobDataSchema.safeParse({ workspace_id: "ws-1" }).success).toBe(false);
  });
});