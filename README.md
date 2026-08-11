# Signal

Autonomous competitive intelligence engine for B2B SaaS founders and product teams.

Signal collects signals across six sources, runs them through a quality-scoring and semantic deduplication pipeline, analyzes them with a multi-agent LangGraph system, and pushes real-time alerts when a competitor makes a move that creates a window for you to act. Every alert includes a chain of evidence, a confidence score backed by historical backtesting, and specific recommended actions.

---

## Motivation

Competitive intelligence tools automate collection. None automate judgment.

Crayon tells you a competitor changed their pricing page. Klue surfaces a new job posting. A human still has to figure out what it means and what to do about it — usually in a spreadsheet, usually too late.

Signal is the judgment layer. You add a competitor once and it runs permanently. When something matters, you find out before your competitor announces it publicly.

---

## How It Works

**Collection.** Five BullMQ agents run on staggered schedules, pulling signals from Reddit, Hacker News, public job boards, RSS changelogs, and pricing pages. No LLMs in the collection layer — just data ingestion with proper rate limiting, deduplication, and retry logic.

**Processing pipeline.** Every incoming signal passes through three stages before storage: a quality scorer that weights signals by source authority, engagement, and recency; a semantic deduplicator that merges signals describing the same event across different sources; and an entity extractor that pulls structured data (prices, product names, feature names) into queryable JSONB.

**Analysis.** A LangGraph.js directed graph runs six LLM agents daily. Agents run in parallel where independent, conditionally where appropriate, and sequentially where order matters. Each agent uses the model best suited to its task. Every output is Zod-validated with a self-correcting retry loop.

**Evaluation.** Predictions are validated against historical ground truth through a backtesting harness. Every prompt change is gated by a regression test suite with a two-proportion z-test before promotion. LangSmith traces every LangGraph node execution and state transition, and logs every LLM call with model, tokens, cost, and latency.

**Output.** Real-time alerts via Socket.io. A RAG-powered chat interface over all accumulated intelligence. A minimal Next.js dashboard for visualization and the demo.

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

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND  (Next.js)                       │
│  Competitor dashboard · Signal feed · Chat · Alert history      │
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
│  │  signals · clusters · pricing_diffs · agent_runs · costs  │  │
│  └──────────────────────────────┬────────────────────────────┘  │
│                                 │                                │
│  ┌──────────────────────────────▼────────────────────────────┐  │
│  │  ANALYSIS LAYER  ·  LangGraph.js directed graph           │  │
│  │                                                           │  │
│  │  IntentAnalyzer ──── parallel ──── SentimentClusterer    │  │
│  │  GPT-4o                             Claude Haiku          │  │
│  │        │                                  │              │  │
│  │  ChangeDetector ─────────────── PatternDetector          │  │
│  │  GPT-4o-mini (conditional)        GPT-4o + RAG            │  │
│  │        │                                  │              │  │
│  │  ┌─────▼──────────────────────────────────▼───────────┐  │  │
│  │  │        VulnerabilityWindowDetector                 │  │  │
│  │  │          GPT-4o  ·  Claude Sonnet                  │  │  │
│  │  └──────────────────────────┬─────────────────────────┘  │  │
│  │                             │                             │  │
│  │  ┌──────────────────────────▼─────────────────────────┐  │  │
│  │  │  SynthesisAgent  ·  Claude Sonnet                  │  │  │
│  │  │  alert decision  ·  confidence score               │  │  │
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

### Data

| | |
|---|---|
| **PostgreSQL (Neon.tech)** | Primary store — competitors, signals, signal_clusters, pricing_diffs, agent_runs, prompt_versions, agent_test_cases, circuit_events, llm_costs, alerts. |
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

### Frontend

| | |
|---|---|
| **Next.js** | Dashboard — competitor setup, signal feed, alert history, chat |
| **Recharts** | Mention volume trends, sentiment over time, department hiring charts |
| **Socket.io client** | Real-time alert display |

### Infra

| | |
|---|---|
| **Docker + docker-compose** | Four services: `api`, `worker`, `postgres`, `redis`. API and worker are separate — background processing does not share a process with the HTTP server. |
| **GitHub Actions** | Type check and test on every push. Deploy to Render on merge to main. |
| **Render** | API and worker deployed as separate services. |
| **Vercel** | Next.js frontend. |
| **LangSmith** | Native LangGraph tracing: every node execution, state transition, and LLM call logged automatically. Prompt versioning, evaluation datasets, and a debugging UI for agent runs. |

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

**QualityScorer** assigns a `quality_score` from 0.0–1.0 using source authority, log-scaled engagement, and exponential recency decay (λ = 0.0096, half-life ~72h). Score propagates into Pinecone metadata and PatternDetector weighting.

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
Two-phase. Phase 1: PostgreSQL aggregates signal volume weighted by `quality_score` over 30 days — no LLM cost for counting. Phase 2: three Pinecone semantic queries ("negative feedback", "product improvements", "pricing concerns"), top 50 chunks each, passed to GPT-4o for trend synthesis. Data gaps caused by circuit breaker open periods are flagged and excluded from trend windows rather than interpreted as zero activity.

**VulnerabilityWindowDetector** `GPT-4o + Claude Sonnet`
GPT-4o handles strategic analysis: identifies the vulnerable customer segment, estimates the window duration, assesses opportunity magnitude. Claude Sonnet handles copy generation: positioning language, ICP description, outreach subject lines. Two models because the tasks require different capabilities and the copy is read by humans.

