---
name: signal-code-review
description: Review Signal changes for correctness, regressions, contract violations, and maintainability. Use for broad code review or PR review; route deeper concerns to the specialized Signal review skills without editing unless asked.
---

# Signal Code Review

Review read-only unless the user explicitly asks for fixes. Inspect the diff, affected callers,
tests, schemas, queue/graph boundaries, and relevant project plan/docs. Do not infer correctness from
passing tests alone.

## Review priorities

1. Behavioral correctness and data loss/corruption.
2. Violations of project invariants: immutable graph state, deterministic routing, retrieval order,
   citation-before-delivery, required competitor namespace, worker/API separation, company context.
3. Runtime validation at HTTP, job, cache, model, and database JSON boundaries.
4. Error/failure semantics, cleanup, retries, concurrency, and idempotency.
5. Missing meaningful tests and stale documentation.

Report only actionable findings, ordered P0–P3. Each finding identifies the exact file/line, triggering
scenario, user/production impact, and smallest safe correction. Separate confirmed defects from
questions and residual risks. If no findings exist, say so and list the areas actually checked.

For broad reviews, additionally invoke the relevant security, production, TypeScript, test, AI,
stack, dependency, or conflict skill; do not duplicate their generic checklists here.
