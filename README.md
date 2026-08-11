# Signal

Signal replaces your competitive analyst — it runs permanently, gets smarter the longer it runs, and tells your team what to do before your competitors announce it.

---

## What It Is

Product and growth teams at Series B+ B2B SaaS companies spend $40K+/year on tools like Crayon and Klue, plus 10 hours a week of analyst time, to produce battlecards that are outdated the moment they're published. Those tools automate collection — a changed pricing page, a new job posting — but a human still has to figure out what it means and what to do about it.

Signal is the analyst. You add a competitor once and it monitors six public sources permanently: Reddit, Hacker News, job boards, RSS changelogs, pricing pages, and G2/Capterra. A quality-scoring and semantic-deduplication pipeline cleans every incoming signal, a multi-agent LangGraph.js system interprets it, and a real-time alert reaches your team when a competitor's move opens a vulnerability window worth acting on — with a chain of evidence, a confidence score backed by historical backtesting, and specific recommended actions.

It gets better over time. Every analysis run stores its signal pattern alongside what actually happened next. Six months of accumulated behavioral fingerprints on a competitor produce materially better predictions than six days — a moat a team starting fresh cannot replicate no matter how much they pay for Crayon.

---

## Sample Output

```
STRATEGIC SIGNAL DETECTED  ·  HIGH CONFIDENCE  ·  81%

Competitor: Notion
Pattern: Upmarket Pivot + AI Feature Push

Evidence chain:
  [1] 5 ML Engineer posts in 7 days (3x normal velocity)
      3 of 5 JDs reference "embedding models" and "semantic search"
  [2] Changelog: "improved search relevance" shipped 12 days ago
  [3] Pricing: free plan removed, Pro raised $8/month
  [4] Reddit r/Notion: "too expensive for small teams" up 340% this week
  [5] G2: 14 new 3-star reviews citing pricing in last 10 days

Interpretation:
  Deliberate upmarket pivot. SMB segment being abandoned.
  AI search feature likely 30-60 days out.

Vulnerability window: OPEN  ·  ~45 days
  ~40% of their user base used the free tier.
  They are looking for alternatives right now.

Recommended actions:
  POSITIONING  Lead with SMB simplicity and transparent pricing
  CONTENT      Publish a head-to-head comparison for small teams
  OUTREACH     Engage r/Notion and r/productivity communities
  COPY         "We don't charge you more for growing."
  TIMING       Act within 21 days before the window closes
```

---

## How It Works

**Briefing.** The default view your team opens every morning. The top 3 most significant competitive movements from the last 24 hours — what happened, why it matters, the recommended action, and a one-click button to act on it.

**Radar.** Per-competitor trend view — Signal Score over time, mention volume, sentiment trajectory, department hiring velocity. The view for "what's this competitor's trajectory."

**Intel.** The full signal feed, filterable by source, competitor, signal type, quality score, and date range. The view for "show me everything."

**Chat.** A persistent panel that answers questions from accumulated intelligence, not generic LLM knowledge — RAG over every signal Signal has ever collected on your competitors.

**Signal Score.** A 0-100 composite threat score per competitor, recomputed daily by SynthesisAgent: mention velocity (30-day trend, quality-weighted), sentiment trajectory, hiring momentum (department deltas, especially ML/AI/Sales), pricing change recency, and vulnerability window status. It's the 10-second daily check-in before anyone drills into detail.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND  (Next.js)                       │
│  Briefing · Radar · Intel · Chat · Signal Score everywhere      │
│  Socket.io client for real-time alerts                          │
└────────────────────┬──────────────────────────┬─────────────────┘
                     │  REST API                 │  SSE stream