**SynthesisAgent** `Claude Sonnet`
Receives all agent outputs from LangGraph graph state. Incorporates `corroboration_count` from the deduplication layer into confidence calculation. Selects the active prompt version from the registry. Decides: real-time alert, weekly digest entry, or suppress.

**ChatAgent** `Claude Sonnet`
Real-time, not background. Embeds the user query, queries Pinecone across selected competitor namespaces with quality-weighted retrieval, passes top 20 chunks to Claude Sonnet, streams the response via SSE. Citations link to original signal records in PostgreSQL.

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

Every prompt change is gated by a regression suite. Promotion requires a two-proportion z-test at p < 0.05 against the labeled test case database. Every production run records `prompt_version_id` for full audit trail. A/B routing available for shadow testing in production.

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

## Key Architecture Decisions

**API server and BullMQ worker run as separate Docker services.** Playwright scrapes are slow and CPU-bound. Sharing a process with the HTTP server degrades API latency. Separation also lets the worker scale independently.

**Processing pipeline sits between collection and storage.** Quality scoring, deduplication, and entity extraction run on every signal before it reaches PostgreSQL or Pinecone. Downstream agents always operate on clean, enriched, deduplicated data from the moment it exists — not as a retroactive batch.

**LangGraph state is immutable.** Every node receives `AnalysisGraphState` and returns a new partial state object. No mutation. Six agents sharing state with in-place mutation produces bugs that are nearly impossible to trace. Immutable transitions make every state change explicit.

**Conditional routing uses no LLM.** ChangeDetector fires on a boolean check in a conditional edge function. Deterministic, zero latency, zero cost. Not every decision in an agent system needs a model.

**PatternDetector separates SQL from LLM.** Volume counts and quality-weighted metrics run in PostgreSQL. Only the interpretation step goes to GPT-4o. Deterministic computation stays deterministic.

**Deduplication threshold is empirically derived.** 0.88 was chosen from a precision/recall analysis at five threshold values on 200 labeled signal pairs — not by intuition. The calibration script is in `scripts/dedup-calibration.ts` and reproducible.

**Prompt changes require statistical evidence.** A two-proportion z-test at p < 0.05 against a labeled test suite is required before promoting any prompt version. Version history and evaluation results live in PostgreSQL. The process is in `scripts/promote.ts`.

**Circuit breaker state lives in Redis; events in PostgreSQL.** State must be shared across all worker instances in real time — Redis. Circuit event history is append-only structured data that PatternDetector queries to identify data gaps — PostgreSQL.

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
│           ├── signals.ts               # Signal + cluster schemas
│           ├── pricing.ts               # PricingSnapshot + structured diff
│           ├── prompts.ts               # PromptVersion schema
│           └── socket-events.ts         # Socket.io event payload types
│
└── apps/
    ├── api/                             # Backend: Express + BullMQ + LangGraph
    │   ├── src/
    │   │   ├── api/                     # Express routes + Socket.io server
    │   │   │   ├── competitors.ts       # CRUD + manual analysis trigger
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
    │   │   │   │   ├── pattern-detector.ts
    │   │   │   │   ├── vulnerability-detector.ts
    │   │   │   │   └── synthesis.ts
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
    │   │   │   │                        # circuit_events, llm_costs, alerts
    │   │   │   └── queries.ts
    │   │   │
    │   │   ├── vector/
    │   │   │   └── pinecone.ts          # Namespaced query (competitor_id required)
    │   │   │                            # quality_score-weighted metadata filtering
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
    │   │       └── retry.ts             # Exponential backoff wrapper
    │   │
    │   ├── worker.ts                    # BullMQ worker entry point
    │   └── scripts/
    │       ├── backfill.ts              # Historical data ingestion
    │       ├── backtest.ts              # Backtesting harness + report
    │       ├── eval.ts                  # Prompt regression test runner
    │       ├── promote.ts               # Prompt promotion with z-test
    │       └── dedup-calibration.ts     # Threshold calibration on labeled pairs
    │
    └── web/                             # Frontend: Next.js dashboard
        ├── app/
        │   ├── page.tsx                 # Competitor list + add form
        │   ├── competitors/[id]/
        │   │   └── page.tsx             # Signal feed + charts + alert history
        │   ├── chat/
        │   │   └── page.tsx             # RAG chat with SSE streaming
        │   └── alerts/
        │       └── page.tsx             # Full alert history
        ├── components/
        │   ├── SignalFeed.tsx            # Real-time feed via Socket.io
        │   ├── AlertBanner.tsx          # Alert push without page refresh
        │   ├── TrendChart.tsx           # Mention volume + sentiment (Recharts)
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

---

## Roadmap

The current build covers the full intelligence loop: collect → process → analyze → alert → dashboard. Planned next:

- G2 and Capterra review ingestion (free public review data, high SMB sentiment signal)
- Slack and email alert delivery
- Temporal behavioral fingerprinting — per-competitor pattern memory for probability-weighted predictions
- BuiltWith API integration (tech stack detection) post-validation of unit economics

Paid data source integrations (Semrush, Similarweb, Ahrefs) are deferred until the core loop demonstrates value. The interesting engineering problem is extracting maximum signal from public sources — not paying for a premium API.

---

## License

MIT
