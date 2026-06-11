# Signal

**Autonomous competitive strategy intelligence engine**

Signal monitors competitors across six signal sources, reasons across everything with AI, identifies strategic vulnerability windows, and recommends what to do — with a full chain of evidence and a confidence score.

---

## The Problem

Competitive intelligence tools automate **collection**. None of them automate **judgment**.

Crayon tells you a competitor changed their pricing page. Klue surfaces a new job posting. Visualping sends a diff. A human still has to figure out what it means, why it matters, and what to do.

That human is you, at midnight, in a spreadsheet.

## The Solution

Signal is the judgment layer that has been missing. You add a competitor once; Signal runs permanently.

Scheduled agents collect signals every few hours across Reddit, Hacker News, job boards, changelogs, and pricing pages. Analysis agents process those signals — clustering customer sentiment, inferring product strategy from hiring patterns, detecting pricing changes. A synthesis agent decides what is significant and pushes a real-time alert when something matters. A RAG-powered chat interface lets you query your entire competitive history in plain English.

This is not a dashboard that displays data. It is an autonomous system that decides what matters, explains the causal chain behind it, and tells you what to do before your competitor makes the move public.

### Example Output

```
STRATEGIC SIGNAL DETECTED — HIGH CONFIDENCE

Competitor: Notion
Pattern: Upmarket Pivot + AI Feature Push

Evidence chain (5 signals):
  [1] 5 ML Engineer posts in 7 days (3x normal velocity)
      → 3 of 5 JDs mention "embedding models" and "semantic search"
  [2] Changelog: "improved search relevance" shipped 12 days ago
  [3] Pricing page: Free plan removed. Pro tier raised $8/month.
  [4] Reddit r/Notion: "too expensive for small teams" up +340% this week
  [5] G2: 14 new 3-star reviews citing pricing in last 10 days

Interpretation (81% confidence):
  Notion is executing a deliberate upmarket pivot, abandoning the SMB
  segment to compete in Enterprise. They are 30–60 days from shipping
  a major AI search feature.

Vulnerability window: OPEN — estimated 45 days
  ~40% of their user base used the free tier. They are actively
  looking for alternatives right now.

Recommended actions:
  POSITIONING  Emphasize simplicity and transparent SMB pricing
  CONTENT      Publish "Notion vs [You] for small teams" comparison page
  OUTREACH     Target r/Notion and r/productivity with migration messaging
  COPY         "We don't charge you more for growing. Simple pricing, forever."
  TIMING       Act within 21 days before the migration window closes.
```

Every existing tool shows you one sentence of this. Signal shows you the full paragraph — with the recommended action at the bottom.

---

## Tech Stack

### Core Backend

| Technology | Role | Why |
|---|---|---|
| **Node.js 20+** | Runtime | Industry standard for async-heavy backend systems |
| **TypeScript 5** | Language | Strict typing across 11 agent input/output schemas prevents entire classes of runtime bugs |
| **Express** | HTTP server | REST API + Socket.io host |
| **LangGraph.js** | Agent orchestration | Stateful directed graph with parallel nodes, conditional edges, and checkpointing |
| **BullMQ** | Job queue | Per-queue retry logic, rate limiting, dead-letter queues, and cron scheduling on Redis |
| **Socket.io** | WebSockets | Real-time alert push when significant events are detected |
| **Zod** | Schema validation | Every LLM output validated on receipt; self-correcting retry loop on schema failure |

### Data Layer

| Technology | Role | Why |
|---|---|---|
| **PostgreSQL** (Neon.tech) | Primary database | Competitors, raw signals, intelligence outputs, baselines, run logs, alert history |
| **Redis** (Upstash) | Queue backend + cache | BullMQ backend; ChatAgent response cache at 4h TTL |
| **Pinecone** | Vector store | Signals embedded and stored per competitor namespace; semantic search for RAG and cluster detection |

### AI / LLMs

| Model | Used For | Why |
|---|---|---|
| **GPT-4o** | IntentAnalyzer, PatternDetector, VulnerabilityDetector (analysis) | Complex multi-signal reasoning across large context windows |
| **GPT-4o-mini** | ChangeDetector | Structured extraction from diffs — cheaper, no deep reasoning needed |
| **Claude Sonnet 3.5** | SynthesisAgent, ChatAgent, VulnerabilityDetector (copy) | User-facing writing quality and persuasive copy |
| **Claude Haiku 3** | SentimentClusterer | Fast, cheap classification |
| **text-embedding-3-small** | All signal embeddings | Cost-efficient semantic accuracy for RAG and clustering |

