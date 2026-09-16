import { describe, it, expect, vi, beforeEach } from "vitest";

const { hybridRetrieveMock, hybridRetrieveProfileMock } = vi.hoisted(() => ({
  hybridRetrieveMock: vi.fn(),
  hybridRetrieveProfileMock: vi.fn(),
}));

vi.mock("@/retrieval/hybrid-retrieval", () => ({
  hybridRetrieve: hybridRetrieveMock,
  hybridRetrieveProfile: hybridRetrieveProfileMock,
}));

import { retrievalTool } from "@/retrieval/hybrid-retrieve-tool";

describe("retrieval/hybrid-retrieve-tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes hybridRetrieve as a callable LangChain tool", async () => {
    hybridRetrieveMock.mockResolvedValue([
      { id: "s1", text: "pricing went up 10%" },
    ]);

    const result = await retrievalTool.invoke({
      query: "pricing changes",
      competitor_ids: ["comp-1"],
    });

    expect(typeof result).toBe("string");
    expect(hybridRetrieveMock).toHaveBeenCalledWith("pricing changes", ["comp-1"]);
    expect(JSON.parse(result as string)).toEqual([{ id: "s1", text: "pricing went up 10%" }]);
  });

  it("routes to hybridRetrieveProfile when workspace_id is provided", async () => {
    hybridRetrieveProfileMock.mockResolvedValue([
      { id: "ws-1:doc", text: "we charge $10/mo" },
    ]);

    const result = await retrievalTool.invoke({
      query: "what is our pricing",
      workspace_id: "ws-1",
    });

    expect(typeof result).toBe("string");
    expect(hybridRetrieveProfileMock).toHaveBeenCalledWith("what is our pricing", "ws-1");
    expect(hybridRetrieveMock).not.toHaveBeenCalled();
    expect(JSON.parse(result as string)).toEqual([{ id: "ws-1:doc", text: "we charge $10/mo" }]);
  });

  it("returns an empty JSON array when neither competitor_ids nor workspace_id is given", async () => {
    const result = await retrievalTool.invoke({ query: "anything" });

    expect(result).toBe("[]");
    expect(hybridRetrieveMock).not.toHaveBeenCalled();
    expect(hybridRetrieveProfileMock).not.toHaveBeenCalled();
  });
});