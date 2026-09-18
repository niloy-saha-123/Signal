// Pending-confirmation discoverability + expiry for the chat HITL gate.
//
// Durability is already provided by the PostgresSaver checkpointer (a paused
// graph is a checkpoint row, not an open connection — see
// chat-graph.interrupt.test.ts). These helpers read that state back (the
// pending-confirmations list) and sweep stale ones (auto-deny after a TTL).
import { Command } from "@langchain/langgraph";
import {
  getChatGraph,
  pendingMutations,
  setupChatCheckpointer,
  CHAT_RECURSION_LIMIT,
  type ChatMutationRequest,
} from "./chat-graph";
import { listChatThreadsForWorkspace, listWorkspaces } from "../../db/queries";
import { logger } from "../../lib/logger";

// A pending confirmation stops being actionable after this long — "create
// competitor X" confirmed 3 weeks later, with no memory of why it was asked, is
// worse than making the user re-ask. 7 days is a starting point, not a settled
// answer: keep it a named constant so product experience can move it either way.
export const PENDING_CONFIRMATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingConfirmation {
  thread_id: string;
  mutations: ChatMutationRequest[];
  created_at?: string;
}

export interface ConfirmationDiscoveryDeps {
  listThreads: (workspaceId: string) => Promise<{ id: string }[]>;
  getThreadState: (
    threadId: string
  ) => Promise<{ createdAt?: string; mutations: ChatMutationRequest[] }>;
}

export const defaultConfirmationDiscoveryDeps: ConfirmationDiscoveryDeps = {
  listThreads: async (workspaceId) =>
    (await listChatThreadsForWorkspace(workspaceId)).map((row) => ({ id: row.id })),
  getThreadState: async (threadId) => {
    await setupChatCheckpointer();
    const state = await getChatGraph().getState({ configurable: { thread_id: threadId } });
    return { createdAt: state.createdAt, mutations: pendingMutations(state) };
  },
};

export async function listPendingConfirmationsForWorkspace(
  workspaceId: string,
  deps: ConfirmationDiscoveryDeps = defaultConfirmationDiscoveryDeps
): Promise<PendingConfirmation[]> {
  const out: PendingConfirmation[] = [];
  for (const thread of await deps.listThreads(workspaceId)) {
    const { createdAt, mutations } = await deps.getThreadState(thread.id);
    if (mutations.length > 0) out.push({ thread_id: thread.id, mutations, created_at: createdAt });
  }
  return out;
}

export interface ExpirySweepDeps extends ConfirmationDiscoveryDeps {
  listWorkspaces: () => Promise<{ id: string }[]>;
  resumeDeny: (threadId: string) => Promise<void>;
  logExpiry: (fields: Record<string, unknown>) => void;
}

export const defaultExpirySweepDeps: ExpirySweepDeps = {
  ...defaultConfirmationDiscoveryDeps,
  listWorkspaces: () => listWorkspaces(),
  resumeDeny: async (threadId) => {
    await setupChatCheckpointer();
    // Auto-deny, never auto-approve — the safety default from the original HITL
    // decision holds even on expiry. The denial routes back through generate so
    // the model acknowledges it rather than stalling the thread.
    await getChatGraph().invoke(new Command({ resume: "deny" }), {
      configurable: { thread_id: threadId },
      recursionLimit: CHAT_RECURSION_LIMIT,
    });
  },
  logExpiry: (fields) => logger.info("auto-denied stale chat confirmation", fields),
};

// Sweeps every workspace and auto-denies confirmations older than the TTL.
// Returns how many were expired; each expiry is logged with its age for
// observability. No partial auto-approval, no "trusted action" allowlist — every
// mutating call gets the same gate, every time.
export async function autoDenyExpiredConfirmations(
  deps: ExpirySweepDeps = defaultExpirySweepDeps,
  opts: { nowMs?: number; ttlMs?: number } = {}
): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const ttlMs = opts.ttlMs ?? PENDING_CONFIRMATION_TTL_MS;
  let expired = 0;

  for (const workspace of await deps.listWorkspaces()) {
    const pending = await listPendingConfirmationsForWorkspace(workspace.id, deps);
    for (const confirmation of pending) {
      // A confirmation with no recorded createdAt can't be aged — never auto-deny
      // on a missing timestamp (treat as 0 age, i.e. still actionable).
      const ageMs = confirmation.created_at ? nowMs - Date.parse(confirmation.created_at) : 0;
      if (ageMs <= ttlMs) continue;
      await deps.resumeDeny(confirmation.thread_id);
      deps.logExpiry({
        thread_id: confirmation.thread_id,
        workspace_id: workspace.id,
        age_ms: ageMs,
      });
      expired += 1;
    }
  }

  return expired;
}