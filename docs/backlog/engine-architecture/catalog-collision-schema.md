---
summary: catalog `collision` schema: whether `collisionExtentY` survives `collisionCenter`, and whether the box-only kind should escalate to a mesh kind
---

# Catalog collision schema

Tracker for the catalog's **`collision` schema** — the two open questions about how a
placement archetype declares what blocks the player. Each section is one previously
standalone entry with its Context, *Trigger to revisit* and *Reference* preserved.

They are merged because they are the two halves of one schema decision taken at different
times: what the anchor surface should be now that `collisionCenter` exists (and whether the
older `collisionExtentY` still earns its export), and whether the box-only `kind` should
escalate to a mesh kind or a per-archetype blocking override. `docs/reference/dungeon-architecture.md`
§8 and `packages/dungeon/README.md` both cite the escalation section as the unbuilt
engine-side half of an authoring choice they document.

## `collisionExtentY` after `collisionCenter`: keep, reshape, or unexport

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

**There are already THREE hand-written copies of the extent rule, and the third one HAD drifted
— it was fixed nine hours later, by a different task, and this entry did not notice for two
weeks.** The three are core's `localHalfExtents`, the dungeon's `placementCollider`, and — found
while writing this entry — the editor's `proxyScale`
(`packages/editor/src/field-host/field-placements.ts`), which sizes every prop proxy and
placement ghost. All three apply the same split: box per-axis, round primitives by max axis.

**Corrected at the T5 branch review, 2026-08-11.** As first written this paragraph said
`proxyScale` took `Math.max(scale[0], scale[1], scale[2])` **raw, with no `Math.abs`**, and
called that "evidence, not hypothesis". *It was true when written and is false now*, and the
history is worth more than either sentence alone:

- The claim was written in `dc7eb0cc` (2026-07-26 14:11). At that commit `proxyScale` did take
  the raw `Math.max` — `git show dc7eb0cc:packages/editor/src/viewport-host/field-placements.ts`
  confirms it, at the very lines the original `:73-79` citation named.
- It was fixed in `a0d76354` (2026-07-26 23:35 — the SAME DAY, nine hours later, by the analyzer
  host-wiring task, not by anyone reading this entry). `git log --follow -S "Math.abs(scale[0])"
  -- packages/editor/src/field-host/field-placements.ts` returns that one commit and no other.
- The entry was then carried VERBATIM into this merged tracker by the T5 prune (`9e12a3a1`,
  2026-08-11), which validated filenames but never re-read moved prose against source.

So the load-bearing point stands and is now stronger, not weaker: **the rule genuinely does not
stay in step by itself.** The third copy DID diverge, the divergence was real, and it was closed
by a task that happened to be editing the same function rather than by the record that was
tracking it. What must not be repeated is this entry's own failure — nine hours of drift became
two weeks of a false claim asserted as evidence in a live register.

Today `proxyScale` takes magnitudes on all three axes before the split, and its TSDoc carries the
argument ("an extent is a distance, so a MIRRORED record covers the same box… signed arithmetic
would… make `Math.max` pick the LEAST negative axis for a round one"). The exposure was never
live in any case: scatter's scale is uniform and schema-pinned positive, and a proxy is a render
stand-in, not a Rapier radius.

**Option A — export the half-extent TRIPLE instead of the Y scalar.** `localHalfExtents` already
computes all three axes and throws two away. A public `collisionHalfExtents(collision, scale)`
would give the editor's ghost/proxy SIZING a real consumer — `proxyScale` above IS that consumer,
already written, and already shown to drift once — and could let the dungeon's `placementCollider` become a thin
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
`collisionExtentY`, `collisionCenter`); `packages/dungeon/src/world/placement-collider.ts`
(`placementCollider` — the second implementation of the extent rule);
`packages/dungeon/tests/field-placements.gpu.test.ts` (the parity test that holds the two
together); `packages/editor/src/field-host/field-placements.ts` (`proxyScale`, the would-be
consumer of a triple). `docs/reference/api-posture.md` R4 covers the naming of whatever lands.

## Catalog collision escalation: a `mesh` kind, or a per-archetype blocking override