### Scraping / Data Sources

| Technology | Used For |
|---|---|
| **Playwright** | Pricing pages (JS-rendered); always closed in `try/finally` |
| **Cheerio** | Static content (changelog full-text, article bodies) |
| **rss-parser** | Changelog and blog RSS/Atom feeds |
| **Reddit OAuth API** | Community mentions and sentiment |
| **Algolia HN API** | Hacker News mentions — free, no auth |
| **Greenhouse / Lever public APIs** | Competitor job postings — fully public, no auth |

### Observability / Ops

| Technology | Role |
|---|---|
| **Braintrust** | Every LLM call logged: model, prompt, output, tokens, cost, latency |
| **Winston** | Structured logging with BullMQ job correlation IDs |

### Frontend

| Technology | Role |
|---|---|
| **Next.js** | Competitor dashboard, signal feed, chat interface, alert history |
| **Recharts** | Mention volume trends, sentiment over time, department hiring charts |
| **Socket.io client** | Real-time alert display without polling |

### DevOps

| Technology | Role |
|---|---|
| **Docker + docker-compose** | API server, worker (separate process), PostgreSQL, Redis |
| **GitHub Actions** | Type check + tests on every push; deploy to Render on merge to main |
| **Render** | Backend API + BullMQ worker as separate services |
| **Vercel** | Next.js frontend |

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                        │
│                                                                  │
│  ┌──────────────────┐  ┌────────────────────┐  ┌─────────────┐   │
│  │ Competitor Setup │  │ Live Signal Feed   │  │  Chat (RAG) │   │
│  │   + Dashboard    │  │  (Socket.io WS)    │  │  Interface  │   │
│  └────────┬─────────┘  └─────────┬──────────┘  └──────┬──────┘   │
└───────────┼─────────────────────┼─────────────────────┼──────────┘
            │  REST API           │  Socket.io          │  SSE
┌───────────▼─────────────────────▼─────────────────────▼──────────┐
│                    BACKEND  (Node.js / TypeScript)               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │            COLLECTION LAYER  (BullMQ Scheduled)          │    │
│  │                                                          │    │
│  │   [Reddit]    [HN]    [JobPostings]    [Changelog]       │    │
│  │   every 6h  every 6h   every 24h       every 12h         │    │
│  │                    [PricingWatcher]                      │    │
│  │                       every 48h (Playwright)             │    │
│  └───────────────────────────┬──────────────────────────────┘    │
│                              │ raw signals                       │
│  ┌───────────────────────────▼─────────────────────────────┐     │
│  │            RAW SIGNAL STORE  (PostgreSQL)               │     │
│  │     auto-embed on insert  →  Pinecone upsert pipeline   │     │
│  └───────────────────────────┬─────────────────────────────┘     │
│                              │ triggers analysis                 │
│  ┌───────────────────────────▼──────────────────────────────┐    │
│  │         ANALYSIS LAYER  (LangGraph.js graph)             │    │
│  │                                                          │    │
│  │  [IntentAnalyzer] ─── parallel ─── [SentimentCluster]    │    │
│  │    GPT-4o                            Claude Haiku        │    │
│  │    jobs → strategy                   RAG → clusters      │    │
│  │         │                                 │              │    │
│  │  [ChangeDetector] ──────────── [PatternDetector]         │    │
│  │    GPT-4o-mini (conditional)    GPT-4o + Pinecone RAG    │    │
│  │    pricing diffs                30-day trend analysis    │    │
│  │         │                                 │              │    │
│  │  ┌──────▼─────────────────────────────────▼──────────┐   │    │
│  │  │         VulnerabilityWindowDetector               │   │    │
│  │  │           GPT-4o  +  Claude Sonnet                │   │    │
│  │  │    open windows → positioning + copy generation   │   │    │
│  │  └──────────────────────────┬────────────────────────┘   │    │
│  │                             │                            │    │
│  │  ┌──────────────────────────▼─────────────────────────┐  │    │
│  │  │           SynthesisAgent  (Claude Sonnet)          │  │    │
│  │  │   alert decision · weekly digest · confidence score│  │    │
│  │  └──────────────────────────┬─────────────────────────┘  │    │
│  └─────────────────────────────┼────────────────────────────┘    │
│                                │                                 │
│  ┌─────────────────────────────▼────────────────────────────┐    │
│  │                      OUTPUT LAYER                        │    │
│  │   Socket.io push · weekly digest · ChatAgent SSE stream  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│   Pinecone (namespaced per competitor)                           │
│   Braintrust (every LLM call logged + scored)                    │
│   Winston (structured logs, BullMQ job correlation IDs)          │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. User adds competitor (name, domain, subreddits, job board token, pricing URL, RSS feed)
2. System registers competitor in PostgreSQL and schedules five collection jobs via BullMQ
3. Collection agents fetch raw signals, deduplicate, and insert new records into PostgreSQL
4. Embedding pipeline auto-triggers on insert → `text-embedding-3-small` → Pinecone upsert under `competitor_{id}`
5. Analysis graph runs daily via BullMQ cron; LangGraph traverses the DAG
6. IntentAnalyzer and SentimentClusterer run in parallel on jobs and community signals
7. ChangeDetector runs conditionally when a pricing diff is detected
8. PatternDetector combines SQL volume counts with Pinecone RAG for 30-day trend analysis
9. VulnerabilityWindowDetector evaluates cross-signal patterns and generates positioning copy
10. SynthesisAgent decides alert vs weekly digest vs suppress, and assigns confidence score
11. Alerts push via Socket.io and persist to PostgreSQL; chat queries stream back via SSE with citations

