// Pure unit tests for the compaction builders in chat-graph.ts. No Postgres, no
// mocks, no graph invocation — these assert prompt composition and the
// collapse-boundary decision directly. A dummy DATABASE_URL is set before import
// so loadRootEnv() can't inject the real Supabase URL into the checkpointer the
// module builds at load (the pg.Pool it wraps never connects here).
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  buildConversationBlock,
  MESSAGE_WINDOW_SIZE,
  messagesToSummarize,
  needsCompaction,
} from "@/agents/chat/chat-graph";

function h(text: string): HumanMessage {
  return new HumanMessage(text);
}
function a(text: string): AIMessage {
  return new AIMessage(text);
}

// 6 complete turns + the in-flight question = 13 messages, 12 before the window.
const SEEDED = [
  h("q0"), a("a0"),
  h("q1"), a("a1"),
  h("q2"), a("a2"),
  h("q3"), a("a3"),
  h("q4"), a("a4"),
  h("q5"), a("a5"),
  h("q6"),
];

describe("agents/chat/chat-graph — compaction builders", () => {
  it("needsCompaction is false at/inside the window, true beyond it", () => {
    const atWindow = [...SEEDED.slice(0, 10), h("current")];
    const beyondWindow = [...SEEDED.slice(0, 11), h("current")];

    expect(needsCompaction(atWindow)).toBe(false);
    expect(needsCompaction(beyondWindow)).toBe(true);
  });

  it("messagesToSummarize returns exactly the messages older than the verbatim window", () => {
    expect(messagesToSummarize(SEEDED).map((m) => m.content)).toEqual(["q0", "a0"]);
    const withinWindow = [...SEEDED.slice(0, 10), h("current")];
    expect(messagesToSummarize(withinWindow)).toEqual([]);
  });

  it("buildConversationBlock renders the summary ahead of the last window, never the prefix", () => {
    const block = buildConversationBlock(SEEDED, "ROLLING SUMMARY");

    expect(block).toContain("CONVERSATION SUMMARY:\nROLLING SUMMARY");
    expect(block).toContain("CONVERSATION:");
    // The verbatim window is the last MESSAGE_WINDOW_SIZE messages before the question.
    expect(block).toContain("User: q1");
    expect(block).toContain("Assistant: a5");
    // Collapsed prefix stays out of the verbatim block.
    expect(block).not.toContain("q0");
    expect(block).not.toContain("a0");
    // The in-flight question is rendered separately, not part of the block.
    expect(block).not.toContain("q6");
  });

  it("buildConversationBlock omits the summary section when empty", () => {
    const block = buildConversationBlock(SEEDED.slice(0, 4), "");
    expect(block).not.toContain("CONVERSATION SUMMARY:");
    expect(block).toContain("CONVERSATION:");
  });

  it("exposes the window size the graph compacts to", () => {
    expect(MESSAGE_WINDOW_SIZE).toBe(10);
  });
});