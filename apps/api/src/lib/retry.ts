// Exponential backoff retry wrapper used across collectors and LLM calls.
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        // Jitter (0.5x-1x of the exponential delay) so concurrent callers failing at the
        // same moment (e.g. multiple collectors hitting a rate-limited API) don't retry
        // in lockstep.
        const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
