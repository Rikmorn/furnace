# Graduate dungeon collision to a Rapier kinematic character controller

**Context:** Epic 1 uses a simple game-side capsule-vs-AABB slide
(`slideMove`, `packages/dungeon/src/collision.ts`). It resolves the player
capsule against the level's axis-aligned boxes one axis at a time (independent
X/Z resolution), with a Y-band cull that ignores boxes outside the player's
height range so floors and ceilings don't block horizontal movement.

Two known limitations:

1. **Convex-corner clipping.** Because X and Z are resolved independently, a
   diagonal approach into the *outside* corner of a box can tunnel through the
   corner. This is inherent to per-axis resolution, not a bug to patch — the
   correct fix is a real swept/character-controller solver.
2. **Geometry assumptions.** It requires the level to be near-axis-aligned and
   floors/ceilings to be Y-cullable. Arbitrary (rotated, sloped, non-AABB)
   geometry isn't handled.

**Trigger to revisit:** Epic 2 procgen produces arbitrary (non-axis-aligned)
geometry → graduate to a Rapier kinematic character controller. The borrowed
physics already exists (the demo-1 CPU-authoritative physics work notes a Rapier
character-controller is available), so this is a swap, not a new dependency. Also
revisit earlier if the convex-corner clipping becomes noticeable in play.

**Reference:** `packages/dungeon/src/collision.ts` (`slideMove`, the corner-clip
limitation).