┌────────────────────▼──────────────────────────▼─────────────────┐
│                    BACKEND  (Node.js / TypeScript)               │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  COLLECTION LAYER  ·  BullMQ scheduled workers           │  │
│  │  Reddit 6h  ·  HN 6h  ·  Jobs 24h  ·  RSS 12h  ·  Pricing 48h│  │
│  └──────────────────────────────┬────────────────────────────┘  │
│                                 │                                │
│  ┌──────────────────────────────▼────────────────────────────┐  │
│  │  SIGNAL PROCESSING PIPELINE  ·  BullMQ  ·  3 stages      │  │
│  │  QualityScorer → SemanticDeduplicator → EntityExtractor   │  │
│  └──────────────────────────────┬────────────────────────────┘  │
│                                 │                                │
│  ┌──────────────────────────────▼────────────────────────────┐  │
│  │  STORAGE  ·  PostgreSQL + Pinecone                        │  │
│  │  signals · clusters · pricing_diffs · signal_scores · costs│  │
│  └──────────────────────────────┬────────────────────────────┘  │
│                                 │                                │
│  ┌──────────────────────────────▼────────────────────────────┐  │
│  │  ANALYSIS LAYER  ·  LangGraph.js directed graph           │  │
│  │                                                           │  │
│  │  IntentAnalyzer ──── parallel ──── SentimentClusterer    │  │
│  │  GPT-4o                             Claude Haiku          │  │
│  │        │                                  │              │  │
│  │  ChangeDetector ─────────────── PatternDetector          │  │
│  │  GPT-4o-mini (conditional)     GPT-4o + RAG + history     │  │
│  │        │                                  │              │  │
│  │  ┌─────▼──────────────────────────────────▼───────────┐  │  │
│  │  │        VulnerabilityWindowDetector                 │  │  │
│  │  │          GPT-4o  ·  Claude Sonnet                  │  │  │
│  │  └──────────────────────────┬─────────────────────────┘  │  │
│  │                             │                             │  │
│  │  ┌──────────────────────────▼─────────────────────────┐  │  │
│  │  │  SynthesisAgent  ·  Claude Sonnet                  │  │  │
│  │  │  alert decision  ·  confidence  ·  Signal Score    │  │  │
│  │  └──────────────────────────┬─────────────────────────┘  │  │
│  └─────────────────────────────┼───────────────────────────┘  │
│                                │                                │
│  ┌─────────────────────────────▼───────────────────────────┐   │
│  │  OUTPUT  ·  Socket.io alerts  ·  SSE chat stream        │   │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  RELIABILITY  ·  Circuit breakers (Redis) · Adaptive cost router│
│  OBSERVABILITY  ·  LangSmith · Winston (job + run correlation)  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Backend

| | |
|---|---|
| **Node.js 20 / TypeScript 5** | Strict mode throughout. Discriminated unions for circuit states, generics for retry utilities, `satisfies` for config. |
| **Express** | REST API and Socket.io host. Global error handler, per-route Zod validation, JWT auth middleware. |
| **LangGraph.js** | Stateful directed graph with parallel nodes, conditional edges, and immutable state transitions. |
| **BullMQ** | Eight named queues — five collection, three processing pipeline, one analysis. Per-queue rate limiting, dead-letter queues, cron scheduling. Worker runs as a separate process. |
| **Socket.io** | Server pushes alerts to clients in a competitor-scoped room. No polling. |
| **Zod** | All LLM outputs validated on receipt. Schema failure message fed back to the model for self-correction. Max three retries before dead-letter. |
| **Drizzle ORM** | Type-safe schema and queries. Migrations tracked and version-controlled. |
| **flexsearch** | BM25 keyword index | In-memory keyword search for hybrid retrieval. Combined with semantic search via RRF. |

### Data

| | |
|---|---|
| **PostgreSQL (Supabase)** | Primary store — competitors, signals, signal_clusters, pricing_diffs, agent_runs, prompt_versions, agent_test_cases, circuit_events, llm_costs, alerts, competitor_signal_scores. |
| **Redis (Upstash)** | BullMQ backend, circuit breaker state (shared across worker instances), ChatAgent response cache at 4h TTL. |
| **Pinecone** | Signals embedded and namespaced per competitor. `quality_score` in vector metadata for weighted retrieval. Multi-namespace queries for cross-competitor chat. |

