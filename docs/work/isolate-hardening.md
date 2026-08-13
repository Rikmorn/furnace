---
status: in-flight
injected: true
summary: fix the isolate-incompatible test files so `bun test --parallel` can be the gate
---

# Isolate hardening

**Execution complete; REVIEWED 2026-08-13 (PASS-WITH-MINORS, minors fixed on the branch);
merge + seal HELD at owner request — the owner is reading the branch first.** 11 commits, tree
clean, `--ff-only` available. The review's own additions: five prose corrections
(`95d7aa97`) and one code change (`f50f345c`, the dungeon GPU guard, owner-ruled). Nothing has
been merged; `docs/learnings/seals/` has no entry for this slice yet and this file is
deliberately still here — it is the live record until the seal replaces it. `bun run test` (`bun test --parallel=4`) is
the per-commit gate, and the serial `bun test` remains the close/review standard. Both modes
now report the same case count, the same pass count and the same single skip.

What the fast path used to hide: only ~69% of cases actually gated under it. The whole GPU
population skipped (487 cases) and 31 editor DOM files never executed (532 cases), so the
old headline wall clock was the cost of running two thirds of the suite. **Both classes
turned out to be one Bun defect** — under `--isolate` an importer evaluates before the
imported async module's top-level await settles, so `const` bindings sit in TDZ while
hoisted functions do not. That is filed with a minimal repro and a revert trigger at
`docs/backlog/infrastructure/bun-isolate-top-level-await-tdz.md`; both in-repo workarounds
(the fixtures' explicit `libPath`, the inspector harness's synchronous `require`) are
deletion candidates the day it is fixed upstream.

Also landed: the shared-directory interaction is gone from both ends
(`build-frontend.test.ts` builds into a temp outdir, `project-assets.test.ts` serves an
explicit temp `staticDir` instead of a build artifact), and `trySetup` no longer swallows
its error. The budget-files question (D1) and the worker count (D2) collapsed into one
ruling — `--parallel=4` — recorded in
`docs/backlog/editor-and-tooling/editor-test-harness-fragility.md`, which also answers the
objection its declined-baseline-budgets ruling was owed. Two findings were filed rather
than absorbed: a one-off Bun panic at one-worker-per-core, and the unguarded duplicate GPU
fixture in `packages/dungeon`.

Derive the current numbers rather than reading them here: `bun test`, `bun test --isolate`,
`bun run test`.

**Deliberately unordered** — no `after:`. Related: the build-speed seal (2026-08-13) owns
the typecheck side; the scoped-gate script overruled there stays overruled — the fast gate
runs the whole population, so there is nothing left for a selection layer to buy.
