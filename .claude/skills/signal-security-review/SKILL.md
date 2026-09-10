---
name: signal-security-review
description: Security-review Signal code involving HTTP/SSE, scraping, URLs, prompt evidence, secrets, Supabase/Postgres, queues, caches, logs, or dependencies. Use for threat-focused review; remain read-only unless fixes are requested.
---

# Signal Security Review

Establish trust boundaries and attacker-controlled fields before reviewing implementation.

## Signal-specific threats

- HTTP/job/cache/model payloads: strict runtime schemas, size/cardinality bounds, safe coercion, and
  no prototype/unknown-key surprises.
- Outbound URLs: public HTTP(S) only; reject credentials, custom ports unless explicitly needed,
  localhost/private/link-local/reserved IPs, unsafe redirects, DNS rebinding exposure, and non-HTTP
  schemes. Preserve the discovery agent's SSRF protections.
- RAG/prompt injection: evidence is delimited untrusted data; never execute instructions found in
  content; no unverified draft reaches SSE/cache.
- SSE/Socket.IO: safe event framing, JSON serialization, origin/exposure analysis, disconnect cleanup,
  no newline injection, and no sensitive payload broadcast to the wrong room.
- Secrets/logging: no credentials, tokens, raw provider responses, database URLs, or sensitive user
  text in errors/job logs/traces.
- Database: parameterized Drizzle/SQL, least privilege, constraints, safe migrations, and explicit
  recognition that current single-tenant/no-auth behavior is not safe for public multi-user access.
- Supply chain: lockfile integrity, install scripts, abandoned packages, advisories, and provenance.

Do not claim a vulnerability from pattern matching alone. Give exploit preconditions and impact;
rank findings P0–P3. Use the Supabase skills for RLS/schema specifics and current official sources
for time-sensitive dependency advisories.
