# Signal — Project CLAUDE.md

Layers on top of the global CLAUDE.md — both apply, this one wins on conflict.

## Stack
Node.js 20+/TypeScript 5, Express, LangGraph.js, BullMQ + Redis (Upstash),
PostgreSQL (Supabase), Pinecone, Zod, Next.js frontend. Multi-LLM: GPT-4o /
GPT-4o-mini (OpenAI) + Claude Sonnet / Haiku (Anthropic). Observability via
LangSmith. Deploys to Railway (API/worker) + Vercel (web).

## Product
Signal replaces a competitive analyst for product/growth teams at Series B+
B2B SaaS companies currently paying $40K+/year for Crayon/Klue plus analyst
time. Core primitives: Signal Score (0-100 composite threat score per
competitor, recomputed daily by SynthesisAgent) and temporal behavioral
fingerprinting (PatternDetector's historical pattern-matching phase, active
after 90 days of accumulated history per competitor) — this compounding
accuracy is the product moat, not a roadmap item. Dashboard is a command
center: Briefing (default view) → Radar (per-competitor trend) → Intel
(full filterable feed) → Chat (persistent, RAG-only). CommandBar (⌘K) is a
first-class UI component for cross-cutting actions (generate battlecard,
draft outreach, export brief).

## Current state (verified, not aspirational)
Reset on 2026-07-28 (see docs/decisions.md) — everything under
`apps/api/src/`, `apps/api/scripts/`, `packages/shared/src/`, and
`apps/web/{app,components,lib}/` is now an empty `// TODO: implement`
placeholder file, laid out per the file tree in the current README. Nothing
is implemented yet; this is Phase 0. `apps/web/app/layout.tsx` is the one
exception — kept intact since Next.js App Router needs it to build. The
prior implementation (Drizzle schema, Express/Socket.io routes, BullMQ
registry/scheduler, Pinecone utilities, LLM router) is recoverable from git
history (commit `d87fd11` and earlier) but is not in the working tree.
`apps/api/package.json` is still missing the LangChain ecosystem packages
(`@langchain/core`, `@langchain/anthropic`, `@langchain/openai`) plus
`cheerio`, `rss-parser`, `playwright` — install these before implementing
the graph/agents.

## Key architecture decisions (from the README — binding unless revisited)
- API server and BullMQ worker are separate Docker services — never run a slow
  Playwright scrape in the same process as Express.
- Pinecone namespacing enforced at the utility layer — `pineconeQuery()`
  requires `competitor_id` as a mandatory parameter, not optional.
- LangGraph state is immutable — every node returns a new object.
- Conditional routing uses no LLM — DAG branch decisions are deterministic
  boolean logic.
- PatternDetector separates SQL from LLM — volume counts run in Postgres,
  only synthesized interpretation goes to the model.
- `retrieval/` — unified retrieval pipeline. Always import from
  `retrieval/index.ts` not from individual files. Pipeline order is fixed:
  `hybridRetrieve` → `rerankChunks` → `enforceCitations`. Do not skip stages.

## Company Profile and Personalization

The `company_profile` table is single-row for now (single-tenant). `getCompanyContext()`
in `lib/company-context.ts` fetches it and formats it as a system prompt
injection, cached in Redis (`company:profile`, 1h TTL). Every analysis agent
must include this context:
```ts
const context = await getCompanyContext()
// inject into system prompt before calling LLM
```
If no profile exists, `getCompanyContext()` returns `""` — agents must still
work, just produce generic output rather than throwing.

`CompetitorDiscoveryAgent` runs once per competitor, never on a schedule.
Triggered by `POST /api/competitors`. Queue name: `competitor-discovery`. It
does NOT use an LLM — pure HTTP pattern matching (Reddit search API,
Greenhouse/Lever slug probing, pricing/RSS path probing).

User inputs to add a competitor: `name` + `domain` only. Everything else
(`subreddits`, `greenhouse_token`, `lever_token`, `pricing_url`,
`changelog_rss`) is auto-discovered and written back onto the `competitors`
row asynchronously — check `discovery_status` before assuming those fields
are populated.

## Conventions

Refusals are typed. ChatAgent returns `CitationResult` or `RefusalResult` —
both are valid outputs. Never treat `RefusalResult` as an error.

## Evaluation

`rag-eval.ts` is a CI gate. Do not modify the faithfulness threshold without
updating the corresponding GitHub Actions env var.
`seed-rag-eval.ts` is run once. The golden dataset is manually curated — do
not auto-generate or overwrite existing entries.

## Relevant skills
`langgraph-js-patterns` and `ai-service-infra-patterns` are the primary ones
for this codebase — not `python-patterns` (this project uses LangGraph.js,
not Python LangGraph).

## Deploy
Merge to main triggers GitHub Actions → Railway. Guarded by
`guard-production-ops.sh` — requires `.claude/approved-for-prod` marker.

## Tooling reference
See `docs/tooling.md` for the full catalogue of active skills, agents, hooks,
and MCP servers relevant to this project.

## Documentation discipline
Before finalizing any commit: consider whether it represents a real
architectural/design decision. If so, log it in docs/decisions.md.