---

## Agent Design

### Collection Agents

No LLM — pure data ingestion.

| Agent | Schedule | Source |
|---|---|---|
| **RedditCollectionAgent** | Every 6h | Reddit OAuth API; rate-limited at 50 req/min |
| **HNCollectionAgent** | Every 6h | Algolia HN API; weighted 2x in PatternDetector |
| **JobPostingCollectionAgent** | Every 24h | Greenhouse + Lever public APIs |
| **ChangelogCollectionAgent** | Every 12h | RSS/Atom feeds + Cheerio full-text fetch |
| **PricingWatcherAgent** | Every 48h | Playwright snapshot + text diff against baseline |

Long signals (>500 tokens) are chunked (400-token chunks, 50-token overlap) before embedding.

### Analysis Agents

LangGraph.js directed graph with model routing per task.

| Agent | Model | Purpose |
|---|---|---|
| **IntentAnalyzer** | GPT-4o | Job postings → strategic inferences with cited evidence |
| **SentimentClusterer** | Claude Haiku | Reddit/HN → themed clusters; extends existing clusters above 0.82 cosine similarity |
| **ChangeDetector** | GPT-4o-mini | Conditional; structured extraction from pricing diffs |
| **PatternDetector** | GPT-4o | SQL volume counts + Pinecone RAG → 30-day trend synthesis |
| **VulnerabilityWindowDetector** | GPT-4o + Claude Sonnet | Strategic window analysis + positioning copy generation |
| **SynthesisAgent** | Claude Sonnet | Alert vs digest decision; weekly intelligence report |
| **ChatAgent** | Claude Sonnet | Real-time RAG chat with source citations via SSE |

---

## Cost & Evaluation

### Estimated Cost

| Agent | Calls/day | Tokens/call | Daily cost |
|---|---|---|---|
| IntentAnalyzer | 1 | 4,000 | ~$0.016 |
| SentimentClusterer | 3 | 1,500 | ~$0.002 |
| PatternDetector (weekly) | 0.14 | 6,000 | ~$0.003 |
| ChangeDetector | 0.5 | 2,000 | ~$0.0002 |
| VulnerabilityDetector | 0.3 | 5,000 | ~$0.005 |
| SynthesisAgent (weekly) | 0.14 | 3,000 | ~$0.001 |
| ChatAgent (5 queries) | 5 | 2,000 | ~$0.015 |
| Embeddings | 50 signals | 200 | ~$0.0003 |
| **Per competitor/day** | | | **~$0.04** |

