# Signal Phase 2 — Agents + Collectors Build Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement each part's plan task-by-task.

**Goal:** Turn all 41 `export {}` stub files under `apps/api/src/` (+ the stub schemas in
`packages/shared/src/`) into working, tested code — the 7-8 analysis/discovery/chat agents,
5 collectors, and every supporting layer they depend on.

**Branch:** `agents-collectors-impl`, branched off `database_schema` (not `main` — `main`
predates the real schema/discovery-agent/company-context work; see decisions.md 2026-09-08).

**Spec:** every stub file's own header comment is the spec for that file — read it before
writing its plan/tests. `README.md`, `docs/how-to-build.md`, `docs/architecture.md` are the
project-level spec (`docs/` is a symlink to the Obsidian vault).

## Global constraints (binding, from CLAUDE.md — apply to every part below)

- API server and BullMQ worker are separate processes — never run Playwright or other slow
  collector work inside Express request handling.
- `pineconeQuery()` requires `competitor_id` as a mandatory parameter, never optional.
- LangGraph state is immutable — every node returns a new state object.
- Conditional routing between graph nodes is deterministic boolean logic — never an LLM call.
- PatternDetector: volume/count math runs in SQL; only interpretation goes to the LLM.
- Import retrieval only from `retrieval/index.ts`; pipeline order is fixed:
  `hybridRetrieve` → `rerankChunks` → `enforceCitations`. Do not skip stages.
- `getCompanyContext()` must be injected into every analysis/chat agent's system prompt, and
  must return `""` (not throw) when no `company_profile` row exists.
- Refusals are typed, not errors — `ChatAgent` returns `CitationResult | RefusalResult`.
- Every part: TDD (failing test first), then `typescript-reviewer` + `production-reviewer`
  (+ `security-reviewer` if the part touches auth or raw user input), then commit. No `git push`
  or PR without asking first.
- `rag-eval.ts`'s faithfulness threshold and `seed-rag-eval.ts`'s golden dataset are off-limits
  to casual edits (CI gate / manually curated — see project CLAUDE.md).

## Dependency-ordered parts

Numbered in build order — each part's plan file is written just before that part starts,
informed by what the previous parts actually produced (exact function signatures, not
speculative ones). Status legend: ⬜ not started · 🟨 in progress · ✅ done.

| # | Part | Files | Plan file | Status |
|---|------|-------|-----------|--------|
| 0 | Infra prep | package installs, vitest test runner | (done inline, no plan file needed) | ✅ |
| 1 | Shared types | `packages/shared/src/{signals,agents,pricing,prompts,socket-events,index}.ts` | `01-shared-types.md` | ✅ |
| 2 | Foundational utils | `lib/{logger,retry,latency-tracker,company-context}.ts`, `reliability/circuit-breaker.ts`, `vector/pinecone.ts` | `02-foundational-utils.md` | ✅ |
| 3 | LLM layer | `llm/{cost-tracker,prompt-registry,adaptive-router}.ts` | `03-llm-layer.md` | ✅ |
| 4 | Queue infra | `queues/{registry,scheduler}.ts` | `04-queue-infra.md` | ✅ |
| 5 | DB queries | `db/queries.ts` | `05-db-queries.md` | ✅ |
| 6 | Collectors | `collectors/{reddit,hn,jobs,changelog,pricing}.ts` | `06-collectors.md` | ✅ |
| 7 | Signal pipeline | `pipeline/{entity-extractor,quality-scorer,deduplicator}.ts` | `07-pipeline.md` | ✅ |
| 8 | Retrieval pipeline | `retrieval/{hybrid-retrieval,reranker,citation-enforcer,index}.ts` | `08-retrieval.md` | ✅ |
| 9 | Graph state + DAG | `graph/{state,analysis-graph}.ts` | `09-graph.md` | ✅ |
| 10 | Analysis agents | `agents/analysis/{intent-analyzer,sentiment-clusterer,change-detector,pattern-detector,vulnerability-detector,synthesis}.ts` | `10-analysis-agents.md` | ✅ |
| 11 | Discovery agent | `agents/discovery/competitor-discovery.ts` | `11-discovery-agent.md` | ✅ |
| 12 | Chat agent | `agents/chat/chat-agent.ts` | `12-chat-agent.md` | ✅ |
| 13 | API routes | `api/{competitors,signals,alerts,chat,company-profile}.ts` | `13-api-routes.md` | 🟨 |
| R | Test-file restructure (chore, not a feature part) | move all `*.test.ts` out of `src/` into a top-level `test/` tree | `TEST-RESTRUCTURE.md` | ⬜ |

