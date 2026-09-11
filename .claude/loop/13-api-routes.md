# Part 13 — API routes and executable runtime

**Files:** `apps/api/src/api/{index,competitors,signals,alerts,chat,company-profile}.ts`,
`apps/api/src/db/queries.ts`, `apps/api/src/queues/{registry,scheduler}.ts`, `apps/api/worker.ts`
**Branch:** `discovery-chat-api-impl`
**Depends on:** Parts 1–12; all are complete.

## What it is

Part 13 turns the completed libraries into a runnable product boundary. It exposes validated
Express routes for competitor setup, discovery status, signal/alert reads, company context, manual
analysis, and citation-verified chat. It also composes the standalone BullMQ worker so collection,
pipeline, discovery, and analysis jobs run outside Express as required by the project architecture.

This is more than filling five route stubs: the current `apps/api/package.json` points `dev` and
`start` at an absent `src/api/index.ts`, `apps/api/worker.ts` is still a stub, and the analysis queue
has no processor or scheduled producer. Those runtime gaps are in scope because the routes cannot
honestly claim to trigger analysis or SSE chat without them.

## Ground truth from completed parts

- `createCompetitor`, `getCompetitorById`, `listCompetitors`, discovery-log reads, signal reads,
  score reads, and company-profile reads/writes already exist in `db/queries.ts`; extend that module
  instead of issuing ad-hoc SQL from route handlers.
- `queues` is the side-effect-free enqueue surface. `registerWorker` and `initWorkers` belong only in
  the standalone worker process; importing an API router must never start Redis-polling workers.
- Discovery jobs carry `{ competitor_id, name, domain }`; the worker reloads the row so optional
  field overrides stored at creation are respected.
- `analysisGraph.invoke()` needs caller-owned `competitor_id`, `run_id`, and `has_pricing_diff`.
  BullMQ payloads require runtime validation even though TypeScript types them.
- `runChatAgent({ query, competitor_ids, run_id })` returns a complete, runtime-validated
  `CitationResult | RefusalResult`. The route must create a real `agent_runs` row first because
  latency rows foreign-key to it.
- Chat citation enforcement is a trust boundary: SSE may chunk or emit only the final verified
  answer, never model draft tokens.
- Redis key `company:profile` is read by `getCompanyContext()` and must be invalidated after a
  successful profile write.
- The scheduler currently describes collector repeat configuration but does not register BullMQ
  repeatable jobs. Collection processors exist, but the executable worker has not composed them.

## Locked rulings

1. **Thin, injectable routers.** Export router factories whose dependencies can be faked in tests;
   the production defaults use `db/queries.ts` and `queues`. Route files do validation and HTTP
   translation, not database logic.
2. **Zod at every untrusted boundary.** Parse request bodies, params, query strings, BullMQ job data,
   and persisted JSON returned as API unions. Unknown keys are rejected on mutation endpoints.
3. **Keyset pagination.** Signal and alert feeds use `(created_at, id)` cursors with a bounded page
   size rather than `OFFSET`; the cursor contains both fields for deterministic ordering. Filter
   arrays are handled in one query, never N+1 loops.
4. **Short database transactions.** No HTTP, LLM, Redis, or queue operation runs inside a database
   transaction. Create/update the row, commit, then enqueue. If enqueue fails, return an operational
   error and log the created row's ID; do not hold a database lock across Redis.
5. **Explicit run lifecycle.** A helper creates `agent_runs(status='running')`. Manual analysis and
   chat create their run before invoking work, then mark it completed or failed. A route never
   invents a run ID without persisting it.
6. **Verified SSE only.** Chat responds with `text/event-stream`, sends a typed `result` event only
   after `runChatAgent` resolves, followed by `done`. Refusals remain successful typed results.
   Operational failures emit a typed `error` event only if headers were already sent.
7. **Abort and timeout analysis.** The analysis worker races graph execution against a bounded wall
   clock and marks the run failed on timeout/error. It validates that the competitor exists before
   invocation. A timeout cannot cancel every downstream SDK today, so late work must not overwrite
   a failed run; document that residual limitation.
8. **Retry-safe daily scores before scheduling analysis.** Do not enable recurring analysis while
   `competitor_signal_scores` permits duplicate `(competitor_id, day)` rows. Add the reviewed unique
   migration and upsert semantics in a separately committed task, but do not apply a live Supabase
   migration without explicit authorization.
9. **Graceful process shutdown.** API and worker close the HTTP server, Socket.IO, BullMQ workers and
   queues, Redis, and Postgres resources on SIGTERM/SIGINT. Startup failures exit non-zero.
10. **No auth fiction.** Phase 0 is single-tenant and has no authentication layer. Do not add fake
    authorization checks; record production auth/rate limiting as open debt and keep mutation
    payloads tightly bounded.

## Tasks — TDD first

### Task 1 — route query helpers and contracts

Add tests before extending `db/queries.ts` and shared/local route schemas:

- competitor creation with the five optional discovery overrides;
- create/get/complete agent-run lifecycle;
- current score plus 7-day/30-day deltas;
- cursor-paginated signals with competitor/source/date/quality filters;
- cursor-paginated alerts;
- alert creation/read helpers needed by synthesis/runtime;
- deterministic cursors and empty filter-array behavior.

