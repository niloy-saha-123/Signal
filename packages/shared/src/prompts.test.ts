import { describe, it, expect } from "vitest";
import { PromptVersionSchema } from "./prompts";

describe("PromptVersionSchema", () => {
  it("accepts an active prompt version", () => {
    const result = PromptVersionSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440004",
      agent_name: "synthesis",
      version: 3,
      prompt_text: "You are SynthesisAgent...",
      is_active: true,
      accuracy: 0.87,
      promoted_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-08-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects version 0 (violates .min(1))", () => {
    const result = PromptVersionSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440004",
      agent_name: "synthesis",
      version: 0,
      prompt_text: "You are SynthesisAgent...",
      is_active: true,
      accuracy: 0.87,
      promoted_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-08-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an agent_name outside the CHECK constraint's allowed values", () => {
    const result = PromptVersionSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440004",
      agent_name: "not_a_real_agent",
      version: 3,
      prompt_text: "You are SynthesisAgent...",
      is_active: true,
      accuracy: 0.87,
      promoted_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-08-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
