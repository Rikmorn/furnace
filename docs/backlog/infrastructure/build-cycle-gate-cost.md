---
summary: every commit pays the full check + typecheck + suite gate and the cost compounds per task — build-cycle speed wants a design pass
---

# The gate is ~80 s per commit, and every task pays it — build-cycle speed wants a design pass

Filed at the T5 review close (2026-08-11), from the user's ruling note: *"I would also like
to look for opportunities to improve how quickly we can build (running through tests, while
good, can balloon how long it takes to finish a task)."*

## Context

The per-commit gate is `bun run check` + `bun run typecheck` + full root `bun test`.
Measured at the T5 review (independent reviewer, head `a15c74ef`): check 1.33 s ·
typecheck 21.86 s · full suite 56.75 s (3,225 pass / 1 skip, 371 files) — **~80 s per
gate run**. The discipline is one task = one atomic commit, gated; T5 ran 13 commits, so
the tranche paid ≥13 gate runs (~17 min) before the review's own re-runs. The suite grows
every tranche (3,057 → 3,201 → 3,225 across T4c → T5), so this cost compounds in the
direction of worse.

Known constraints, all measured and recorded in
`editor-and-tooling/editor-test-harness-fragility.md`:

- **The per-package fallback does not cover the workspace** — 369 files / 3,215 tests
  against the root run's 371 / 3,218; `cookbook/tests/demos.test.ts` and
  `hello-world/tests/triangle-shader.test.ts` are in neither package list. Any split-run
  scheme must first close that gap or it gates less than the root run does.
- **`bun test --isolate` is not usable today** — 32 fails; the GPU fixtures depend on
  shared process state.
- **The suite has cross-file contamination classes** (happy-dom globals, SDK
  construction, unsettled promises) that per-file isolation would NOT fully contain; the
  scans added at T5 (`harness-conventions.test.ts`) enforce the containment conventions.

## The opportunity space (to be designed, not assumed)

- A cheap smoke tier per commit + the full suite at task close / review, instead of full
  per commit — the honest question is what the smoke tier must contain to keep the
  atomic-commit guarantee meaningful.
- Affected-scope selection (changed-files → impacted test files) — bun has no built-in;
  any mapping is repo tooling and can lie, so it needs the same stance→check treatment.
- Fixing the per-package coverage gap so per-package runs become a legal fallback again.
- Wall-clock work inside the suite itself (the budget tests, the GPU fixtures, the ~57 s
  breakdown has never been profiled per family).

## Trigger to revisit

**The pre-F5 tooling session** — paired with `infrastructure/docs-registers-findability.md`
by the user's ruling (2026-08-11): one session covering doc strategy (organisation,
tooling, guidance) AND build-cycle speed, after the 3b world-building-skill session,
before returning to the main epic.

## Reference

- `editor-and-tooling/editor-test-harness-fragility.md` — the gate ruling (T5, five
  numbered parts) and every measurement above at source.
- `docs/reference/editor-architecture.md` §28 — the T5 gate ruling's as-built record.
- `infrastructure/docs-registers-findability.md` — the session this pairs with.
