import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client", () => ({
  db: { select: vi.fn() },
}));

import { db } from "../db/client";
import { getActivePrompt } from "./prompt-registry";

describe("getActivePrompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the prompt_text of the active version for the agent", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ prompt_text: "You are SynthesisAgent..." }]),
        }),
      }),
    });

    const prompt = await getActivePrompt("synthesis");
    expect(prompt).toBe("You are SynthesisAgent...");
  });

  it("returns null when no active version exists for the agent", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    expect(await getActivePrompt("synthesis")).toBeNull();
  });
});