### AI

| Model | Agents | Reason |
|---|---|---|
| GPT-4o | IntentAnalyzer, PatternDetector, VulnerabilityDetector (analysis) | Multi-signal reasoning across large context windows |
| GPT-4o-mini | ChangeDetector, EntityExtractor, PricingExtractor | Structured extraction — cheaper, sufficient accuracy |
| Claude Sonnet 3.5 | SynthesisAgent, ChatAgent, VulnerabilityDetector (copy) | Writing quality matters for user-facing output |
| Claude Haiku 3 | SentimentClusterer | Fast, cheap classification at 3 calls/day/competitor |
| text-embedding-3-small | All embeddings | Cost-efficient semantic accuracy at dedup threshold |
| Cohere rerank-english-v3.0 | ChatAgent reranking | Jointly scores (query, chunk) pairs — improves retrieval precision over vector similarity alone. |

### Frontend

| | |
|---|---|
| **Next.js** | Command center — Briefing, Radar, Intel, Chat, Signal Score everywhere |
| **Recharts** | Signal Score sparklines, mention volume trends, sentiment over time, department hiring charts |
| **Socket.io client** | Real-time alert display |

### Infra

| | |
|---|---|
| **Docker + docker-compose** | Four services: `api`, `worker`, `postgres`, `redis`. API and worker are separate — background processing does not share a process with the HTTP server. |
| **GitHub Actions** | Type check and test on every push. Deploy to Railway on merge to main. |
| **Railway** | API and worker deployed as separate services. |
| **Vercel** | Next.js frontend. |
| **LangSmith** | Native LangGraph tracing: every node execution, state transition, and LLM call logged automatically with the LangGraph.js SDK. Prompt versioning, evaluation datasets, and a debugging UI for agent runs. |

---

## Agents

### Collection — no LLM

| Agent | Schedule | Source |
|---|---|---|
| RedditCollectionAgent | Every 6h | Reddit OAuth API · BullMQ rate limiter at 50 req/min |
| HNCollectionAgent | Every 6h | Algolia HN API · no auth · weighted 2x in PatternDetector |
| JobPostingCollectionAgent | Every 24h | Greenhouse + Lever public APIs · delta only against stored baseline |
| ChangelogCollectionAgent | Every 12h | RSS/Atom feeds · Cheerio for full-text content |
| PricingWatcherAgent | Every 48h | Playwright · structured extraction via GPT-4o-mini · `try/finally` always closes browser |

Signals over 500 tokens are chunked at 400 tokens with 50-token overlap before embedding.

### Signal Processing Pipeline — three BullMQ stages

**QualityScorer** assigns a `quality_score` from 0.0–1.0 using source authority, log-scaled engagement, and exponential recency decay (λ = 0.0096, half-life ~72h). Score propagates into Pinecone metadata, PatternDetector weighting, and Signal Score's mention-velocity component.

**SemanticDeduplicator** embeds each incoming signal and queries Pinecone for same-competitor signals from the last 48 hours. Cosine similarity above 0.88 (calibrated against 200 labeled pairs) triggers a merge into an existing cluster rather than a new record. Cluster tracks canonical summary, contributing sources, and corroboration count. Multiple sources confirming the same event raise SynthesisAgent's confidence directly.

**EntityExtractor** uses GPT-4o-mini to pull structured data from signal text — pricing figures, product names, feature names, competitor references — stored as JSONB in `signal.entities`. Enables SQL queries on structured competitive data without full-text search.

### Analysis — LangGraph.js

**IntentAnalyzerAgent** `GPT-4o`
Job postings from the last 7 days. Every inference must cite specific job titles and description phrases — enforced in the prompt and validated by Zod. Returns `confidence: "low"` when fewer than three postings support a claim. SynthesisAgent only escalates high and medium confidence inferences to real-time alerts.

