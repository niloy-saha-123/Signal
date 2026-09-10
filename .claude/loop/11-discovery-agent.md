# Part 11 — Competitor Discovery Agent

**File:** `apps/api/src/agents/discovery/competitor-discovery.ts` (stub → real)
**Branch:** `discovery-chat-api-impl` (off `main`, 2026-09-09)
**Depends on:** Parts 1–5 (all merged). No dependency on Parts 6–10.

## What it is

No LLM. Runs once when a competitor is created, off the `competitor-discovery` BullMQ queue
with payload `{ competitor_id, name, domain }`. Given only `name` + `domain`, probes public
HTTP endpoints to discover 5 fields, writes what it finds back to the `competitors` row, logs
every attempt to `competitor_discovery_log`, sets `discovery_status` + `discovered_at`.

The stub header comment in `competitor-discovery.ts` is the authoritative per-field spec — read
it before writing tests. Summary of strategies below, with the deviations this plan locks in.

## Ground truth from Parts 1–5 (do not re-derive)

- **Queue + wrapper already exist** (`queues/registry.ts`): `competitorDiscoveryProcessor` wraps
  `runDiscovery(job)` with circuit-breaker record/skip; `initWorkers()` builds the Worker;
  a `worker.on("failed")` handler already calls `writeDiscoveryFailure()` (logs one `error`
  row + sets `discovery_status='failed'`) **only after retries are exhausted**
  (`attemptsMade >= attemptsAllowed`, config = 2 attempts / fixed 5s). Part 11 replaces the
  body of `runDiscovery` — the stub comment says so explicitly: *"swap this body out once
  Part 11 lands, the wrapper below doesn't need to change."* Keep that contract.
- **`db/schema.ts` column names** ≠ log `field_name` enum. Map:
  | log `field_name` | `competitors` column | type |
  |---|---|---|
  | `subreddits` | `subreddits` | `text[]` NOT NULL default `{}` |
  | `greenhouse` | `greenhouse_token` | `text` nullable |
  | `lever` | `lever_token` | `text` nullable |
  | `pricing_url` | `pricing_url` | `text` nullable |
  | `rss_url` | `changelog_rss` | `text` nullable |
- **`competitor_discovery_log`** columns: `competitor_id, field_name, attempted_urls text[],
  discovered_value text nullable, status text, error_message text nullable, discovered_at`.
  CHECK: `status IN ('found','not_found','error')`, `field_name IN (the 5 above)`.
- **`DiscoveryLogSchema`** already in `packages/shared/src/signals.ts`:
  `{ field_name, attempted_urls: string[], discovered_value: string|null, status: 'found'|'not_found'|'error', error_message: string|null }`.
- **`DiscoveryStatusSchema`** = `pending | in_progress | complete | failed`.
- **`db/queries.ts` existing**: `getCompetitorById`, `getCompetitorDiscoveryLog`,
  `updateDiscoveryStatus(id, status)` — **throws on `'failed'`** (failures must route through a
  logging path). `createCompetitor` inserts only `{name, domain, discovery_status:'pending'}`.
- **`lib/retry.ts`**: `withRetry(fn, { maxAttempts?, baseDelayMs? })`.
- **HTTP convention** (from collectors): plain `fetch(url, { signal: AbortSignal.timeout(ms) })`,
  `cheerio` for HTML, `rss-parser` (`new Parser({ timeout })`) for feeds — all already deps.
- **Reddit**: the collector uses OAuth via a *private* (unexported) token helper. Do **not**
  export/refactor it for this. Use the unauthenticated `https://www.reddit.com/search.json`
  with header `User-Agent: process.env.REDDIT_USER_AGENT ?? "Signal/1.0"`.

## Locked deviations from the stub comment

1. **No web-search fallback for `pricing_url`.** No web-search infra exists anywhere in the repo
   and adding a search API client is out of scope for a no-LLM HTTP probe. Implement the path-
   probe list only (`/pricing, /plans, /price, /pricing-plans, /en/pricing, /en/plans`); if none
   return 200, log `status:'not_found'`. The log row makes it manually fixable — which is the
   stub's own stated design intent ("a 'failed' discovery is diagnosable and manually fixable
   from that log, not a silent gap"). Add a `docs/tech-debt.md` entry: "discovery pricing_url
   has no search fallback — path probe only".
