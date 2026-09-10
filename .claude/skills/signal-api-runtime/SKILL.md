---
name: signal-api-runtime
description: Build Signal's Express API, route factories, SSE chat boundary, Socket.IO delivery, request validation, error mapping, and server lifecycle. Use for apps/api/src/api and API process composition.
---

# Signal API Runtime

Read the route stub header, shared Zod schemas, `db/queries.ts`, queue registry, and
`.claude/loop/13-api-routes.md` before implementation.

## Boundary rules

- Keep routers thin and dependency-injectable. SQL belongs in `db/queries.ts`; slow collection,
  discovery, Playwright, and analysis belong in the worker process.
- Parse body, params, query strings, cursors, and persisted union JSON with Zod. Mutation bodies are
  strict and bounded; UUIDs are validated before dependencies run.
- Commit database writes before Redis/BullMQ enqueue operations. Never keep a transaction open over
  network, queue, LLM, or cache work.
- Return deliberate 400/404/409/422/500 mappings without leaking stack traces, secrets, SQL, or
  provider payloads.
- Signal is currently single-tenant with no auth. Do not invent authorization; flag public exposure
  and rate limiting as production requirements.
- Signal/alert lists use bounded `(created_at,id)` keyset cursors and set-based filters.

## Chat SSE

Create a persisted manual run before ChatAgent. Send standard SSE headers, emit only the final
verified typed result, then `done`. Refusal is a successful result. Handle disconnects and emit a
sanitized error event only after headers have started.

Test route behavior through a real in-memory HTTP server with fake dependencies; do not add real DB,
Redis, queue, or model calls to unit tests. Verify startup and graceful shutdown separately.
