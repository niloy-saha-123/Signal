---
name: signal-langgraph-js
description: Build or change Signal's LangGraph.js analysis graph, state, nodes, routing, fan-out, and run lifecycle. Use for apps/api/src/graph or analysis-agent orchestration; not for standalone ChatAgent or ordinary Express routes.
---

# Signal LangGraph.js

Read `apps/api/src/graph/state.ts`, `analysis-graph.ts`, and the affected node before editing. Treat
their implemented signatures and `.claude/loop/00-overview.md` as current truth.

## Invariants

- State is immutable: return a new partial state; never mutate the received object or nested arrays.
- Conditional edges are deterministic boolean logic, never an LLM decision.
- Preserve the five-way analysis fan-out and synthesis fan-in. A skipped branch returns `{}` so
  synthesis cannot run before its peers finish.
- Caller-owned state is runtime-validated: `competitor_id`, persisted `run_id`, and
  `has_pricing_diff`. Queue JSON is untrusted despite TypeScript types.
- Every node includes `getCompanyContext()` in its system prompt and uses the active prompt registry.
- Branch failures degrade deliberately only where the graph contract permits it; synthesis and run
  lifecycle failures remain observable.
- Apply wall-clock bounds at the worker boundary and complete/fail the `agent_runs` row exactly once.

## Verification

Write failing Vitest coverage for routing, immutable updates, skipped branches, parallel fan-in, and
failure behavior. Run the focused graph tests, API typecheck, then the complete API suite. Use
`langsmith-fetch` only when real trace evidence is needed.
