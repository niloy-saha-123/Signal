import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/queries", () => ({
  createCompanyDocument: vi.fn(),
  upsertCompanyProfileForWorkspace: vi.fn(),
}));

vi.mock("@/vector/pinecone", () => ({
  pineconeUpsert: vi.fn(),
}));

import * as queries from "@/db/queries";
import { memoryCounterStore, setChatInputBudgetStore } from "@/agents/chat/input-budget";
import { processTurnAttachments, TurnAttachmentError } from "@/agents/chat/turn-attachments";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000000";

describe("agents/chat/turn-attachments", () => {
  beforeEach(() => {
    setChatInputBudgetStore(memoryCounterStore());
  });
  afterEach(() => {
    setChatInputBudgetStore(undefined);
  });

  it("parses a text document into evidence text and never persists to the knowledge base", async () => {
    const result = await processTurnAttachments(
      [{ filename: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Q3 goal: expand SMB") }],
      WORKSPACE_ID
    );
    expect(result.documents).toEqual([{ filename: "notes.txt", text: "Q3 goal: expand SMB" }]);
    expect(result.images).toEqual([]);
    expect(queries.createCompanyDocument).not.toHaveBeenCalled();
    expect(queries.upsertCompanyProfileForWorkspace).not.toHaveBeenCalled();
  });

  it("accepts a raster image and rejects SVG", async () => {
    const ok = await processTurnAttachments(
      [{ filename: "shot.png", mimeType: "image/png", buffer: PNG_1X1 }],
      WORKSPACE_ID
    );
    expect(ok.images).toHaveLength(1);
    expect(ok.images[0].mime).toBe("image/png");
    expect(ok.images[0].base64.length).toBeGreaterThan(0);

    await expect(
      processTurnAttachments(
        [{ filename: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg></svg>") }],
        WORKSPACE_ID
      )
    ).rejects.toBeInstanceOf(TurnAttachmentError);
  });

  it("enforces the per-turn image cap", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      filename: `shot-${i}.png`,
      mimeType: "image/png",
      buffer: PNG_1X1,
    }));
    await expect(processTurnAttachments(files, WORKSPACE_ID)).rejects.toThrow(/at most 4 images/i);
  });
});
