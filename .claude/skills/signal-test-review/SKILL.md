---
name: signal-test-review
description: Review Signal tests and test strategy for meaningful coverage, isolation, determinism, contract fidelity, failure paths, and regression protection across Vitest, Playwright, queues, databases, and AI boundaries.
---

# Signal Test Review

Map changed behavior to tests before reading assertion counts. Passing tests are evidence only when
they exercise the real contract.

Review for:

- happy path plus malformed input, empty data, timeout, retry, provider/cache/DB outage, disconnect,
  and cleanup paths;
- deterministic graph routing/fan-in, immutable state, queue idempotency, terminal retry behavior,
  and cache schema validation;
- strict retrieval order, typed refusal, citation enforcement, prompt-injection boundaries, token/
  context limits, and cost/latency attribution without real model calls;
- route status/body/SSE framing through a real in-memory HTTP server with injected dependencies;
- mocks that preserve dependency call shape and do not make impossible behavior pass;
- no unintended network, live Supabase, Redis, Pinecone, browser, or paid provider calls in unit tests;
- Playwright only for observable browser flows, with resilient role/label locators;
- migration/schema constraints tested at the appropriate integration layer;
- focused tests plus API/shared/root typecheck and production build proportional to risk.

Do not demand line coverage for its own sake. Report the unprotected behavior, failure it could miss,
and the smallest valuable test. Protect curated RAG eval data and thresholds from test convenience.
