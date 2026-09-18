import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  FETCH_URL_WORKSPACE_LIMIT,
  consumeChatInputBudget,
  memoryCounterStore,
  setChatInputBudgetStore,
} from "@/agents/chat/input-budget";

describe("agents/chat/input-budget", () => {
  it("allows up to the workspace cap and refuses the next call", async () => {
    setChatInputBudgetStore(memoryCounterStore());
    const workspaceId = "00000000-0000-4000-8000-000000000001";
    for (let i = 0; i < FETCH_URL_WORKSPACE_LIMIT; i++) {
      await consumeChatInputBudget("fetch_url", workspaceId);
    }
    await expect(consumeChatInputBudget("fetch_url", workspaceId)).rejects.toBeInstanceOf(
      BudgetExceededError
    );
    setChatInputBudgetStore(undefined);
  });

  it("scopes the counter per workspace", async () => {
    setChatInputBudgetStore(memoryCounterStore());
    const a = "00000000-0000-4000-8000-00000000000a";
    const b = "00000000-0000-4000-8000-00000000000b";
    for (let i = 0; i < FETCH_URL_WORKSPACE_LIMIT; i++) {
      await consumeChatInputBudget("fetch_url", a);
    }
    await expect(consumeChatInputBudget("fetch_url", b)).resolves.toBeUndefined();
    setChatInputBudgetStore(undefined);
  });

  it("fail-closes when the counter store throws", async () => {
    setChatInputBudgetStore({
      increment: async () => {
        throw new Error("redis down");
      },
    });
    await expect(
      consumeChatInputBudget("fetch_url", "00000000-0000-4000-8000-00000000000c")
    ).rejects.toBeInstanceOf(BudgetExceededError);
    setChatInputBudgetStore(undefined);
  });
});
