# Resource Manager Stage 1 — Learnings

Stage 1 of the resource manager rollout shipped 2026-05-28 across 5 sessions and ~22 commits. The manager backs every consumer-facing GPU resource (`Mesh`, `Material`, `Geometry`, `Effect`) with per-context pools, branded `uint48` handles, refcount-driven sharing, and an automatic dispose cascade.

These are findings the executor noticed during Stage 1 that affect future work — both Stage 2 (consumer migration) and unrelated tranches that touch handle-pool, dispose, or test-mock patterns.

For the design, see `docs/reference/engine-conventions.md` §Resource manager.

## 1. uint32 handles silently collide across contexts

Original spec said cross-context handle use was "structurally impossible (handle decodes to a slot in *this* context's pool)." Wrong. Two contexts each holding a mesh at slot=1 generation=1 produce identical `0x00010001` handles — so passing one context's handle to the other's `frame.render` resolves to a live slot in the wrong pool and silently renders the wrong mesh.

**Fixed** by extending handles to `uint48` with a 16-bit ctxId in the upper bits (Session 1 fixup, commit `3436dab`). Slot/gen decoders kept working unchanged because JS bitwise ops truncate to int32 and drop the ctxId cleanly; `decodeCtxId` uses arithmetic (`Math.floor(h / 0x100000000)`). Handles stay as primitive `number` — they're within JS's 2^53 safe-integer range, so no BigInt indirection.

**For future work:** any code path that encodes/decodes handles must respect the uint48 layout. Adding new handle kinds, encoding extensions, or other resource managers should start from uint48 + ctxId, not uint32. The shape is documented in `docs/reference/engine-conventions.md` §Resource manager → Handle representation.

## 2. Dispose cascade originally didn't free pool slots

The first version of `disposeAllResources` ran each slot's `_teardown()` but never called `destroySlot` on the slot. Hidden in Session 1 because `gpu.dispose` was the only caller — the context was dying anyway, so leaving the pool in a stale state didn't matter.

Session 4's public `resources.disposeAll(ctx)` exposed the gap mid-session: `summary(ctx)` would still report just-torn-down handles as live.

**Fixed** by routing the cascade through `_destroyByKind` (commit `9b27e33`), so pool bookkeeping (slot free-list + generation bump) stays consistent after the cascade. Any future cascade-style cleanup path must go through the pool's destroy API, not just teardown directly.

## 3. Cascade warn count over-reported when refcount cascades fired

The original "auto-cleaned N live handles" warn was emitted BEFORE the cascade with the upfront live-count. Mesh teardown's refcount cascades into Geometry/Material slots — those iterations then see fewer live slots than the upfront count predicted, but the warn already lied.

**Fixed** (commit `e1a0afd`) by moving the warn AFTER the cascade and counting actually-freed slots via `_destroyByKind`'s boolean return. Also corrected the past-tense "auto-cleaned" wording, which had been inconsistent with the pre-cascade emit order.

**For future work:** when implementing other "summary" messages over multi-step cleanup, count what actually happened, not what was anticipated. The discrepancy is invisible until something cascades, and then the message lies about reality.

## 4. Test-mock drift across `_internal` literals

8 test files in `tests/stats/`, `tests/events/`, etc., constructed `_internal: { disposed, stats: createStatsState(0) }` literals cast `as Context`. The `as Context` cast hid the omission of new fields added to `InternalState`. Tests passed because they didn't exercise the missing field — until Task 1.5's cascade started reading `ctx._internal.resources`, at which point those mock contexts would have NPE'd if they ever called `gpu.dispose`.

**Fixed proactively** (commit `15292ed`) by adding the missing field to every mock literal. None of the mocks actually called `gpu.dispose`, so no test was breaking yet — but the moment a future test calls `gpu.dispose` on one of these mocks, it would have failed.

**For future work:** when adding a required field to `InternalState`, grep ALL `_internal: {` literals in tests, not just the ones the change directly touches. The `as Context` cast pattern is a known smell across the test suite.

## 5. Migration-window TSDoc comments rotted predictably

Sessions 2–3 had TSDoc lines like "Material refcount lands in Session 3" that became stale as the sessions shipped. Sometimes caught at commit time, sometimes only by the reviewer. The same pattern recurred in `resource-leak-warning.gpu.test.ts` where assertions said "during the Sessions 2-4 migration window."

**For future multi-session migrations:** consider a `// MIGRATION (until X):` convention that's greppable when the session lands. Anchors the comment to its expected removal, so the reviewer can grep at session boundaries.

## 6. Adjacent-findings ratio was around 5–10%

Per AGENTS.md bulk-standardisation guidance, expected 5–15%. Stage 1's actual adjacent findings:

- Leak-warn test math shifts as kinds migrated (Sessions 2 and 3) — fixed inline because they broke the tranche gate.
- `_resolveMaterial` placed in a dedicated `material/internal.ts` (not `mesh/internal.ts` as the plan suggested) — symmetric with `_resolveGeometry`/`_resolveMesh` and cleaner.
- `validateEffects` / `validateDraw` consistency gap — backlog entry `validate-effects-resolved-slot-shape.md`.
- `check-tsdoc.ts` subdir-walker limitation surfaced during Session 1 (`99c36be`).

The proactive-backlog discipline (AGENTS.md "capture adjacent findings mid-tranche") worked: every finding got either fixed inline (when it broke a gate) or filed (when it didn't), and nothing silently expanded scope.

## 7. Pipeline cache cross-context leak fixed structurally

The cross-context pipeline-cache leak (formerly tracked as `pipeline-cache-cross-context-leak.md`) is now closed by per-ctx manager state. Demonstrated by `pipeline-cache.gpu.test.ts`'s "two ctxs do not share pipelines for the same key" test — one for material, one for post.

**For future work:** any cache-style state that was previously module-level should be considered for per-ctx scoping. The Manager has slots for two pipeline caches today (`materialPipelineCache`, `postPipelineCache`); other future caches (e.g. texture caches, sampler caches) should follow the same pattern.

## 8. Validate-both-first beats increment-then-rollback

The plan's Mesh→Material refcount design said "increment the geometry refcount, then look up material, then increment OR roll back." Implementation went with "look up BOTH, then increment both" — simpler invariant (no transient inconsistent state on the throw path) and trivially easier to reason about.

**For future refcount work:** validate everything you need before mutating. Rollback paths are hard to keep correct under exception flow.

## 9. Generation overflow not exercised

The 16-bit generation counter wasn't pushed to overflow in any Stage 1 test. The 1000-iteration spawn/despawn loop in `refcount.gpu.test.ts` recycles slots heavily but stays well under 65k destroys per slot.

**For future work:** Stage 2's `custom-stats` demo is the first realistic chance to see generation overflow. The pool's overflow behaviour is documented as "wraps; debug warn." Verify the wrap path works under sustained allocation pressure.

## 10. Half-stale documentation is worse than fully-stale

During Session 3 Task 3.1's docs expansion, the Material row in `core-modules.md` got updated to the new handle shape, but the adjacent Geometry and Mesh rows still described the old "record holding {...}" shape. The partial state was strictly worse than uniform staleness — a reader cross-checking would see the contradiction and not know which is current.

**For future docs updates:** when you update one row in a table, scan the table for adjacent rows that the same change should have touched but didn't. The first updater is the one with the context; later passes have to re-derive it.

---

For the per-session commit list and the Stage 2 readiness check, see the git history of the Stage 1 work. For the canonical design, see `docs/reference/engine-conventions.md` §Resource manager.
