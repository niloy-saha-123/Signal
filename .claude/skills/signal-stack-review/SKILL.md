---
name: signal-stack-review
description: >
  Review whether Signal changes fit the project's chosen architecture and technology boundaries,
  including Next.js/React, Express/Socket.IO/SSE, BullMQ/Redis, Drizzle/Postgres, LangGraph,
  Pinecone, and model providers.
---

# Signal Technology-Stack Review

Use the package manifests, implemented code, and architecture docs as truth. This review asks whether
the change uses the existing stack coherently—not whether another stack would be fashionable.

Verify ownership boundaries:

- Next.js renders the command center and consumes REST/SSE/Socket.IO; it does not run collectors or
  analysis jobs.
- Express validates/orchestrates request lifecycles; BullMQ workers execute slow/background work.
- Drizzle owns typed Postgres access and versioned migrations; Redis owns queue/circuit/cache state;
  Pinecone owns competitor-namespaced vectors.
- LangGraph coordinates analysis DAG state; ChatAgent remains a synchronous verified RAG boundary.
- Shared Zod/TypeScript contracts live in `packages/shared` when both API and web consume them.
- Playwright is limited to pages requiring a browser; Cheerio/fetch handle static sources.
- Socket.IO is for server-pushed alerts; SSE is for verified chat result delivery.

Flag duplicate infrastructure, boundary leakage, unjustified new dependencies, incompatible runtime
assumptions, and abstractions that bypass existing reliability/cost/prompt/query layers. Recommend a
stack change only with a concrete unmet requirement and migration cost.
