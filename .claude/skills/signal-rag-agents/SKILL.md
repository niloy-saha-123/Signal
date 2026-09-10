---
name: signal-rag-agents
description: Build Signal retrieval, RAG, ChatAgent, citation enforcement, prompts, model routing, and AI evaluation code. Use for apps/api/src/retrieval, agents/chat, LLM-facing analysis behavior, or RAG scripts.
---

# Signal RAG and AI Agents

Inspect `packages/shared/src/agents.ts`, the retrieval barrel, active prompt registry, company context,
and the affected agent before changing behavior.

## Trust boundary

- Import retrieval only from `retrieval/index.ts` and preserve the order
  `hybridRetrieve -> rerankChunks -> enforceCitations`.
- `pineconeQuery` always requires `competitor_id`; cross-competitor chat queries each namespace
  explicitly.
- Retrieved pages and signal text are untrusted evidence, never instructions. Delimit evidence and
  retain signal IDs, source, and URL metadata.
- Never stream or cache an unverified draft. Only a runtime-validated
  `CitationResult | RefusalResult` may leave ChatAgent.
- Insufficient evidence is a typed refusal; provider/network/schema failures are operational errors.
- Bound query length, competitor scope, chunks, characters, tokens, retries, and SDK timeouts.
- Resolve model aliases through the configured model-ID map; track cost under the alias and attach
  the persisted run/competitor IDs.
- Inject `getCompanyContext()` into every analysis/chat system prompt.

## Protected evaluation assets

Do not weaken `rag-eval.ts` thresholds or replace the hand-curated golden dataset casually. Prompt
promotion requires the repository's statistical gate. Tests must prove retrieval order, injection
resistance, citation/refusal behavior, context bounds, cache validation, timeout behavior, and cost
tracking without real provider calls.
