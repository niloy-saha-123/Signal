// Expiry sweep logic tests — auto-deny stale confirmations only, never fresh ones,
// never auto-approve. All deps are fakes so no graph/checkpointer/DB is touched.
import { describe, expect, it, vi } from "vitest";
import {
  autoDenyExpiredConfirmations,
  listPendingConfirmationsForWorkspace,
  PENDING_CONFIRMATION_TTL_MS,
  type ConfirmationDiscoveryDeps,
  type ExpirySweepDeps,
} from "@/agents/chat/confirmation-expiry";

const WORKSPACE = "00000000-0000-4000-8000-000000000000";
const THREAD = "11111111-1111-4111-8111-111111111111";

function mutation(): { tool_name: string; description: string; arguments: Record<string, unknown> } {
  return { tool_name: "create_competitor", description: "Create competitor Acme?", arguments: { name: "Acme" } };
}

describe("listPendingConfirmationsForWorkspace", () => {
  it("returns only threads with pending mutations", async () => {
    const deps: ConfirmationDiscoveryDeps = {
      listThreads: vi.fn().mockResolvedValue([{ id: THREAD }, { id: "quiet-thread" }]),
      getThreadState: vi.fn().mockImplementation((id: string) =>
        id === THREAD
          ? { createdAt: "2026-09-01T00:00:00Z", mutations: [mutation()] }
          : { createdAt: undefined, mutations: [] }
      ),
    };

    const pending = await listPendingConfirmationsForWorkspace(WORKSPACE, deps);
    expect(pending).toHaveLength(1);
    expect(pending[0].thread_id).toBe(THREAD);
    expect(pending[0].mutations[0].tool_name).toBe("create_competitor");
  });
});

describe("autoDenyExpiredConfirmations", () => {
  function deps(over: Partial<ExpirySweepDeps> = {}): ExpirySweepDeps {
    return {
      listWorkspaces: vi.fn().mockResolvedValue([{ id: WORKSPACE }]),
      listThreads: vi.fn().mockResolvedValue([{ id: THREAD }]),
      getThreadState: vi.fn().mockResolvedValue({ createdAt: "2026-09-01T00:00:00Z", mutations: [mutation()] }),
      resumeDeny: vi.fn().mockResolvedValue(undefined),
      logExpiry: vi.fn(),
      ...over,
    };
  }

  it("auto-denies a confirmation older than the TTL and logs it", async () => {
    const d = deps();
    const nowMs = Date.parse("2026-09-20T00:00:00Z"); // 19 days after the confirmation
    const expired = await autoDenyExpiredConfirmations(d, { nowMs });

    expect(expired).toBe(1);
    expect(d.resumeDeny).toHaveBeenCalledWith(THREAD);
    expect(d.logExpiry).toHaveBeenCalledWith(expect.objectContaining({ thread_id: THREAD }));
  });

  it("leaves a fresh confirmation alone", async () => {
    const d = deps({
      getThreadState: vi.fn().mockResolvedValue({ createdAt: "2026-09-19T00:00:00Z", mutations: [mutation()] }),
    });
    const nowMs = Date.parse("2026-09-20T00:00:00Z"); // 1 day old
    const expired = await autoDenyExpiredConfirmations(d, { nowMs });

    expect(expired).toBe(0);
    expect(d.resumeDeny).not.toHaveBeenCalled();
  });

  it("treats a missing timestamp as fresh (never auto-deny on no age)", async () => {
    const d = deps({
      getThreadState: vi.fn().mockResolvedValue({ createdAt: undefined, mutations: [mutation()] }),
    });
    const expired = await autoDenyExpiredConfirmations(d, { nowMs: Date.now() });

    expect(expired).toBe(0);
    expect(d.resumeDeny).not.toHaveBeenCalled();
  });

  it("exports a 7-day TTL constant", () => {
    expect(PENDING_CONFIRMATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});