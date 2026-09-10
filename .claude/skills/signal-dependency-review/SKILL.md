---
name: signal-dependency-review
description: Review Signal runtime, package, SDK, model-ID, and framework versions for compatibility, support, advisories, lockfile consistency, and safe upgrades. Use for version audits or dependency-changing diffs.
---

# Signal Dependency and Version Review

Inventory versions from every workspace manifest and `package-lock.json`; do not rely on memory or
only inspect root direct dependencies. Determine the deployed Node requirement and relevant peer
dependency/runtime constraints.

For a current-version or vulnerability claim, verify against primary sources: official release
notes/docs, package registry metadata, maintainer advisories, and GitHub Security Advisories. Record
the date checked. Never auto-upgrade merely because a newer version exists.

Check:

- Next.js 15/React 19 compatibility and web build behavior;
- Express runtime versus installed `@types/express` major version;
- LangChain/LangGraph/provider SDK peer ranges and message/schema API changes;
- BullMQ versus ioredis duplication/compatibility and Redis server requirements;
- Drizzle ORM/drizzle-kit snapshot and migration-format compatibility;
- TypeScript/Vitest/tsup module-resolution compatibility across NodeNext and bundler packages;
- lockfile-only drift, duplicated majors, deprecated/transitive packages, install scripts, and Node
  engine support;
- configured model aliases versus provider-available model IDs and retirement dates.

Classify upgrades as required, recommended, or optional. For each required change, give compatibility
evidence, likely breaking surfaces, test plan, and rollback. Do not modify dependencies in review mode.
