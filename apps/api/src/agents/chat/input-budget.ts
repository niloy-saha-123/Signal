// Per-workspace rate limits for chat input tools. Fail closed: a Redis error
// or a crossed cap both refuse the call rather than letting spend run unbounded.
export const FETCH_URL_WORKSPACE_LIMIT = 20;
export const FETCH_URL_WINDOW_SECONDS = 60;
export const IMAGE_WORKSPACE_LIMIT = 20;
export const IMAGE_WINDOW_SECONDS = 60;
export const MAX_FETCH_URL_PER_TURN = 3;
export const MAX_IMAGES_PER_TURN = 4;
export const MAX_DOCS_PER_TURN = 4;

export class BudgetExceededError extends Error {
  constructor(readonly kind: "fetch_url" | "read_image") {
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

export async function consumeChatInputBudget(
  kind: "fetch_url" | "read_image",
  workspaceId: string
): Promise<void> {
  const limit = kind === "fetch_url" ? FETCH_URL_WORKSPACE_LIMIT : IMAGE_WORKSPACE_LIMIT;
  const window = kind === "fetch_url" ? FETCH_URL_WINDOW_SECONDS : IMAGE_WINDOW_SECONDS;
  const store = storeOverride ?? redisCounterStore();
  let n: number;
  try {
    n = await store.increment(`chat:${kind}:${workspaceId}`, window);
  } catch {
    throw new BudgetExceededError(kind);
  }
  if (n > limit) throw new BudgetExceededError(kind);
}
