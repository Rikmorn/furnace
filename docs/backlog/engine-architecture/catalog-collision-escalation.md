# Catalog collision escalation: a `mesh` kind, or a per-archetype blocking override

F4's D-F4-14 gave the catalog `collision` schema an explicit `anchor: "center" | "base"` (default
`"center"`, so every pre-F4 catalog is unchanged). Core's `collisionCenter` /
`voxelizePlacements`, the dungeon's `field-world.ts` loader, and the editor's ghosts + prop
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

**Reference:** `packages/dungeon/src/field-world.ts` (`placementCollider`,
the derived shape); `packages/core/src/field/placement-collision.ts` (`collisionExtentY` +
`collisionCenter`, the one function every consumer anchors through);
`packages/dungeon/src/char-move.ts` (`resolve` step-up +
`applyGravity` rim-ride, the source of the 0.56 / 0.77 m thresholds);
`packages/dungeon/tests/field-placements.gpu.test.ts` (the derivation + walk-stop + anchor
lanes). Replaces the F3b-era `placement-props-stepped-over` entry under `docs/backlog/dungeon/`,
deleted here: D-F4-14 resolved its anchoring half, and this entry carries the rest.
