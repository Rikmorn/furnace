# `collisionExtentY` after `collisionCenter`: keep, reshape, or unexport

F4 Task 5 added `field.collisionCenter(collision, record)` so the analyzer, the dungeon's rigid
bodies and (from tranche B) the editor's ghosts anchor a placed collider through ONE function
instead of three hand-composed recipes. Adding it should have triggered the deletion pass its
sibling now needs, per working-standards §Design ("list deletion candidates before listing
additions"). It didn't, so this entry is the pass — deliberately not decided, because it is a
public-API shape question.

**State of the surface today.** `collisionExtentY` is exported from `@furnace/core/field` and has
**zero non-test consumers**: outside tests and comments the only call is `anchorOffset`'s internal
use inside `placement-collision.ts`, and its own TSDoc now redirects callers to `collisionCenter`
("This is the EXTENT alone"). It is still genuinely load-bearing as a *concept* — the dungeon's
`placementCollider` derives the same rule independently, and a test asserts the two agree — but
nothing outside core *calls* it.

**There are already THREE hand-written copies of the extent rule, and the third one has the bug
Rider A just fixed.** Core's `localHalfExtents`, the dungeon's `placementCollider`, and — found
while writing this entry — the editor's `proxyScale`
(`packages/editor/src/field-host/field-placements.ts:73-79`), which sizes every prop proxy and
placement ghost. It applies the same split (box per-axis, round primitives by max axis) and takes
`Math.max(scale[0], scale[1], scale[2])` **raw, with no `Math.abs`** — exactly the divergence
Rider A removed from the dungeon in the same commit as `collisionCenter`. A mirrored record would
draw a mirrored proxy. Unreachable from scatter today (uniform, schema-pinned-positive scale) and
far less severe than the physics case (a render proxy, not a Rapier radius), so it is recorded
here rather than fixed across a package boundary mid-task — but it is evidence, not hypothesis,
that this rule does not stay in step by itself.

**Option A — export the half-extent TRIPLE instead of the Y scalar.** `localHalfExtents` already
computes all three axes and throws two away. A public `collisionHalfExtents(collision, scale)`
would give the editor's ghost/proxy SIZING a real consumer — `proxyScale` above IS that consumer,
already written, already drifting — and could let the dungeon's `placementCollider` become a thin
mapper over core-computed numbers, which would close the three-implementations-of-one-rule problem
STRUCTURALLY instead of testing around it, as Task 5 had to. *Counter-argument, and it is not weak:* a collider is not an AABB.
Reconstructing a ball radius or a capsule `halfHeight`/`radius` pair back out of a half-extent
triple is its own indirection and its own chance to get the round primitives wrong — `placementCollider`
would go from "read the primitive, scale it" to "read the primitive, read the triple, decide which
components reconstruct which field". The triple may be the right export for SIZING and the wrong
one for SHAPING.

**Option B — keep `collisionExtentY` exported as-is**, if tranche B's ghost sizing turns out to
want the scalar (e.g. a vertical-offset-only adjustment on an already-sized proxy).

**Option C — unexport it**, keeping it internal to `placement-collision.ts`. Smallest public
surface; costs the dungeon's cross-implementation parity test its core-side reference, so that
test would need another way to name the rule (or the rule moves to core entirely, i.e. Option A).

**Trigger to revisit:** Task 10.4 — the editor's ghost/proxy sizing. That is the task that learns
what the third consumer actually wants from this module, and choosing before it is guessing.

**Reference:** `packages/core/src/field/placement-collision.ts` (`localHalfExtents`,
`collisionExtentY`, `collisionCenter`); `packages/dungeon/src/field-world.ts`
(`placementCollider` — the second implementation of the extent rule);
`packages/dungeon/tests/field-placements.gpu.test.ts` (the parity test that holds the two
together); `packages/editor/src/field-host/field-placements.ts` (`proxyScale`, the would-be
consumer of a triple). `docs/reference/api-posture.md` R4 covers the naming of whatever lands.