Use one set-based query per feed page. Inspect existing schema indexes against the actual filter and
sort shapes. If an index/migration is required, add it as a migration and test/describe it; do not
apply it to the live Supabase project in this task.

### Task 2 — competitor, signal, alert, and company-profile routers

- `POST /api/competitors`: strict validation, persist optional overrides, enqueue discovery after
  commit, return 201 with pending discovery state.
- `GET /api/competitors`, `GET /api/competitors/:id`, and
  `GET /api/competitors/:id/discovery` with UUID validation and real 404s.
- `GET /api/competitors/:id/score` with current score/component/delta shape.
- `POST /api/competitors/:id/analyze`: create a manual run, enqueue `{ competitor_id, run_id,
  has_pricing_diff }`, and return 202.
- `GET /api/signals` and `GET /api/alerts`: bounded filters plus opaque next cursors.
- `GET /api/company-profile` and strict `POST /api/company-profile`: persist, invalidate
  `company:profile`, enqueue the update job, and preserve a clear 404 when absent.

Test status codes, response bodies, malformed input, not-found cases, dependency failures, and that
no route performs slow discovery/analysis work inline.

### Task 3 — citation-verified chat SSE

- `POST /api/chat` validates query and competitor scope, verifies competitors exist in one batch,
  creates a manual run, then calls ChatAgent.
- Set standard SSE headers and heartbeat/connection-close behavior.
- Emit only the final validated `ChatAgentResult`, then `done`; never expose the pre-enforcement
  draft. A refusal is a normal `result`, not HTTP/SSE failure.
- Complete the run after a valid result; mark it failed on operational errors. Do not attempt to
  continue writing after the client disconnects.

Tests must assert event framing, verified-only delivery, refusal semantics, run lifecycle, early
validation failures before headers, post-header error events, and disconnect cleanup.

### Task 4 — analysis worker and retry-safe score write

- Add runtime-validated analysis job data and an exported processor that invokes the graph with a
  bounded wall-clock timeout.
- Complete/fail the existing run exactly once from the worker boundary.
- Add the `(competitor_id, day)` score uniqueness migration and change score creation to an upsert
  so BullMQ retry cannot duplicate a daily score. Generate the migration from the Drizzle schema;
  do not edit generated SQL by hand unless the project's migration workflow requires it.
- Replace the company-profile-update placeholder with a bounded, documented re-analysis strategy;
  do not enqueue an unbounded historical fan-out.

Test malformed job JSON, missing competitors, timeout/error lifecycle, retry idempotency, and
company-profile fan-out bounds.

### Task 5 — executable API, scheduler, and worker composition

- Add `src/api/index.ts` with JSON body limits, health route, mounted routers, centralized errors,
  Socket.IO attachment, startup validation, and graceful shutdown.
- Register repeatable collector jobs with stable job IDs and the cadences already defined by
  `getCollectorScheduleConfig()`; make startup registration idempotent.
- Compose discovery, collector, pipeline, and analysis workers in `worker.ts`; close every handle
  on shutdown. Keep Playwright collectors entirely in this process.
- Add smoke-level tests proving imports have no worker side effects and each process starts/closes
  through injectable dependencies.

### Task 6 — whole-part reviews, docs, and branch verification

- TypeScript review: request/response types, Express 4/5 type compatibility, no unsafe casts,
  dependency injection seams, resource cleanup.
- Production review: enqueue-after-commit behavior, retry/idempotency, timeouts, pagination, worker
  shutdown, repeat-job duplication, Redis/Postgres outage semantics.
- Security review: raw body/query bounds, UUIDs, cursor parsing, SSE injection/framing, SSRF stays
  outside routes, error redaction, absent-auth debt.
- Update `docs/architecture.md`, `docs/decisions.md`, `docs/tech-debt.md`, and
  `docs/Signal — Project Reference.md` to distinguish implemented runtime from future frontend.

## Verify

Run focused tests after each task, then `npm run typecheck`, `npm test -w @signal/api`,
`npm test -w @signal/shared`, `npm run build`, and `git diff --check`. Commit each task separately.
Flip Part 13 to ✅ only after the runnable API and worker entry points pass the full verification suite.
Do not push, open a PR, or apply a live database migration without the user's explicit request.

## Completion — 2026-09-10

**Status: ✅ implemented and branch-reviewed.** Tasks 1–5 are present on
`discovery-chat-api-impl`; Task 6 is recorded in
`.claude/loop/PART-13-BRANCH-REVIEW.md` and the Obsidian project documents.

- Task 1: query contracts — `854c70b`
- Task 2: four non-chat routers — `8bc86cc` plus follow-up `26849ed`
- Task 3: citation-verified SSE chat — `d455d16`
- Task 4: validated analysis worker and retry-safe daily score — `e462f61`
- Task 5: executable API, schedules, worker composition, shutdown — `c23e14e`
- Task 6: whole-branch fix/review/docs wave — see the review artifact and later commits

Migration `apps/api/drizzle/0004_nervous_kate_bishop.sql` was applied to the
connected `signal` Supabase project on 2026-09-10 after explicit authorization and
recorded there as migration version `20260910235923`. Post-apply catalog checks
confirmed the stored generated UTC `day` expression and unique
`(competitor_id, day)` index; the table contained no rows requiring deduplication.
The database prerequisite for the new analysis worker is therefore satisfied.
