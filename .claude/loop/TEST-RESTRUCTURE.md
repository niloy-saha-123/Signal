# Part R — Test-file restructure (deferred chore)

**Status:** ⬜ not started. Runs on its **own branch** cut off `main` *after* Parts 11–13 merge.
Not a feature part — no new behaviour, pure move + config. Do it last so Parts 11–13 write
their tests co-located (current convention) and this part relocates everything in one pass.

## Goal

Get every `*.test.ts` out of `src/`. Each workspace gets a top-level `test/` folder with
subfolders grouping tests by source area. Source dirs hold only source.

Requested by user 2026-09-09: "we will have a test folder and then subfolders for which tests
we are putting in."

## Current state (41 files, all co-located next to the code they test)

- `apps/api/src/**` — 36 files across: `agents/analysis/` (6), `collectors/` (5), `pipeline/` (3),
  `retrieval/` (4), `graph/` (3, incl. `.smoke.test.ts`), `llm/` (3), `lib/` (7),
  `queues/` (3), `db/` (2), `vector/` (1).
- `packages/shared/src/**` — 5 files: `agents`, `pricing`, `prompts`, `signals`, `socket-events`.
- `apps/web/**` — 0 test files today.

Import styles in the existing tests:
- api: mix of sibling (`./pattern-detector`), `../x`, `../../db/queries`, including inside
  multiline `vi.mock("../../…")` calls. Depth varies by file.
- shared: all sibling only (`./signals` etc.).

## Target layout

```
apps/api/test/
  agents/analysis/*.test.ts
  collectors/*.test.ts
  pipeline/*.test.ts
  retrieval/*.test.ts
  graph/*.test.ts          # includes analysis-graph.smoke.test.ts
  llm/*.test.ts
  lib/*.test.ts
  queues/*.test.ts
  db/*.test.ts
  vector/*.test.ts
packages/shared/test/*.test.ts
```

Mirror the `src/` subtree exactly — keeps "which test covers which file" a one-glance mapping
and makes the move scriptable.

## Steps

### 1. `apps/api` — introduce a `@/` path alias first

The alias removes all import-depth math from the move (every relative parent import becomes a
stable `@/…` regardless of where the test file lands). Zero new deps.

- `apps/api/tsconfig.json`: add
  `"compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } }`.
- `apps/api/vitest.config.ts`: add
  `resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } }`
  (or `path.resolve(__dirname, "src")` with the `node:path` + `__dirname` shim for an ESM config).
- Runtime (`tsx` for `worker.ts` / `src/api/index.ts` / `scripts/*`) does **not** resolve
  `tsconfig` paths by itself. Two options — pick during implementation:
  - keep source files on relative imports, use `@/` **only in test files** (smallest change,
    no runtime concern); or
  - add `tsconfig-paths/register` (already transitively present via several deps — verify) to
    the `tsx` invocations and migrate source too.
  Default to the first unless the reviewer wants consistency.

### 2. Move the files

```
mkdir -p apps/api/test
git mv apps/api/src/<area>/<name>.test.ts apps/api/test/<area>/<name>.test.ts   # ×36
git mv packages/shared/src/<name>.test.ts packages/shared/test/<name>.test.ts   # ×5
```

### 3. Rewrite imports in the moved files

- api tests: every `from "./x"` / `from "../x"` / `from "../../x"` and every
  `vi.mock("…relative…")` → `@/<path-from-src>`. e.g. in
  `test/agents/analysis/pattern-detector.test.ts`: `./pattern-detector` → `@/agents/analysis/pattern-detector`,
  `../../db/queries` → `@/db/queries`, `../../retrieval` → `@/retrieval`.
  Non-relative imports (`vitest`, `@langchain/openai`, `@signal/shared`) are untouched.
- shared tests: `from "./signals"` → `from "../src/signals"` (5 files, sibling-only, trivial —
  no alias needed for a package this small).

Do this with a script (parse each import/`vi.mock` specifier, resolve against the file's old
`src/` dir, re-express), not hand edits — 41 files.

### 4. `apps/api` build must stop compiling tests into `dist/`

`build` is plain `tsc` with `include: ["src/**/*", …]`. Once tests leave `src/` they also leave
the default build, but typecheck must still see them:

- `apps/api/tsconfig.json` `include`: add `"test/**/*"` (so `tsc --noEmit` covers tests).
- New `apps/api/tsconfig.build.json`: `extends: "./tsconfig.json"`, `exclude: ["test", "node_modules", "dist"]`.
- `apps/api/package.json`: `"build": "tsc -p tsconfig.build.json"`.
- `apps/api/vitest.config.ts`: the `exclude: [...configDefaults.exclude, "dist/**"]` workaround
  (added because `tsc` was emitting `dist/**/*.test.js`) can be **removed** — dist no longer
  contains test files. Verify with a `npm run build && npm test` before deleting it.

### 5. `packages/shared`

- `build` is `tsup src/index.ts …` — entry-point based, never compiled tests, no change.
- `tsconfig.json` typecheck: ensure `include` covers `test/**` (default is `src` only — add
  `"include": ["src/**/*", "test/**/*"]` or it stops typechecking the moved tests).

### 6. Housekeeping

- `.vitest/json/output.json` reporter artefacts under each workspace — regenerate / leave as-is,
  they don't move.
- Grep for any tooling that hard-codes `src/**/*.test.ts` (CI config, coverage `include`,
  lint overrides) and repoint to `test/**`.
- `apps/web` gets an empty `test/` only when it gains its first test — don't create it now.

## Verification (all must pass, same as any part)

- `npm run typecheck` — clean across all 3 workspaces.
- `npm test -w @signal/api` — same count as before the move (record the baseline first).
- `npm test -w @signal/shared` — same count.
- `npm run build` — clean; confirm `apps/api/dist/` contains **no** `*.test.js`.
- `git diff --stat` sanity: should be ~41 renames + import churn + ~5 config files, nothing else.
- `typescript-reviewer` + `production-reviewer` on the diff (production-reviewer scope here is
  thin — mostly "did any test silently stop running").

## Risks / watch-for

- A test that relied on a relative import resolving to a **compiled sibling** (none known, but
  the graph tests import the compiled `analysis-graph` in one smoke path — check).
- `vi.mock` factory paths must match the *import* path exactly post-alias or the mock silently
  no-ops and tests pass against real modules. After the move, spot-check 2–3 mock-heavy files
  (`pattern-detector`, `synthesis`, `deduplicator`) actually still mock.
- Coverage thresholds keyed to file globs.
- Keep it one branch, one merge — don't interleave with feature work.
