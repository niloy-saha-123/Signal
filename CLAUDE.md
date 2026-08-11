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
