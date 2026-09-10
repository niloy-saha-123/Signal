---
name: signal-typescript-review
description: Review Signal TypeScript for type safety, runtime/type alignment, NodeNext and Next.js boundaries, Zod narrowing, async correctness, and maintainable API design. Use when TypeScript-language quality is the focus.
---

# Signal TypeScript Review

The repository is a strict TypeScript npm workspace: NodeNext in API, bundler resolution in Next.js,
and ESM/CJS output in shared. Review the configured compiler behavior before suggesting stylistic
changes.

Focus on:

- unsafe casts, non-null assertions, implicit widening, unchecked indexed access, and `any` leakage;
- runtime/type mismatches at Drizzle dates/numeric/JSONB, Zod parsing, provider message blocks,
  BullMQ data, Redis JSON, Express queries, and environment variables;
- discriminated-union exhaustiveness for typed refusals/results and status/outcome enums;
- async promises that are dropped, event-handler rejection loss, double completion, and cleanup in
  `finally`;
- import/export boundaries: shared contracts from `@signal/shared`, retrieval from its barrel, and no
  circular module side effects that start workers during API imports;
- function signatures that make invalid states representable or hide required competitor/run IDs;
- test mocks that compile while diverging from the real dependency interface.

Do not request annotations TypeScript already infers reliably. Findings must describe a real defect,
maintenance hazard, or erased invariant, with file/line evidence and a minimal correction.
