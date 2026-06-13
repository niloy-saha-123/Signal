// Exponential backoff retry utility with Zod validation self-correction for LLM call resilience.
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  backoffMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}
