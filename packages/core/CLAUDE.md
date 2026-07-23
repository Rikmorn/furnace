# CLAUDE.md — `@furnace/core`

Operational pointers for agents working inside `packages/core` (the engine library).
Repo-wide rules live in the root `AGENTS.md`; this file adds core-specific pointers, not
restatements. Package detail + current state: `packages/core/README.md`.

## Browser-only — no host APIs in `src/`

Core ships as plain ESM + `.d.ts` and must consume in any bundler. **No Bun (`Bun.*`,
`bun:*`), no Node (`node:*`, `process.*`), no platform-aware code** in `src/`.
`tests/no-bun-leakage.test.ts` regex-scans for Bun imports — that is ONE guard, not the
contract; the contract is `AGENTS.md` § "What we ship to consumers". Tests, scripts, and
benches under core may use Bun freely — the boundary is the publish manifest, not `src/`.

## Public API changes

Every change to a public export carries, in the same PR: **TSDoc** on the export
(`bun run check:tsdoc` enforces presence; stale TSDoc is a review concern the check can't
catch — policy in `docs/reference/tsdoc-conventions.md`); a row in
`docs/reference/core-modules.md`; and a `packages/cookbook` demo when consumer-visible.
Verify behaviour against the implementation source, not the reference doc — grep the body
for `throw new` / `console.warn` / early-return guards. Source wins; fix the doc in the
same change.

## API shape & failure policy

New surface follows the R1–R9 rules in `docs/reference/api-posture.md` (classify first,
opaque handles, `ctx`-first free functions, verb-per-kind, standalone escape hatches).
Failure policy follows `docs/reference/engine-conventions.md` §Failure policy: **setup
loud** (throw on bad ctx/input), **runtime quiet** (silent no-op on disposed, log-warn on
bad input). R9 maps kind→stance; §Failure policy is the authority.

## Tests

`bun:test`. Assert perf/memory budgets in tests, not comments. **Sabotage-verify** each
new assertion: temporarily break the code, watch the test fail, then revert — a green
test that can't go red proves nothing.

## Field-module invariants (`src/field/`)

Ids stable / op-log array order = replay order / undo+redo stacks strictly LIFO / no
mutation on a validation throw. Don't restate the mechanism — see
`docs/reference/core-modules.md` → `@furnace/core/field`.
