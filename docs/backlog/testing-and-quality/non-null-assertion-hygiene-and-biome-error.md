# Non-null-assertion hygiene + biome rule escalation

**Context.** `lint/style/noNonNullAssertion` is a warning today and the repo has tolerated
`!` in test files; the count creeps a batch at a time because `arr[i]!` is the path of
least resistance in index-heavy fixtures under `noUncheckedIndexedAccess`. F3a sealed at
91 warnings with zero new; the F3b root tranche added +46 (all in its two new cave test
files). Breakdown at 2026-07-24 (master `c1fa6911`, 137 warnings): `!`-in-tests is 134 of
them — `substrate-carve.test.ts` 78, `field-cave.test.ts` 43, `cave.test.ts` 7,
`built.test.ts` 4, `field-cave-walk.gpu.test.ts` 3 (all GPU/dungeon/core test files),
`field-raycast.test.ts` 1 — plus 2 `noUselessStringRaw` and 1 `useAwait` (unrelated
one-line fixes to sweep in the same pass). `src/` carries zero `!` warnings; the hot-path
`arr[i] as number` class (typescript.md §hot-path typed-array indexing) is casts, not `!`,
and is untouched by this rule.

**Goal (user, 2026-07-24).** A dedicated hygiene phase that (1) clears the existing
assertions and (2) REINFORCES: escalate `noNonNullAssertion` to `error` in `biome.json`
so the class cannot creep back.

**Fix shape** (so the tranche doesn't re-derive it): a tiny shared test helper — e.g.
`expectDefined<T>(v: T | undefined): T` that throws with a useful message, or an
`at(arr, i)` accessor — converting each `x[i]!` into a loud assertion instead of silent
undefined-propagation. Decide before flipping severity whether the error applies
repo-wide (preferred if the sweep clears everything) or needs a biome `overrides` carve-out
for any residual class.

**Trigger to revisit:** the user schedules the hygiene phase (candidate slot: after the
F3b seal, beside the F4 recharter — note the F3b editor tranche may add a few more sites
before then; the sweep catches all at once); OR any tranche pushing the count past ~180.

**Reference:** `.claude/rules/typescript.md` (intentional-bypass classes),
`biome.json`, F3a seal precedent (zero-new-warnings held as the bar).