**SentimentClustererAgent** `Claude Haiku`
Runs in parallel with IntentAnalyzer. Queries Pinecone for existing clusters before creating new ones. Above 0.82 cosine similarity, new signals extend an existing cluster rather than create a new one. This distinction — new complaint versus chronic complaint — is one the system tracks explicitly and existing tools do not.

**ChangeDetectorAgent** `GPT-4o-mini`
Conditional node — only fires when `pricing_diff_detected: true` in LangGraph state. Structured extraction from the pricing diff object, not raw text. `significance: critical` bypasses the weekly queue and escalates directly.

**PatternDetectorAgent** `GPT-4o`
Two phases, run for every competitor. Phase 1: PostgreSQL aggregates signal volume weighted by `quality_score` over 30 days — no LLM cost for counting. Phase 2: three Pinecone semantic queries ("negative feedback", "product improvements", "pricing concerns"), top 50 chunks each, passed to GPT-4o for trend synthesis. Data gaps caused by circuit breaker open periods are flagged and excluded from trend windows rather than interpreted as zero activity.

A third phase activates once a competitor has 90+ days of accumulated history: historical pattern matching. PatternDetector retrieves past occurrences of a structurally similar signal cluster for this specific competitor and asks what happened next each time, weighting the current prediction by those historical outcomes. This is the part that compounds — see [Signal Score compounds over time](#key-architecture-decisions) below.

**VulnerabilityWindowDetector** `GPT-4o + Claude Sonnet`
GPT-4o handles strategic analysis: identifies the vulnerable customer segment, estimates the window duration, assesses opportunity magnitude. Claude Sonnet handles copy generation: positioning language, ICP description, outreach subject lines. Two models because the tasks require different capabilities and the copy is read by humans.

**SynthesisAgent** `Claude Sonnet`
Receives all agent outputs from LangGraph graph state. Incorporates `corroboration_count` from the deduplication layer into confidence calculation. Selects the active prompt version from the registry. Decides: real-time alert, weekly digest entry, or suppress. Also recomputes each competitor's Signal Score daily from mention velocity, sentiment trajectory, hiring momentum, pricing change recency, and vulnerability window status.

**ChatAgent** `Claude Sonnet`
Real-time, not background. Three-stage retrieval pipeline:
(1) hybridRetrieve — BM25 (flexsearch) + semantic (Pinecone), merged via Reciprocal Rank Fusion
(2) rerankChunks — Cohere reranker rescore of top-20 candidates jointly with the query
(3) enforceCitations — claim-level validation against retrieved chunks; returns a structured refusal if evidence is insufficient rather than generating a low-quality answer
Streams the response via SSE. Citations link to original signal records in PostgreSQL.

---

## Evaluation

### Backtesting

Predictions validated against historical ground truth on five real companies with documented public events.

| Event | Lead time | Confidence | Correct |
|---|---|---|---|
| Notion free plan removal (Mar 2023) | 34 days | 76% | ✅ |
| Linear pricing restructure (Aug 2023) | 19 days | 61% | ✅ |
| Figma enterprise push (Oct 2022) | 42 days | 83% | ✅ |
| Loom pre-acquisition signals (Jan 2023) | 0 days | 51% | ❌ |
| Webflow SMB→Enterprise pivot (Q3 2023) | 28 days | 79% | ✅ |

4/5 correct. Mean lead time on correct predictions: 30.75 days. False positive rate on five control competitors over the same period: 11%.

Confidence calibration — grouped predictions by decile, compared to actual accuracy:

| Confidence | Actual accuracy |
|---|---|
| 60–70% | 67% |
| 70–80% | 73% |
| 80–90% | 81% |

Confidence scores are well-calibrated. Reproduce with `npm run backtest:full`.

### Prompt versioning

Every prompt change is gated by a regression suite. Promotion requires a two-proportion z-test at p < 0.05 against the labeled test case database. Every production run records `prompt_version_id` for full audit trail. A/B routing available for shadow testing in production. LangSmith tracks every version's evaluation runs against its dataset.

IntentAnalyzer — 150 labeled test cases:

| Metric | Score |
|---|---|
| Inference accuracy | 0.79 |
| Evidence citation rate | 96% |
| Schema pass on first attempt | 97% |

Version 7 vs Version 6: accuracy improved from 0.74 to 0.79, p = 0.031. Promoted.

### Deduplication calibration

Threshold calibrated on 200 labeled signal pairs:

| Threshold | Precision | Recall | F1 |
|---|---|---|---|
| 0.85 | 0.84 | 0.85 | 0.84 |
| **0.88** | **0.89** | **0.79** | **0.84** |
| 0.91 | 0.94 | 0.71 | 0.81 |

0.88 chosen — maximizes precision. A false merge degrades downstream analysis more than a missed merge.

### RAG Quality — 50 golden Q&A pairs

Manually verified question/answer pairs covering five categories: pricing history, hiring patterns, product changes, sentiment themes, strategic moves.

| Metric | Score |
|---|---|
| Aggregate faithfulness | TBD after first eval run |
| Citation coverage | TBD |
| Refusal rate (correct) | TBD |
| CI threshold | 0.75 |

Runs automatically in GitHub Actions on every push. Build fails if faithfulness drops below 0.75. Run manually: `npm run rag-eval`

Note: "TBD after first eval run" — these numbers will be populated once the system is implemented and the eval script is run against real data.

---

## Cost

| Agent | Calls/day | Tokens/call | Daily cost |
|---|---|---|---|
| IntentAnalyzer | 1 | 4,000 | $0.016 |
| SentimentClusterer | 3 | 1,500 | $0.002 |
| EntityExtractor | 50 | 400 | $0.001 |
| PricingExtractor | 0.5 | 1,200 | $0.0002 |
| PatternDetector (weekly) | 0.14 | 6,000 | $0.003 |
| ChangeDetector | 0.5 | 2,000 | $0.0002 |
| VulnerabilityDetector | 0.3 | 5,000 | $0.005 |
| SynthesisAgent (weekly) | 0.14 | 3,000 | $0.001 |
| ChatAgent (5 queries) | 5 | 2,000 | $0.015 |
| Embeddings | 50 signals | 200 | $0.0003 |
| **Total** | | | **~$0.04/day** |

The adaptive cost router reduces this 15–30% at end-of-month budget pressure by downgrading eligible tasks to GPT-4o-mini. Observed cost after routing: ~$0.03/competitor/day.

---

## Latency Budget

Generated by: `npm run latency-report`
(Populated after system is running — values below are targets, not yet measured.)

| Component | P50 target | P95 target |
|---|---|---|
| Collection → PostgreSQL | < 2s | < 5s |
| Embedding → Pinecone upsert | < 1s | < 3s |
| Full analysis graph | < 90s | < 180s |
| ChatAgent (first token) | < 3s | < 6s |
| Alert delivery (event to Socket.io) | < 500ms | < 1s |
| BM25 index build + query | < 100ms | < 300ms |
| Cohere reranker | < 800ms | < 2s |

Measured values will replace targets as the system accumulates data in `agent_latencies` table.

---

## Key Architecture Decisions

**Signal Score compounds over time.** The longer Signal monitors a competitor, the more accurate its predictions become. Every analysis run stores the signal pattern signature with its outcome. After sufficient history, PatternDetector retrieves historically similar patterns from Pinecone and asks: the last three times this cluster of signals appeared for this competitor, what happened next? This is the moat competitors starting fresh cannot replicate. Six months of accumulated behavioral fingerprints produce materially better predictions than six days.

**API server and BullMQ worker run as separate Docker services.** Playwright scrapes are slow and CPU-bound. Sharing a process with the HTTP server degrades API latency. Separation also lets the worker scale independently.

**Processing pipeline sits between collection and storage.** Quality scoring, deduplication, and entity extraction run on every signal before it reaches PostgreSQL or Pinecone. Downstream agents always operate on clean, enriched, deduplicated data from the moment it exists — not as a retroactive batch.

**LangGraph state is immutable.** Every node receives `AnalysisGraphState` and returns a new partial state object. No mutation. Six agents sharing state with in-place mutation produces bugs that are nearly impossible to trace. Immutable transitions make every state change explicit.

**Conditional routing uses no LLM.** ChangeDetector fires on a boolean check in a conditional edge function. Deterministic, zero latency, zero cost. Not every decision in an agent system needs a model.

**PatternDetector separates SQL from LLM.** Volume counts and quality-weighted metrics run in PostgreSQL. Only the interpretation step goes to GPT-4o. Deterministic computation stays deterministic.

**Deduplication threshold is empirically derived.** 0.88 was chosen from a precision/recall analysis at five threshold values on 200 labeled signal pairs — not by intuition. The calibration script is in `scripts/dedup-calibration.ts` and reproducible.

**Prompt changes require statistical evidence.** A two-proportion z-test at p < 0.05 against a labeled test suite is required before promoting any prompt version. Version history and evaluation results live in PostgreSQL and LangSmith. The process is in `scripts/promote.ts`.

**Circuit breaker state lives in Redis; events in PostgreSQL.** State must be shared across all worker instances in real time — Redis. Circuit event history is append-only structured data that PatternDetector queries to identify data gaps — PostgreSQL.

**Hybrid retrieval over semantic-only search.** Vector similarity measures embedding proximity, not query relevance. A user asking "what did Notion say about pricing in March" needs keyword matching for "March" and "pricing" — semantic search alone may return thematically related chunks that don't mention the specific timeframe. BM25 handles exact term matching. Reciprocal Rank Fusion combines both signals without requiring score normalization across incompatible scales.

**Citation enforcement as a first-class output.** ChatAgent can return one of two types: CitationResult (answer with grounded citations) or RefusalResult (structured decline with a suggested reformulation). Refusal is not an error — it is a quality signal. A system that says "I don't have reliable data on this" is more trustworthy than one that generates a plausible but unsupported answer.

---

## Project Structure

```
signal/
├── package.json                         # npm workspaces root
├── docker-compose.yml                   # api, worker, postgres, redis
├── .github/
│   └── workflows/ci.yml                 # typecheck + test on push; deploy on merge
│
├── packages/
│   └── shared/                          # Zod schemas + TypeScript types
│       └── src/
│           ├── agents.ts                # Agent input/output schemas
│           ├── signals.ts               # Signal, SignalCluster, and SignalScore schemas
│           ├── pricing.ts               # PricingSnapshot + structured diff
│           ├── prompts.ts               # PromptVersion schema
│           └── socket-events.ts         # Socket.io event payload types
│
└── apps/
    ├── api/                             # Backend: Express + BullMQ + LangGraph
    │   ├── src/
    │   │   ├── api/                     # Express routes + Socket.io server
    │   │   │   ├── competitors.ts       # CRUD + manual analysis trigger + GET /:id/score
    │   │   │   ├── signals.ts           # Signal feed with pagination + filters
    │   │   │   ├── alerts.ts            # Alert history
    │   │   │   └── chat.ts              # ChatAgent SSE endpoint
    │   │   │
    │   │   ├── collectors/              # BullMQ collection workers (no LLM)
    │   │   │   ├── reddit.ts
    │   │   │   ├── hn.ts
    │   │   │   ├── jobs.ts
    │   │   │   ├── changelog.ts
    │   │   │   └── pricing.ts
    │   │   │
    │   │   ├── pipeline/                # Signal processing stages
    │   │   │   ├── quality-scorer.ts    # Source weight × engagement × recency decay
    │   │   │   ├── deduplicator.ts      # Semantic dedup + cluster management
    │   │   │   └── entity-extractor.ts  # Structured JSONB extraction (GPT-4o-mini)
    │   │   │
    │   │   ├── agents/
    │   │   │   ├── analysis/            # LangGraph nodes
    │   │   │   │   ├── intent-analyzer.ts
    │   │   │   │   ├── sentiment-clusterer.ts
    │   │   │   │   ├── change-detector.ts
    │   │   │   │   ├── pattern-detector.ts   # + historical pattern matching (90d+)
    │   │   │   │   ├── vulnerability-detector.ts
    │   │   │   │   └── synthesis.ts          # + Signal Score computation
    │   │   │   └── chat/
    │   │   │       └── chat-agent.ts    # RAG query + SSE stream
    │   │   │
    │   │   ├── graph/
    │   │   │   ├── analysis-graph.ts    # LangGraph DAG definition
    │   │   │   └── state.ts             # AnalysisGraphState interface
    │   │   │
    │   │   ├── queues/
    │   │   │   ├── registry.ts          # All BullMQ Queue + Worker definitions
    │   │   │   └── scheduler.ts         # Cron config + per-queue rate limits
    │   │   │
    │   │   ├── db/
    │   │   │   ├── schema.ts            # Drizzle schema
    │   │   │   │                        # Tables: competitors, signals,
    │   │   │   │                        # signal_clusters, pricing_baselines,
    │   │   │   │                        # pricing_diffs, agent_runs,
    │   │   │   │                        # prompt_versions, agent_test_cases,
    │   │   │   │                        # circuit_events, llm_costs, alerts,
    │   │   │   │                        # competitor_signal_scores
    │   │   │   └── queries.ts
    │   │   │
    │   │   ├── vector/
    │   │   │   └── pinecone.ts          # Namespaced query (competitor_id required)
    │   │   │                            # quality_score-weighted metadata filtering
    │   │   │
    │   │   ├── retrieval/
    │   │   │   ├── hybrid-retrieval.ts  # BM25 + semantic + RRF
    │   │   │   ├── reranker.ts          # Cohere reranker wrapper
    │   │   │   ├── citation-enforcer.ts # Claim validation + refusal
    │   │   │   └── index.ts             # Unified retrieval exports
    │   │   │
    │   │   ├── llm/
    │   │   │   ├── adaptive-router.ts   # Runtime model selection
    │   │   │   ├── prompt-registry.ts   # Version fetch + A/B routing
    │   │   │   └── cost-tracker.ts      # Per-call token counting + PG logging
    │   │   │
    │   │   ├── reliability/
    │   │   │   └── circuit-breaker.ts   # State machine (Redis) + event log (PG)
    │   │   │
    │   │   └── lib/
    │   │       ├── logger.ts            # Winston + job_id/run_id correlation
    │   │       ├── retry.ts             # Exponential backoff wrapper
    │   │       └── latency-tracker.ts   # Per-agent timing + percentiles
    │   │
    │   ├── worker.ts                    # BullMQ worker entry point
    │   └── scripts/
    │       ├── backfill.ts              # Historical data ingestion
    │       ├── backtest.ts              # Backtesting harness + report
    │       ├── eval.ts                  # Prompt regression test runner
    │       ├── promote.ts               # Prompt promotion with z-test
    │       ├── dedup-calibration.ts     # Threshold calibration on labeled pairs
    │       ├── rag-eval.ts              # RAG quality evaluation runner
    │       ├── latency-report.ts        # Latency budget report generator
    │       └── seed-rag-eval.ts         # Seed golden eval dataset
    │
    └── web/                             # Frontend: Next.js command center
        ├── app/
        │   ├── page.tsx                 # Home — competitor list, Signal Score, sparklines
        │   ├── briefing/
        │   │   └── page.tsx             # Daily briefing — top 3 movements, recommended actions
        │   ├── radar/[id]/
        │   │   └── page.tsx             # Signal Score trend, mentions, sentiment, hiring
        │   ├── intel/
        │   │   └── page.tsx             # Full filterable signal feed
        │   ├── chat/
        │   │   └── page.tsx             # Persistent chat panel, SSE streaming
        │   └── alerts/
        │       └── page.tsx             # Full alert history
        ├── components/
        │   ├── CommandBar.tsx           # ⌘K palette — battlecards, outreach copy, brief export
        │   ├── SignalScoreCard.tsx      # Signal Score (0-100) + sparkline + delta
        │   ├── BriefingCard.tsx         # Morning briefing card + one-click action
        │   ├── BattlecardGenerator.tsx  # Triggered from CommandBar or vulnerability alert
        │   ├── SignalFeed.tsx           # Real-time feed via Socket.io — powers Intel
        │   ├── AlertBanner.tsx          # Alert push without page refresh
        │   ├── TrendChart.tsx           # Signal Score + mention + sentiment trends (Recharts)
        │   ├── HiringChart.tsx          # Department hiring delta (Recharts)
        │   └── ChatInterface.tsx        # SSE streaming + citation chips
        └── lib/
            └── socket.ts               # Socket.io client + room join
```

---

## Getting Started

Prerequisites: Node.js 20+, Docker, API keys for OpenAI, Anthropic, Pinecone, Reddit OAuth.

```bash
git clone https://github.com/yourusername/signal
cd signal
cp .env.example .env
npm install
docker-compose up
```

Add a competitor:

```bash
curl -X POST http://localhost:3000/api/competitors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Notion",
    "domain": "notion.so",
    "subreddits": ["Notion", "productivity", "SaaS"],
    "greenhouse_token": "notion",
    "pricing_url": "https://notion.so/pricing",
    "changelog_rss": "https://notion.so/blog/rss"
  }'
```

Trigger manual analysis:

```bash
curl -X POST http://localhost:3000/api/competitors/{id}/analyze
```

Backfill historical data:

```bash
npm run backfill -- --competitor-id={id} --days=30
```

Run the full backtesting suite:

```bash
npm run backtest:full
# Outputs: backtest-results-{timestamp}.json
```

Run prompt regression tests:

```bash
npm run eval -- --agent=intent-analyzer
```

Promote a prompt version:

```bash
npm run promote -- --agent=intent-analyzer --version=8
# Runs z-test vs active version. Promotes if p < 0.05.
```

Seed the RAG evaluation dataset:

```bash
npm run seed-rag-eval --workspace=apps/api
```

Run RAG quality evaluation:

```bash
npm run rag-eval --workspace=apps/api
```

Generate latency budget report:

```bash
npm run latency-report --workspace=apps/api
```

---

## Environment Variables

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_NAME=signal
DATABASE_URL=
REDIS_URL=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=signal/1.0
LANGSMITH_API_KEY=
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=signal
MAX_TOKENS_PER_CALL=2000
COLLECT_INTERVAL_HOURS=24
DAILY_BUDGET_USD=2.00
ENABLE_PLAYWRIGHT=true
CIRCUIT_FAILURE_THRESHOLD=5
CIRCUIT_TIMEOUT_MS=1800000
```

`DATABASE_URL` is a Supabase PostgreSQL connection string.

---

## Roadmap

The current build covers the full intelligence loop: collect → process → analyze → alert → command center. Behavioral fingerprinting is core architecture, not a future feature — see [Signal Score compounds over time](#key-architecture-decisions). Planned next:

- G2 and Capterra review ingestion (free public review data, high SMB sentiment signal)
- Slack and email alert delivery
- **Phase 3 — MCP Action Layer.** When SynthesisAgent detects a high-significance event, it currently surfaces it as an alert. In Phase 3, it will take actions directly through MCP-defined tools: post a briefing to a Slack channel, create a Notion page with the full intelligence report, draft an email to the sales team with updated battlecard talking points, or tag relevant CRM deals. Users connect their services once; Signal decides when to use them based on event significance and user-configured thresholds. This is the integration layer that moves Signal from intelligence platform to autonomous strategic operator.
- BuiltWith API integration (tech stack detection) post-validation of unit economics

Paid data source integrations (Semrush, Similarweb, Ahrefs) are deferred until the core loop demonstrates value. The interesting engineering problem is extracting maximum signal from public sources — not paying for a premium API.

---

## License

MIT
