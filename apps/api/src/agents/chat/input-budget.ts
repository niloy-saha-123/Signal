// Per-workspace rate limits for chat input tools. Fail closed: a Redis error
// or a crossed cap both refuse the call rather than letting spend run unbounded.
export const FETCH_URL_WORKSPACE_LIMIT = 20;
export const FETCH_URL_WINDOW_SECONDS = 60;
export const IMAGE_WORKSPACE_LIMIT = 20;
export const IMAGE_WINDOW_SECONDS = 60;
export const MAX_FETCH_URL_PER_TURN = 3;
export const MAX_IMAGES_PER_TURN = 4;
export const MAX_DOCS_PER_TURN = 4;
export const FIELD_INTEL_WORKSPACE_LIMIT = 30;
export const FIELD_INTEL_WINDOW_SECONDS = 3_600;

type BudgetKind = "fetch_url" | "read_image" | "field_intel";

// field_intel lives here, not in a new limiter, because it is the same
// fail-closed per-workspace counter; each submission also starts the LLM pipeline.
const BUDGETS: Record<BudgetKind, { limit: number; window: number }> = {
  fetch_url: { limit: FETCH_URL_WORKSPACE_LIMIT, window: FETCH_URL_WINDOW_SECONDS },
  read_image: { limit: IMAGE_WORKSPACE_LIMIT, window: IMAGE_WINDOW_SECONDS },
  field_intel: { limit: FIELD_INTEL_WORKSPACE_LIMIT, window: FIELD_INTEL_WINDOW_SECONDS },
};

export class BudgetExceededError extends Error {
  constructor(readonly kind: BudgetKind) {
    super(`${kind} workspace rate limit exceeded`);
    this.name = "BudgetExceededError";
  }
}

export interface CounterStore {
  increment(key: string, ttlSeconds: number): Promise<number>;
}

export function memoryCounterStore(): CounterStore {
  const counts = new Map<string, number>();
  return {
    async increment(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

function redisCounterStore(): CounterStore {
  return {
    async increment(key, ttlSeconds) {
      const { cacheRedis } = await import("../../lib/redis-client.js");
      const n = await cacheRedis.incr(key);
      if (n === 1) await cacheRedis.expire(key, ttlSeconds);
      return n;
    },
  };
}

let storeOverride: CounterStore | undefined;

export function setChatInputBudgetStore(store: CounterStore | undefined): void {
  storeOverride = store;
}

export async function consumeChatInputBudget(kind: BudgetKind, workspaceId: string): Promise<void> {
  const { limit, window } = BUDGETS[kind];
  const store = storeOverride ?? redisCounterStore();
  let n: number;
  try {
    n = await store.increment(`chat:${kind}:${workspaceId}`, window);
  } catch {
    throw new BudgetExceededError(kind);
  }
  if (n > limit) throw new BudgetExceededError(kind);
}