Real incident or non-obvious bug root cause → docs/postmortems.md.
Smaller "wish I'd known" moment → docs/lessons.md.
Deliberate shortcut taken on purpose → docs/tech-debt.md.
Routine changes, version bumps, typical fixes → don't log. Use judgment —
the goal is a vault worth reading later, not a complete record of everything.

Periodically (suggested: after each roadmap phase — e.g. once the 7 agents +
5 collectors move from stubs to real implementations) ask Claude to review
`docs/architecture.md` against the actual current codebase and update it —
don't let it silently drift from what's really built.

## Skills and MCP Setup

### Connected MCP servers
- **Supabase** — execute SQL, inspect schema, get logs
  Tool prefix: `mcp__supabase__`
  Added via `claude mcp add supabase --transport http ... --scope local`
- **GitHub** — read issues, check CI, view commits, PRs
  Tool prefix: `mcp__github__`
  Official remote server (`https://api.githubcopilot.com/mcp`) — the older
  `@modelcontextprotocol/server-github` npm package is deprecated, don't use it.
  Added via `claude mcp add-json github ... --scope local`
- **Pinecone** — query vectors, inspect namespaces
  Tool prefix: `mcp__pinecone__`
  Added via `claude mcp add pinecone --command npx --args "-y @pinecone-database/mcp" --scope local`
- **Upstash** — account/database management and monitoring only
  Tool prefix: `mcp__upstash__`
  Added via `claude mcp add upstash --command npx --args "-y @upstash/mcp-server" --scope local`
  **Scope caveat:** this MCP does NOT expose live Redis key inspection or
  BullMQ job state — it only manages/monitors databases (create, memory
  usage, backups, QStash/workflow logs) via the Upstash account API. Do not
  reach for it when debugging stuck queues or inspecting job payloads. For
  that, use the BullMQ Board dashboard (`bull-board` package) or
  `redis-cli -u $REDIS_URL` directly.

All four are added with `--scope local` (writes to the user's own
`~/.claude.json`) — there is no `.mcp.json` in this repo and no token is
ever committed.

### Project skills installed
Located in `.claude/skills/`

- **drizzle-orm** — Drizzle schema, query, and migration patterns
- **langsmith-fetch** — Fetch and interpret LangSmith traces
- **supabase-agent** — Signal-specific Supabase residue only (RLS shape,
  Drizzle migration ordering, MCP tool prefix) — pairs with the official
  `supabase`/`supabase-postgres-best-practices` skills below, doesn't
  duplicate them
- **signal-schema** — Database table descriptions and relationships (sourced
  from the schema.ts stub comments — regenerate once the real Drizzle
  schema is implemented)
- **signal-scraping** — Playwright, Cheerio, and collector patterns
- **signal-frontend** — Dashboard design system and component patterns

`signal-architecture` was deliberately not created — it would have
duplicated the "Key architecture decisions" section already in this file,
which is loaded every session regardless.

### Official vendor skills/plugins installed (global, not project-scoped)
- **supabase**, **supabase-postgres-best-practices** — official Supabase
  agent skills (`supabase/agent-skills`), installed via `npx skills add`.
  Symlinked from `.agents/skills/` into `.claude/skills/`. Broad Supabase/
  Postgres coverage — load before `supabase-agent` for anything generic.
- **pinecone** plugin (`pinecone-plugins` marketplace,
  `pinecone-io/pinecone-claude-code-plugin`) — official Pinecone skills
  (query, mcp, quickstart, full-text-search, assistant, cli, docs, n8n) plus
  slash commands. Installed alongside, not instead of, the manually-added
  `pinecone` MCP server — no conflict, single MCP entry.
- **upstash** plugin (`upstash` marketplace, `upstash/skills`) — official
  Upstash skills for Redis, QStash, Ratelimit, Vector, Workflow, Box, CLI.
- No official GitHub-specific Claude Code skill package exists as of this
  writing (checked) — the GitHub MCP server ships no bundled skill.

### How skills activate
Skills auto-activate when their description matches the task. You can also
trigger explicitly: "Use the signal-scraping skill."

<!-- code-graph-mcp:begin v2 -->
## Code Graph (repo-wide AST index)

AST + FTS + vector index of the whole repo — prefer over multi-round Grep/Read for
structural queries (LSP only sees open files; this sees everything). Fastest path = Bash CLI:

| Intent | Command |
|--------|---------|
| Who calls X / what X calls | `code-graph-mcp callgraph X` |
| Impact before editing a fn | `code-graph-mcp impact X` |
| Unfamiliar dir / module | `code-graph-mcp overview <dir>` |
| Symbol source / signature | `code-graph-mcp show X` |
| Concept search (no exact name) | `code-graph-mcp search "…"` (vector: MCP `semantic_code_search`) |
| grep + AST context | `code-graph-mcp grep "pat" [paths] [-t lang] [-g glob] [-c]` |

Still use Grep for literal strings/regex in non-code files; still Read files you'll edit.
Full command + MCP-tool table: `.claude/plugin_code_graph_mcp.md`
<!-- code-graph-mcp:end -->
