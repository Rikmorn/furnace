# CharacterMover gets stuck in curved generated trimesh walls (pits/caves)

**Context.** Slice 2.1.1's custom `CharacterMover`
(`packages/dungeon/src/char-move.ts`) walks generated *floors* well: ground
detection uses a downward raycast (`physics.castRay`), which reads a clean face
normal and so dodges the trimesh internal-edge ghost contacts that stalled the
built-in Rapier KCC. But when the player **falls into the generated holes** (the
grotto pit / vertical shaft) it gets **stuck in the curved generated trimesh
walls**. Straight authored cuboid walls are fine; the curved generated trimesh
walls are not.

Likely cause: the horizontal collide-and-slide *shapecast* (`slideHorizontal`,
via `physics.castShape`) catches trimesh internal-edge ghost contacts (corrupted
contact normals) and/or the controller has **no depenetration step** — so once
the capsule penetrates the curved trimesh (e.g. during a fast fall in) it cannot
push back out. This is the **wall analogue** of the floor-jitter problem fixed in
2.1.1: the floor was solved by switching ground detection to a downward ray; the
walls still rely on the shapecast and so remain exposed to the same trimesh
internal-edge pathology.

**Fix sketch.**
- Add a **depenetration pass** — push the capsule out of any current overlap
  (e.g. via a future `physics.intersectionWithShape` + contact normal) before /
  after the slide so a penetrated capsule can recover.
- And/or **detect & handle trimesh internal-edge normals** in `slideHorizontal`
  (reject/clamp degenerate contact normals so a slide doesn't clip into the
  mesh).
- Possibly a small **unstuck-recovery** (nudge toward last-known-good position).

Note: the underlying primitive `intersectionWithShape` is available in the
vendored Rapier 0.19.3 (per the slice spec) but is **not yet wrapped in core** —
a depenetration fix needs that wrap first.

**Trigger to revisit.** When descending into / navigating the pits & caves
becomes in-scope (procedural-layout 2.2+, or a descent mechanic), or if players
report getting stuck in the generated walls.

**Reference.** `packages/dungeon/src/char-move.ts` (`slideHorizontal`); the 2.1.1
jitter fix (the floor counterpart, downward-ray ground detection); `physics.castShape`
/ future `physics.intersectionWithShape`; memory `project_dungeon_epic2_procgen`.
