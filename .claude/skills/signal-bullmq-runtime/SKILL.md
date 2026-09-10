---
name: signal-bullmq-runtime
description: Build or change Signal BullMQ queues, workers, collectors-to-pipeline chaining, repeat schedules, retries, concurrency, idempotency, and worker shutdown. Use for queue registry, scheduler, worker.ts, or job processors.
---

# Signal BullMQ Runtime

Read `queues/registry.ts`, `queues/scheduler.ts`, the processor implementation, and its downstream
database writes before changing a job flow.

## Runtime contract

- Express enqueues only; the standalone `worker.ts` owns every Worker and all Playwright work.
- Validate job data at runtime. Keep payloads small and immutable; reload mutable competitor state
  inside the processor when correctness requires it.
- Use stable job IDs for repeat registration and make startup idempotent across process restarts.
- Choose concurrency, rate limits, attempts, backoff, lock duration, and wall-clock timeout from the
  external system and write semantics—not from generic defaults.
- A retry must not duplicate signals, clusters, scores, alerts, or terminal failure logs. Establish a
  unique key/upsert or an equivalent deterministic guard before enabling retries.
- Do not sleep inside collectors for rate limiting. Use BullMQ limiter/scheduling facilities.
- Failed jobs log queue, safe job identity, attempts, and sanitized error. Terminal-only side effects
  must distinguish a retryable failure event from exhausted attempts.
- Graceful shutdown closes workers, queues, Redis, Postgres, and browser resources; startup failure
  exits non-zero.

Test malformed payloads, retry boundaries, idempotency, timeout/lock interactions, repeat-job
deduplication, fan-out bounds, failure listeners, and shutdown. Keep Redis and external APIs mocked in
unit tests; add integration coverage only when an isolated service is intentionally provided.