Crayon starts at $1,500/month. Signal runs at ~$1.20/month per competitor.

### Quality Metrics

**IntentAnalyzer** (20 manually graded test cases via Braintrust):

| Metric | Score |
|---|---|
| Inference accuracy | 0.82 / 1.0 |
| Evidence citation rate | 94% |
| Overconfident inferences | 2 / 20 |
| Zod schema pass on first attempt | 97% |

**VulnerabilityWindowDetector** (10 constructed scenarios):

| Metric | Score |
|---|---|
| Correct window detection | 8 / 10 |
| Generated copy rated usable without editing | 7 / 10 |
| False positive rate | 1 / 10 |

---

## Project Structure

```
signal/
├── src/
│   ├── api/                    # Express route handlers + Socket.io setup
│   ├── agents/
│   │   ├── collection/         # BullMQ workers — Reddit, HN, jobs, changelog, pricing
│   │   ├── analysis/           # LangGraph nodes — intent, sentiment, patterns, synthesis
│   │   └── chat/               # RAG chat agent
│   ├── graph/                  # LangGraph DAG definition + shared state interface
│   ├── queues/                 # BullMQ queue registry + cron scheduler
│   ├── pipelines/              # Embedding pipeline (chunk → embed → Pinecone upsert)
│   ├── db/                     # Drizzle ORM schema + query functions
│   ├── vector/                 # Pinecone utilities (namespace-enforced)
│   ├── llm/                    # Model router + cost tracker
│   └── lib/                    # Winston logger + retry utilities
├── worker.ts                   # BullMQ worker entry point (separate from API server)
├── frontend/                   # Next.js dashboard, signal feed, chat, alerts
├── docker-compose.yml          # API, worker, postgres, redis
└── .github/workflows/ci.yml    # Type check, tests, deploy
```

---

## Key Architecture Decisions

**API server and BullMQ worker are separate Docker services.** A slow Playwright scrape in the same process as Express degrades every API response. Background processing lives in a dedicated worker.

**Pinecone namespacing enforced at the utility layer.** `pineconeQuery()` requires `competitor_id` as a mandatory parameter. Cross-competitor data contamination is prevented at the type level.

**LangGraph state is immutable.** Every node receives `AnalysisGraphState` and returns a new object. Explicit immutable transitions are required for reliable debugging across six shared agents.

**Conditional routing uses no LLM.** DAG branch decisions are deterministic boolean logic. Latency, cost, and non-determinism are avoided where reasoning is not needed.

**PatternDetector separates SQL from LLM.** Volume trend counts run in PostgreSQL; only synthesized interpretation goes to GPT-4o. Deterministic computation where possible, LLM only where reasoning is required.

---

## Getting Started

**Prerequisites:** Node.js 20+, Docker, API keys for OpenAI, Anthropic, Pinecone, Reddit OAuth

```bash
git clone https://github.com/yourusername/signal
cd signal
cp .env.example .env
# Fill in your API keys
docker-compose up
```

**Add a competitor:**

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

**Trigger manual analysis:**

```bash
curl -X POST http://localhost:3000/api/competitors/{id}/analyze
```

**Backfill historical data:**

```bash
npm run backfill -- --competitor-id={id} --days=30
```

### Environment Variables

```bash
# LLMs
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Vector DB
PINECONE_API_KEY=
PINECONE_INDEX_NAME=signal

# Database
DATABASE_URL=                        # Neon.tech connection string
REDIS_URL=                           # Upstash Redis URL

# Data Sources
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=signal/1.0

# Evaluation
BRAINTRUST_API_KEY=

# Cost controls
MAX_TOKENS_PER_CALL=2000
COLLECT_INTERVAL_HOURS=24            # 6 in production, 24 in dev

# Feature flags
ENABLE_PLAYWRIGHT=true               # false to skip pricing watcher in dev
```

---

## Roadmap

### Near Term

- G2 and Capterra review ingestion
- Slack and email delivery for alerts and weekly digest
- Multi-user workspaces with role-based access

### Medium Term

- Meta Ad Library integration for competitor ad creative tracking
- Crunchbase API for funding signal correlation

### Long Term

- Temporal behavioral fingerprinting: per-competitor pattern memory with probability estimates for future moves

---

## License

MIT
