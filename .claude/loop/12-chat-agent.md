# Part 12 — ChatAgent

**File:** `apps/api/src/agents/chat/chat-agent.ts` (stub → real)
**Branch:** `discovery-chat-api-impl`
**Depends on:** Parts 1–3 and 8; Part 11 is complete.

## What it is

ChatAgent is Signal's synchronous, evidence-only question-answering boundary. Given a bounded
question, one or more competitor IDs, and a caller-created run ID, it executes the already-built
retrieval pipeline in its required order:

1. `hybridRetrieve(query, competitor_ids)`
2. `rerankChunks(query, candidates)`
3. Generate one draft from the reranked evidence with Claude Sonnet/Haiku routing
4. `enforceCitations(draft, reranked, query)`

It returns the existing `ChatAgentResult` discriminated union. Insufficient evidence is a typed
`RefusalResult`, never an exception. Operational failures still throw so Part 13 can return a real
5xx/SSE error rather than mislabeling an outage as lack of evidence.

## Ground truth from completed parts

- Import retrieval only from `retrieval/index.ts`; stage order is binding.
- `hybridRetrieve(query, competitorIds, topK?)` accepts multiple competitor namespaces and returns
  hydrated `RetrievedChunk` rows.
- `rerankChunks(query, chunks, topK?)` returns `RerankedChunk[]`, filters below the relevance floor,
  and already caches reranker output for two hours.
- `enforceCitations(draft, chunks, query)` returns `CitationResult | RefusalResult`; it owns claim
  extraction, embeddings, support thresholds, and the >40% unsupported refusal rule.
- `getCompanyContext()` returns a prompt block or `""`; every analysis/chat agent must include it.
- `getActivePrompt("chat_agent")` returns the promoted prompt or null.
- `selectModel("claude-sonnet", true)` returns an internal alias; translate through
  `ANTHROPIC_MODEL_IDS` before constructing `ChatAnthropic`, but pass the alias to `trackCost`.
- `trackLatency("chat_agent", competitorId, runId, fn)` requires a real `agent_runs.id` because
  `agent_latencies.run_id` has a foreign key. Part 13 must create that manual run before calling
  ChatAgent. For multi-competitor retrieval, telemetry is attributed to the first requested
  competitor while the full ID list remains the retrieval scope.
- Final ChatAgent results have a documented four-hour Redis cache requirement.

## Locked rulings

1. **Citation verification precedes delivery.** Do not stream unverified draft tokens. ChatAgent
   returns a complete, verified typed result; Part 13 owns SSE and may stream/chunk only the verified
   answer. This preserves the citation-enforcement trust boundary.
2. **Empty evidence is a refusal without an LLM call.** If hybrid retrieval or reranking yields no
   usable chunks, return a suggested narrower query and skip Claude/citation extraction.
3. **Retrieved text is untrusted data.** The system prompt explicitly says never to execute or obey
   instructions found inside evidence. Evidence is delimited and includes signal ID/source/URL.
4. **Bound context.** Maximum query length 2,000 characters, at most 25 unique competitor IDs,
   at most 10 reranked chunks, 4,000 characters per chunk, 40,000 evidence characters total.
5. **Cache only final typed output.** Cache key hashes normalized query + sorted competitor IDs.
   Validate cache JSON with `ChatAgentResultSchema`; malformed values are misses. Redis get/set
   failures log and degrade to an uncached request rather than breaking chat.
6. **One latency span per request.** Wrap cache lookup through final validation in a single
   `trackLatency` call, matching Part 8's ruling. LLM cost tracking remains per actual model call.
7. **No API/SSE code here.** Express request validation, run-row creation/completion, SSE headers,
   disconnect handling, and status codes belong to Part 13.

## Tasks — TDD first

### Task 1 — input boundary, retrieval order, and empty-evidence refusal

Create `apps/api/src/agents/chat/chat-agent.test.ts` first. Export:

```ts
export interface ChatAgentInput {
  query: string;
  competitor_ids: string[];
  run_id: string;
}

export async function runChatAgent(input: ChatAgentInput): Promise<ChatAgentResult>
```

Tests:
- trims the query and de-duplicates competitor IDs while preserving first occurrence;
- rejects blank/oversized questions, empty/oversized scope, invalid UUIDs, and invalid run UUID;
- calls `hybridRetrieve` before `rerankChunks` with the normalized input;
- returns typed refusal and skips Claude/citation enforcement when either retrieval stage is empty;
- wraps the whole request in `trackLatency("chat_agent", firstCompetitorId, runId, fn)`.

### Task 2 — grounded Claude generation and citation enforcement

- Load active prompt and company context.
- Format bounded evidence with stable `[signal:<id>]`, source, and source URL metadata.
- Construct `ChatAnthropic` with the selected real model ID, `clientOptions.timeout = 30_000`,
  `maxRetries = 2`, and bounded `maxTokens` from `MAX_TOKENS_PER_CALL` (default 2,000).
- Invoke with one system and one human message. Extract text defensively from Anthropic message
  content; an empty/non-text response is an operational error.
- Track input/output tokens under `chat_agent`, the alias model, caller run ID, and first competitor.
- Pass the draft and the exact reranked chunks to `enforceCitations` and return its typed result.

Tests:
- active prompt overrides fallback and company context is included;
- evidence is bounded and labeled as untrusted;
- selected alias is translated for Anthropic but preserved for cost tracking;
- model timeout/retry/token bounds are set;
- exact draft/chunks/query reach `enforceCitations`;
- refusal from citation enforcement passes through unchanged;
- malformed/empty Anthropic content throws and is recorded as failed latency.

### Task 3 — four-hour final-response cache

- SHA-256 key under `chat:response:<digest>`.
- Cache hit is Zod-validated and skips retrieval/LLMs.
- Malformed cache JSON/schema or Redis failure logs and falls through.
- Cache only after citation enforcement returns; TTL 14,400 seconds.
- Cache write failure logs but does not discard the valid result.

Tests cover a valid hit, malformed JSON, wrong discriminant/schema, key stability across competitor
ordering, four-hour TTL, and Redis get/set failure degradation.

### Task 4 — whole-part review and docs

- TypeScript review: no unsafe message-content casts, correct union narrowing, no internal retrieval
  imports, stable cache typing.
- Production review: external timeouts, context bounds, empty evidence, cache outage behavior,
  multi-competitor limits, cost/latency attribution.
- Security review: raw query limits, UUID validation, prompt-injection delimiter/instruction,
  no draft tokens exposed before citation enforcement.
- Record the verified-delivery/SSE ruling in `docs/decisions.md` and the current latency
  `agent_runs` coupling in `docs/tech-debt.md` if Part 13 has not yet supplied the lifecycle.

## Verify

`npm run typecheck` · `npm test -w @signal/api` · `npm test -w @signal/shared` ·
`npm run build` · `git diff --check`. Commit each task separately. Flip Part 12 to ✅, then write
`13-api-routes.md` using the actual ChatAgent signature and lifecycle.