**Branching:** Parts 1-10 are merged to `main` (PRs #1, #2). Parts 11-13 run on branch
`discovery-chat-api-impl` (cut off `main` 2026-09-09). Part R runs on its **own** branch cut
off `main` after 11-13 merge — it is a mechanical move touching ~41 files and reviews cleaner
in isolation.

Parts 6 (collectors) and 11 (discovery agent) have no dependency on parts 7-10 and could run
in parallel with them once part 5 (db queries) lands, if subagent capacity allows — noted per
part when it applies.

## Known agent/skill gaps to fill as they're hit

- No dedicated "collector/BullMQ testing" reviewer exists — `typescript-reviewer` +
  `production-reviewer` (queue retry/backpressure/cleanup focus) cover it; only author a new
  `.claude/agents/*.md` subagent if a part's review needs surface a repeated gap those two
  don't close.
- `skill-creator` (official Anthropic plugin, `claude-plugins-official` marketplace) is already
  installed — use it if a part needs a genuinely new reusable *skill* (not a subagent). For new
  *subagent* types, hand-author `.claude/agents/*.md` following the existing agents' frontmatter
  pattern (see e.g. `.claude/agents/typescript-reviewer.md` if present, or the agent list in the
  system prompt).

## Discovered gaps (found while planning, not in the original 41-stub inventory)

- **No `db/client.ts`** — no Drizzle/`pg` connection/pool module exists anywhere in
  `apps/api/src/`. `lib/latency-tracker.ts` (part 2) needs to write to `agent_latencies`
  directly, and `db/queries.ts` (part 5) needs the same underlying client — both would
  otherwise open their own duplicate connections. Add `db/client.ts` (new file, single
  exported `db` Drizzle instance built from `process.env.DATABASE_URL`) as the first task
  of part 2, before `lib/latency-tracker.ts`.
- **No part currently invokes/schedules the analysis graph.** `queues/registry.ts` (Part 4)
  declares an `"analysis"` `QueueName` with a `QUEUE_CONFIG` entry, but no
  `registerWorker("analysis", ...)` call exists anywhere, and `queues/scheduler.ts` only
  cron-schedules the 5 `collect-*` queues — nothing enqueues `"analysis"` jobs or calls
  `analysisGraph.invoke()` (Part 9's compiled export). The product spec requires Signal Score
  recomputed daily, which needs a trigger. Whichever future part builds this worker must also:
  seed `AnalysisGraphState`'s caller-owned fields (`competitor_id`, `run_id`,
  `has_pricing_diff`, per `graph/state.ts`'s own header comment) and validate them at runtime
  (TypeScript's compile-time requiredness gives no protection against malformed BullMQ job
  JSON) before calling `.invoke()`. Most likely candidate: Part 13 (API routes) or a
  `scheduler.ts` update — raise this again when that part's plan is written. Discovered during
  Part 9 planning/whole-part review (production-reviewer), not fixed there (out of that part's
  file scope).
  - **The future analysis-queue worker must also impose a wall-clock timeout / `AbortSignal`
    on `analysisGraph.invoke()`** (Part 10 whole-part review, prod-M5): `getCompanyContext()`
    (ioredis, no `commandTimeout`) and `patternDetector`'s `hybridRetrieve → embedText` have
    no timeout, so a hung Redis/embeddings endpoint hangs the whole graph run and strands a
    worker slot. Details in `docs/tech-debt.md` (Part 10 section).
  - **`createSignalScore` is not idempotent under BullMQ retry** (Part 10 whole-part review,
    H2 step 2): no unique constraint on `competitor_signal_scores (competitor_id, day)`, plain
    INSERT. Part 10's fix wave reordered the INSERT after a successful decision call to shrink
    the window, but the real fix (partial unique index + upsert, or a deterministic job id +
    no synthesis re-run on retry) is this worker's responsibility. Needs a migration.

- **Part 10 corrected a Part-9 DAG wiring defect.** Part 9 wired
  `addConditionalEdges(START, has_pricing_diff ? "changeDetector" : "synthesis")`; on the
  `false` path that scheduled `synthesisNode` in superstep 1, parallel with the branch nodes,
  so it computed the daily Signal Score from `null` branch outputs. Fixed on
  `analysis-agents-impl` (commit `bf12370`): `changeDetector` is now an unconditional `START`
  branch with its skip logic moved into the node, so the 5-way fan-in always gates synthesis.
  Also on that branch: the 5 branch nodes now degrade (log + return `{}`) instead of failing
  the whole graph run on an LLM/DB error, and every branch LLM call plus synthesis has a daily
  budget hard-stop. See `docs/decisions.md` 2026-09-09.

## Loop mechanics

This is running as a self-paced `ScheduleWakeup` loop in the current session — it survives
while this terminal session stays open, not after it closes. Each wake:
1. Check `TaskList`/dispatched subagent status for the in-flight part.
2. On completion: run the part's tests + typecheck, dispatch the review agents, apply fixes,
   commit **each task/part separately** (never batch multiple tasks into one commit), flip its
   status to ✅ here, write the next part's plan file, dispatch it.
3. **Do not `git push`/merge mid-branch.** Only once this branch's *entire* backlog (every row in
   the table above) is ✅: push it, then merge it (real merge, not just an ask — 2026-09-08
   correction: merging promptly is how integration bugs across parts get caught, not deferred
   to "everything done" later). If the merge target is `main`, `guard-production-ops.sh` requires
   `.claude/approved-for-prod` — that gate stands as-is; surface it at that moment rather than
   bypassing it, but don't treat it as a reason to stop and ask about the merge itself again.
   Per-task landing and clean review is not a push/merge trigger by itself — only full-branch
   completion is.
4. Re-arm `ScheduleWakeup` unless the whole table is ✅ (→ push + ask to merge, then stop) or a
   real blocker needs the user.

## Context handoff (~300k tokens)

If conversation context is approaching ~300k tokens, stop mid-loop (finish the in-flight task's
commit first, don't leave a half-done task uncommitted) and write a handoff file to
`.claude/loop/HANDOFF.md` covering: current branch, exact commit hash HEAD is at, which part/task
is next per the table above, any open SDD ledger state (`.superpowers/sdd/<part>/progress.md` if
one is mid-flight), and any pending rulings not yet surfaced to the user. Tell the user the
handoff is written and that they can `/clear` the session — resuming just means pointing a fresh
session at `.claude/loop/00-overview.md` + `.claude/loop/HANDOFF.md`.