F4's D-F4-14 gave the catalog `collision` schema an explicit `anchor: "center" | "base"` (default
`"center"`, so every pre-F4 catalog is unchanged). Core's `collisionCenter` /
`voxelizePlacements`, the dungeon's `world/world-loader.ts` loader, and the editor's ghosts + prop
proxies all anchor through the same function, so a prop's physics collider and the analyzer's
walkability flags agree by construction. The stalagmite declares `"base"` (its mesh is
base-origin, y∈[0,1]); the rock stays centred (its mesh is centre-origin).

**One leg of that agreement is still a human promise: the MESH.** `packPlacementMatrices`
(`core/field/kit-render.ts`) packs each record's RAW `position` — it never consults `anchor`,
because the anchor describes where the COLLIDER sits, and the render transform is the record pose
by definition. That is correct, and it means collider↔flags now agree mechanically while
collider↔mesh agreement rests entirely on an author matching a JSON string to a mesh's origin
convention, with nothing checking the pairing. Declare `"base"` on a centre-origin archetype (or
forget it on a base-origin one) and the collider silently sits half a mesh away — the same bug
D-F4-14 just fixed, one archetype along. It is checkable: the committed `.fmesh` blobs carry
vertex bounds, so a test asserting `anchor: "base"` ⇒ minY ≈ 0 and centre-origin ⇒ minY ≈ −maxY
would close it against real geometry rather than a comment.

That closes the anchoring question but NOT the sizing one, and the remaining consequence was
accepted deliberately rather than solved: **small props stay walkable-over.** Faithful centre
anchoring leaves a scatter rock's above-floor collider extent at 0.21–0.56 m across its authored
`scaleRange` `[0.6, 1.6]`, and the `CharacterMover` climbs short obstacles via `STEP_HEIGHT`
(0.4 m) plus the `applyGravity` rim-ride. Measured against the real mover with the rock's box: a
box rising `≤ ~0.56 m` above the floor is CLIMBED; `≥ ~0.77 m` reliably BLOCKS. So realistically
sized scatter rocks render but do not block. Blocking is an AUTHORING choice today — scale the
prop up, or give it a base-origin mesh and `anchor: "base"` — not an engine knob.

If that stops being acceptable, the two tools to weigh (a design decision, not an inline fix):

- **A `mesh` collision kind.** The catalog names one of the archetype's `.fmesh` variants (or a
  dedicated low-poly collision blob) and the loader builds a `trimesh` static body from it instead
  of a primitive. Faithful for any origin convention, at the cost of a real collision-asset
  pipeline (bake, budget, and a rule for which variant a multi-variant archetype collides as) and
  a per-prop trimesh where a primitive stands today.
- **A per-archetype blocking override.** A `collision.blocking: true` (or a minimum above-surface
  extent) that forces a prop to stop the mover regardless of its authored size — the "invisible
  wall" answer. Cheap, but it makes the collider stop describing the thing the player sees, and it
  needs a mover-side mechanism (suppressing step-up / rim-ride against entity colliders) that the
  field's own shell voxels must NOT inherit.

Prefer neither until a design actually asks for it: the current shape is honest (colliders
describe the mesh), and both options trade that away.

**Trigger to revisit:** the first design that needs invisible walls, or needs props to block the
player at their authored scatter sizes (a cluttered chamber that must read as impassable, a prop
used as level geometry).

**Reference:** `packages/dungeon/src/world/placement-collider.ts` (`placementCollider`,
the derived shape); `packages/core/src/field/placement-collision.ts` (`collisionExtentY` +
`collisionCenter`, the one function every consumer anchors through);
`packages/dungeon/src/agent/char-move.ts` (`resolve` step-up +
`applyGravity` rim-ride, the source of the 0.56 / 0.77 m thresholds);
`packages/dungeon/tests/field-placements.gpu.test.ts` (the derivation + walk-stop + anchor
lanes). Replaces the F3b-era `placement-props-stepped-over` entry under `docs/backlog/dungeon/`,
deleted here: D-F4-14 resolved its anchoring half, and this entry carries the rest.
