---
name: signal-conflict-review
description: Review or resolve Signal git conflicts and overlapping branch changes while preserving semantic intent, migrations, generated metadata, tests, docs, and user-owned work. Use for merge/rebase/cherry-pick conflict work.
---

# Signal Conflict Review

Start read-only: identify operation state, merge base, both branch tips, conflicted paths, and dirty
user changes. Never discard with reset/checkout or choose ours/theirs wholesale without understanding
both sides.

For each conflict:

- read the surrounding implementation and commits from both sides;
- reconstruct intended contracts, not just compilable text;
- preserve Signal invariants across graph, retrieval, queue, DB, API, and shared-schema boundaries;
- reconcile package manifests and regenerate the lockfile with npm rather than hand-merging dependency
  graph blocks;
- keep Drizzle SQL, journal, and snapshot files as one consistent migration history; never silently
  renumber or drop a migration;
- merge tests and docs semantically, removing only truly obsolete assertions/statements;
- distinguish generated test artifacts from source; do not stage unrelated `.vitest` output;
- check delete/rename conflicts and callers that may still reference the old path.

After resolution, inspect the staged diff, run `git diff --check`, targeted tests, root typecheck, and
the production build when runtime boundaries changed. Report what was combined, any judgment call,
and remaining risk. Commit or continue the git operation only when the user authorized it.
