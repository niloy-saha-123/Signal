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
├── package.json                 # workspace root (npm workspaces)
├── docker-compose.yml
├── packages/
│   └── shared/                  # Zod schemas + types shared by api and web
│       └── src/
│           ├── competitor.ts
│           ├── signal.ts
│           ├── alert.ts
│           ├── chat.ts
│           └── socket-events.ts
├── apps/
│   ├── api/                     # backend: Express API + BullMQ worker + agents
│   │   ├── src/
│   │   │   ├── api/             # REST + Socket.io routes
│   │   │   ├── collectors/      # scheduled data ingestion (no LLM)
│   │   │   ├── agents/
│   │   │   │   ├── analysis/    # LangGraph LLM nodes
│   │   │   │   └── chat/        # RAG chat agent
│   │   │   ├── graph/           # LangGraph DAG + state
│   │   │   ├── queues/          # BullMQ registry, scheduler, processors
│   │   │   ├── pipelines/       # embedding pipeline
│   │   │   ├── db/              # Drizzle schema + queries
│   │   │   ├── vector/          # Pinecone utilities
│   │   │   ├── llm/             # model router + cost tracker
│   │   │   └── lib/             # logger, retry
│   │   ├── worker.ts            # BullMQ worker entry point
│   │   └── scripts/backfill.ts
│   └── web/                     # frontend: Next.js dashboard
│       ├── app/                 # pages (competitors, chat, alerts)
│       ├── components/          # charts, feeds, chat UI
│       └── lib/                 # Socket.io client
└── .github/workflows/ci.yml
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
npm install
docker-compose up postgres redis

# Terminal 1 — API (port 3000)
npm run dev

# Terminal 2 — worker
npm run worker

# Terminal 3 — dashboard (port 3001)
npm run dev:web
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

Signal is built in deliberate phases: prove the core loop first (collect → analyze → alert → dashboard), then expand delivery and collaboration, then selectively add paid data sources only where the economics justify it.

### Phase 1 — Now (foundation)

**Goal:** End-to-end competitive intelligence on free, public data sources.

| Area | Deliverables |
|---|---|
| **Monorepo** | `apps/api`, `apps/web`, `packages/shared` — shared types, separate deploys |
| **Collectors (5)** | Reddit, HN, job boards, changelogs, pricing watcher |
| **Analysis graph (6 LLM agents)** | Intent, sentiment, change detection, patterns, vulnerability, synthesis |
| **Chat (1 LLM agent)** | RAG over stored signals |
| **Dashboard MVP** | Competitor setup, signal feed, alerts, charts, chat |
| **Ops** | Docker, BullMQ worker, PostgreSQL, Redis, Pinecone, CI |

**Success criteria:** Add a competitor → signals collect automatically → analysis runs → user sees a strategic alert with evidence chain in the dashboard.

---

### Phase 2 — Next (ASAP after Phase 1)

**Goal:** Make Signal usable day-to-day for a small team — not just technically working.

| Priority | Item | Why |
|---|---|---|
| P0 | Implement collector + analysis agent logic (currently stubs) | Nothing ships without this |
| P0 | Real-time alerts in dashboard (Socket.io wired end-to-end) | Core product promise |
| P1 | G2 and Capterra review ingestion | Free-ish public review data; high signal for pricing/SMB sentiment |
| P1 | Slack and email alert delivery | Users shouldn't need the dashboard open 24/7 |
| P1 | Weekly digest generation + export | Non-technical stakeholders want a report, not a feed |
| P2 | Multi-user workspaces with role-based access | First step toward team product |
| P2 | Meta Ad Library integration | Public API; competitor ad creative tracking without paid tools |

---

### Phase 3 — Future (paid data & deeper market intelligence)

**Goal:** Enrich signals with premium market data — only after Phase 1–2 prove value and unit economics.

Most incumbent competitive-intelligence APIs are priced for enterprise budgets, not an early-stage product. Signal's default strategy is **public sources + LLM judgment first**; paid APIs are evaluated case-by-case.

| Tool | Cost | Reality | Signal plan |
|---|---|---|---|
| **Semrush API** | $130+/month (API access alone) | Too expensive for early stage | Defer — replicate partial SEO/traffic signal via public HN, Reddit, and changelog patterns first |
| **Similarweb API** | Enterprise pricing ($1,000s/month) | Not accessible at startup scale | Defer — no near-term integration |
| **Ahrefs API** | ~$500/month | Not accessible at startup scale | Defer — backlink/SEO depth is low priority vs. product/pricing/hiring signals |
| **BuiltWith API** | ~$295/month | Moderate cost, niche use case | Evaluate after traction — tech-stack detection is useful but not core loop |
| **Crunchbase API** | Free tier extremely limited | Useful for funding/hiring correlation | **Maybe later** — start with public job boards + manual funding news scraping |
| **NewsAPI** | Free tier: 100 req/day, dev only | No production free tier | **Limited** — use RSS, HN, and Reddit for news signal instead |

**Future capabilities (post-traction):**

- Temporal behavioral fingerprinting — per-competitor pattern memory with probability estimates for future moves
- Selective paid API integrations based on customer willingness to pay (BuiltWith, Crunchbase Pro, curated news feeds)
- Customer-configurable data source packs (e.g. "SEO pack", "funding pack") so premium API cost is passed through, not absorbed
- Enterprise SSO, audit logs, and compliance for larger teams

---

### What we are *not* doing early

- Microservices split — monorepo + API/worker process separation is sufficient
- Enterprise API contracts (Semrush, Similarweb, Ahrefs) before product-market fit
- Building a generic "CI dashboard" clone — Signal's edge is **judgment**, not more charts on raw data

---

## License

MIT
