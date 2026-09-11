# Branch review — `discovery-chat-api-impl`

Date: 2026-09-10

Scope: `main..HEAD`, Parts 11–13, plus the final review fix wave

Method: specialized TypeScript, API-runtime, BullMQ, LangGraph, RAG/AI-quality,
Postgres/Supabase, security, production, dependency, test, stack, and conflict reviews.

## Verdict

**Approve for PR with deployment conditions.** The code is internally consistent,
fully typed, and covered by the repository's test/build gates. No unresolved
Critical or High code finding remains in the reviewed diff. The generated
`0004_nervous_kate_bishop.sql` migration was subsequently applied and verified;
the database prerequisite for a deployment that runs the new analysis worker is met.

## What the branch now delivers

- Retry-safe competitor discovery with bounded public-network probes.
- Citation-verified ChatAgent and SSE delivery that never exposes an unverified draft.
- Strict competitor, signal, alert, company-profile, chat, and manual-analysis routes.
- Keyset-paginated, competitor-scoped signal and alert feeds.
- Runtime-validated analysis jobs with a 120-second give-up boundary.
- One daily Signal Score row per competitor through a UTC day column, unique index,
  and conflict upsert.
- Idempotent BullMQ collector schedule registration and a composed 11-worker process.
- Executable Express/Socket.IO process and phased graceful shutdown for both runtimes.

## Findings fixed during whole-branch review

### Security

- Closed stored-URL SSRF paths in RSS entry fetching and Playwright pricing scraping.
  Feed and article redirects are revalidated; browser navigation and subresources are
  checked; response bodies are bounded.
- Required competitor scope on signal and alert feeds instead of permitting an
  accidental all-tenant/all-competitor read.
- Rejected override URLs with unsafe schemes, credentials, private DNS answers, or
  non-default ports.
- Bounded company-profile and competitor mutation strings/arrays and validated all
  primary competitor IDs before persistence.
- Added bounded JSON parsing, safe malformed/oversized-body errors, UUID validation,
  and generic 404/error responses.

### Reliability and production behavior

- Analysis retries no longer mark a run failed before the final BullMQ attempt.
- Run completion is conditional on `status = 'running'`, preventing late graph work
  from overwriting a terminal timeout/failure result.
- Company-profile re-analysis invalidates cached context again at the worker boundary.
- Chat cache identity now includes the active prompt and company context.
- Chat has a caller-visible wall-clock/cancellation race even where a dependency does
  not expose `AbortSignal`; post-await checks prevent later generation or cache writes.
- Corrected SSE disconnect detection to use request `aborted` and response `close`.
- Made company-profile persistence a single atomic singleton upsert.
- Bounded and ordered analysis input queries; bounded stored pricing page text.
- Worker shutdown is phased (workers, queues, then Redis/Postgres), with forced worker
  close after the graceful deadline; Socket.IO close is also bounded.

### Version and dependency review

- Moved the primary OpenAI reasoning tier from deprecated `gpt-4o` to supported
  `gpt-4.1`; retained supported `gpt-4o-mini` for lower-cost extraction/judging.
- Made Anthropic Haiku/Sonnet production IDs environment-overridable.
- Updated Next.js to 15.5.25, removed the unused direct LangSmith dependency, and
  forced the patched `qs` line.
- `npm audit` now reports 0 Critical, 0 High, and 4 Moderate findings. The remaining
  advisories are in the local `drizzle-kit`/esbuild development toolchain; npm's only
  proposed automatic resolution is an incompatible downgrade to drizzle-kit 0.18.1.

## Residual, explicitly accepted limits

- No authentication or rate limiting exists in Phase 0. Mutation routes must not be
  internet-exposed without an access-control boundary.
- `safeFetch` still has a DNS lookup/connect TOCTOU rebind window. Fully closing it
  requires a vetted-IP-pinned Undici connector; the current defense blocks literals,
  private answers, redirects, credentials, ports, and stored-URL reuse.
- The analysis timeout is a give-up boundary, not cooperative cancellation throughout
  every LangGraph/SDK dependency. Conditional run finalization prevents state reversal.
- Daily score storage is retry-safe, but this part schedules collectors only. Automatic
  daily analysis fan-out remains a separate coordinator capability; current triggers
  are manual analysis and bounded company-profile re-analysis.
- The API test suite uses mocked database chains; there is still no disposable real
  Postgres/Supabase integration-test environment.
- Chat does not coalesce identical concurrent cache misses, so two simultaneous equal
  requests can each incur model cost.

These are documented technical debt, not hidden completion claims.

## Deployment conditions

1. Configure `DATABASE_URL`, `REDIS_URL`, provider keys, and (optionally)
   `ANTHROPIC_HAIKU_MODEL_ID` / `ANTHROPIC_SONNET_MODEL_ID`.
2. Keep the Phase 0 API behind a trusted network/access-control layer until product
   authentication and rate limiting are implemented.

No push, PR creation, or merge was performed by this review.

## Post-review deployment verification — 2026-09-11

- Applied the exact committed SQL in `0004_nervous_kate_bishop.sql` to Supabase project
  `signal` after explicit user authorization; Supabase recorded version `20260910235923`.
- Preflight found zero score rows, zero duplicate competitor/day groups, and no active query
  touching `competitor_signal_scores`.
- Postflight confirmed `day` is a stored generated `date` using UTC and
  `competitor_signal_scores_competitor_day_uidx` is unique on `(competitor_id, day)`.
- Supabase security advisors reported only project-level, pre-existing notices: RLS is enabled
  without policies (deny-by-default for PostgREST roles) and the platform-created
  `public.rls_auto_enable()` event-trigger function retains default execute grants. Neither was
  introduced by migration `0004`; the API must still remain behind the trusted Phase 0 boundary.
- The live project uses Supabase's `supabase_migrations.schema_migrations` history and has no
  `drizzle.__drizzle_migrations` ledger. Continue applying reviewed SQL through the established
  Supabase migration workflow; do not point `drizzle-kit migrate` at this already-provisioned
  project unless its migration history is deliberately baselined first.

## Final merge-readiness verification — 2026-09-11

- Fetched `origin/main`; it is the exact merge base, so no conflict resolution or rebase is
  required before opening the PR.
- `npm run typecheck` passed across shared, API, and web workspaces.
- `npm test -w @signal/api` passed 626/626 tests; `npm test -w @signal/shared` passed 31/31.
- `npm run build` passed for shared, API, and the Next.js production build.
- `npm ci --dry-run --ignore-scripts`, workflow YAML parsing, and both branch/current
  `git diff --check` checks passed.
- CI now runs both unit suites before the production build; previously the committed tests were
  local-only and the PR gate ran just typecheck/build plus the separate provider-backed RAG eval.
- `npm audit` reports 0 Critical, 0 High, and 4 Moderate development-tool findings, matching the
  accepted dependency-review record above. Current Anthropic model IDs were also checked against
  the provider's active model list; the OpenAI `gpt-4.1` route remains supported.
