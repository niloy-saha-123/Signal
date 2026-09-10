---
name: signal-production-review
description: Review Signal changes for production reliability, scalability, failure recovery, observability, cost, deployment safety, and operational readiness across API, workers, AI services, Postgres, Redis, and Pinecone.
---

# Signal Production Review

Review the full execution path, not just the changed function. Model partial outages and process
restarts across Express, BullMQ/Redis, Postgres, Pinecone, model providers, external sources, and
Playwright.

Check:

- explicit connect/read/overall timeouts and cancellation limitations;
- retry classification, exponential backoff, jitter where useful, circuit breakers, lock duration,
  idempotency, poison jobs, and bounded retention;
- queue concurrency/rate limits, repeat-registration idempotency, fan-out limits, and backpressure;
- short database transactions, query/index fit, connection pooling, uniqueness, and race conditions;
- cache corruption/outage semantics, TTL choice, stampedes, and stale-data behavior;
- process startup validation, health/readiness meaning, graceful shutdown, browser/resource cleanup;
- structured logs, run/job/correlation IDs, latency/cost tracking, redaction, and actionable alerts;
- AI context/token bounds, daily budgets, provider fallback behavior, and no silent quality downgrade;
- safe migration/deploy ordering and rollback compatibility.

Report concrete failure scenarios with severity, blast radius, observability, and a proportionate fix.
Distinguish launch blockers from accepted technical debt.