2. **Per-field isolation.** One field's strategy throwing (network error, timeout, malformed
   response) is caught, logged as `status:'error'` with `error_message`, and the other 4 fields
   still run. The job as a whole throws **only** if the final DB write fails — that's the one
   thing the retry/`writeDiscoveryFailure` path should catch. Mirrors collectors' documented
   per-competitor isolation.
3. **`discovery_status` terminal values, written by Part 11 itself on the success path:**
   - Set `in_progress` at job start (`updateDiscoveryStatus(id, 'in_progress')`).
   - On completion: `complete` if ≥1 field got `status:'found'`, else `failed`.
   - `updateDiscoveryStatus` throws on `'failed'`, so the "all fields empty" → `failed` case
     goes through the new `finalizeDiscovery` query helper (Task 2), which writes the log rows
     **and** the status in one transaction — the same legitimate-exception shape as the existing
     `writeDiscoveryFailure`. Document why the guard is bypassed here.
   - The wrapper's retry-exhausted `writeDiscoveryFailure` path stays as-is for thrown-error
     cases (deviation 2's "DB write failed").
4. **Respect pre-filled fields.** Read the current `competitors` row first; skip discovery for
   any field already populated (`subreddits` non-empty, or the token/url columns non-null) and
   log nothing for it. This is how a Part 13 caller-supplied override will manifest (Part 13
   persists overrides; Part 11 just honours whatever's already on the row).
5. **`subreddits` defaults**: always include `r/SaaS` + `r/startups` (per stub), even on a
   `not_found` for the company-specific search. So `subreddits` is only `error` if the search
   HTTP call itself failed; otherwise `found` (with at least the 2 defaults) — never `not_found`.
   Store bare names (`SaaS`, `startups`) or `r/`-prefixed consistently with how `collectors/
   reddit.ts` reads `competitor.subreddits` — **check that first** and match it.

## Output shape (new — add to `packages/shared/src/signals.ts`)

```ts
export const CompetitorDiscoveryResultSchema = z.object({
  subreddits: z.array(z.string()),
  greenhouse_token: z.string().nullable(),
  lever_token: z.string().nullable(),
  pricing_url: z.string().nullable(),
  changelog_rss: z.string().nullable(),
  logs: z.array(DiscoveryLogSchema),
});
export type CompetitorDiscoveryResult = z.infer<typeof CompetitorDiscoveryResultSchema>;
```

Already barrel-exported via `index.ts` (`export * from "./signals"`).

## Tasks (TDD — failing test first for each)

### Task 1 — shared type
Add `CompetitorDiscoveryResultSchema` + type to `packages/shared/src/signals.ts`.
Test (`packages/shared/src/signals.test.ts`, co-located per current convention): parses a full
result; rejects a bad `logs[].status`; `.nullable()` fields accept `null`.

### Task 2 — query helper `finalizeDiscovery`
`apps/api/src/db/queries.ts`:
```ts
export async function finalizeDiscovery(
  competitorId: string,
  result: CompetitorDiscoveryResult,
): Promise<void>
```
One `db.transaction`:
- `UPDATE competitors SET subreddits=…, greenhouse_token=…, lever_token=…, pricing_url=…,
  changelog_rss=…, discovery_status = (any found ? 'complete' : 'failed'),
  discovered_at = now(), updated_at = now() WHERE id = …`
  (only set the columns whose field wasn't skipped — pass the merged final values in `result`).
- Bulk `INSERT` the `result.logs` into `competitor_discovery_log` (map `field_name` as-is —
  the log enum values are already the correct `field_name` strings; `discovered_value` =
  `log.discovered_value`).
Comment: this deliberately writes `discovery_status='failed'` without going through
`updateDiscoveryStatus`'s guard because it writes the diagnostic log rows in the same tx —
same exception rationale as `writeDiscoveryFailure`.
Tests (`db/queries.test.ts`): mock `db.transaction`; assert the update payload + the log-insert
values for a mixed found/not_found/error result, and that `discovery_status` is `failed` when
zero `found`.

### Task 3 — the agent
`apps/api/src/agents/discovery/competitor-discovery.ts`, export:
```ts
export async function discoverCompetitor(input: {
  competitor_id: string; name: string; domain: string;
}): Promise<CompetitorDiscoveryResult>
```
Structure: normalize `domain` (strip protocol/`www.`/trailing slash); build slug variants
(`domain` slug, `name` slug, strip `.com/.io`, strip hyphens). Run the 5 strategies; each
returns `{ value, log }` and never throws out (wrap each in try/catch → `error` log). Merge with
any pre-filled values from the passed-in current row state (caller passes them, or Task 4 reads
the row and passes). Return the assembled `CompetitorDiscoveryResult`.

Per-strategy detail from the stub header — subreddits (2 reddit `search.json` calls + rank by
count + top 5 + 2 defaults), greenhouse (`boards-api.greenhouse.io/v1/boards/{slug}/jobs`, 200 +
non-empty `jobs[]` = real), lever (`api.lever.co/v0/postings/{slug}`, 200 + non-empty array),
pricing (HEAD the 6 paths in order, first 200 wins), rss (try 9 feed paths in order, then parse
homepage `<link rel="alternate" type="application/rss+xml">`, first that `rss-parser` parses OK
wins). All fetches `AbortSignal.timeout(15_000)`. Wrap each network call in `withRetry(fn,
{ maxAttempts: 2 })` — cheap, and the queue only gives 2 job-level attempts.

Test file `apps/api/src/agents/discovery/competitor-discovery.test.ts` — `vi.stubGlobal("fetch",
…)` / mock `rss-parser`. Cases per strategy: happy path, all-miss → `not_found`, network throw →
`error` + other strategies unaffected, slug-variation fallthrough (first slug 404s, second 200s),
reddit ranking picks the higher-mention subreddit, pricing HEAD ordering (`/plans` 200 only when
`/pricing` already 404'd), rss homepage-`<link>` fallback, defaults always in `subreddits`.

### Task 4 — wire the processor
`queues/registry.ts`: replace `runDiscovery`'s `throw new NotImplementedError(...)` body with:
read the competitor row (`getCompetitorById`), `updateDiscoveryStatus(id,'in_progress')`, call
`discoverCompetitor({...job.data})` (passing pre-filled fields so the agent skips them), then
`finalizeDiscovery(competitor_id, result)`. Let a thrown error propagate (wrapper handles
circuit-breaker + retry + terminal `writeDiscoveryFailure`). Do **not** touch the wrapper, the
`failed` listeners, or `initWorkers`.
Test additions in `queues/registry.test.ts` (or a new `registry.discovery.test.ts` if the file's
already large): mock `discoverCompetitor` + the queries; assert `in_progress` set before,
`finalizeDiscovery` called with the result, and that a thrown `discoverCompetitor` still
rejects the processor (so BullMQ retries).

## Review (after all 4 tasks, per loop mechanics)

`typescript-reviewer` + `production-reviewer` in parallel on the Part 11 diff. `production-reviewer`
scope here: outbound HTTP timeout/retry bounds, one slow domain can't hang the job past
~5 × 15s, malformed external JSON/XML can't crash, the `finalizeDiscovery` tx is the only
throw-to-retry surface, no unbounded `attempted_urls` growth. No `security-reviewer` needed
(no auth, no raw user input beyond `name`/`domain` which only get slugified into URLs — but do
`encodeURIComponent` every interpolated slug, and confirm `domain` can't be `file://` or an
internal host: reject non-`http(s)` and bare-IP / `localhost` domains up front, log as `error`).
→ actually that last point pulls in SSRF surface — **include `security-reviewer`** for the
domain-normalization / URL-construction path.

## Verify

`npm run typecheck` (3 workspaces) · `npm test -w @signal/api` · `npm test -w @signal/shared`
· `npm run build` clean. Commit each task separately. Flip Part 11 → ✅ in `00-overview.md`,
then write `12-chat-agent.md`.
