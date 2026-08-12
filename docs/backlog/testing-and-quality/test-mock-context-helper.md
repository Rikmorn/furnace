---
summary: 8 test files build fake contexts with an `as Context` cast that silently swallows every new `InternalState` field — wants a typed `createTestContext()` helper
---

# Test mock Context construction: `as Context` cast pattern across 8 test files

*Testing-hygiene candidate. Surfaced during Resource Manager Stage 1 (learning #4).*

8 test files in `tests/stats/`, `tests/events/`, etc. construct fake contexts inline with the pattern:

```ts
const ctx = {
  _internal: { disposed: false, stats: createStatsState(0), resources: createResourceManager(), ctxId: 0xffff },
} as Context;
```

The `as Context` cast bypasses structural verification. When Task 1.3 of RM-1 added the `resources` field to `InternalState`, every one of these 8 literals SHOULD have been a type error — but the cast silently swallowed the omission. The reactive fix (commit `15292ed`) added the missing field everywhere; the smell remains: the NEXT field added to `InternalState` will face the same silent-drift problem.

## Fix shape

Introduce `createTestContext()` helper in `packages/core/tests/_helpers/`. Returns a properly-typed minimal Context — or a small family (`createTestContext({ withCanvas?, withStats? })`). The 8 inline literals migrate to use the helper. Adding a new `InternalState` field means updating the helper once, not 8 sites.

Open design question: helper family vs single helper. Single helper is simpler; a family would let tests opt into / out of specific subsystems (e.g. "no resources pool" for tests that don't allocate). The 8 current callsites suggest single-helper-with-overrides is sufficient.

A shared `TEST_CTX_ID` constant in `tests/_helpers/` (currently `0xffff` duplicated across files — Stage 1 learning #5) can be introduced as part of the same helper.

## What to verify when fixing

- `createTestContext()` returns a `Context` (or `Readonly<Context>`) without an `as` cast at the helper site itself (or with a single boundary cast clearly commented).
- All 8 inline literals migrated; `grep -r "as Context" packages/core/tests/` returns nothing or only boundary-cast comments.
- `bun test` + `bun run typecheck` green.

## Trigger to revisit

**Before the next `InternalState` field is added.** Anyone editing `packages/core/src/gpu/internal.ts` to add a field should grep this backlog and decide: do the helper refactor first, or extend the 8 inline literals again (and accept that they're now N+1 inline literals).

**Reference:** Stage 1 learning #4 — `docs/learnings/resource-manager-stage-1.md`. Reactive fix shipped in commit `15292ed`. Preventive fix tracked here.
