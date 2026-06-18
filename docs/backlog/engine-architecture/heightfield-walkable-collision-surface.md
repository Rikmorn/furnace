# Heightfield collider for non-overhang walkable ground

**Context.** Slice 2.1.1 ("Traversal Foundation") had to make generated trimesh
floors walkable. A Rapier capsule on a trimesh catches on the mesh's internal-edge
ghost collisions, so the slice considered two paths:

1. **A heightfield collider** — Rapier's `heightfield` shape is a regular grid of
   sampled heights. It is cheaper and far more robust for capsule traversal on large,
   open, *single-valued* terrain (no internal-edge ghosts; the solver treats it as a
   smooth surface). Its hard limitation: a heightfield is a height *function* over a
   grid — it cannot represent overhangs, caves, ceilings, or any geometry where the
   surface is multi-valued in `y` for a given `(x, z)`.
2. **A custom collide-and-slide controller** (the path taken) — owns ground/obstacle
   probing via the new `physics.castRay`/`castShape` primitives, so it walks arbitrary
   geometry including overhangs and caves, and is an extensible base for future
   traversal verbs (crouch/jump/mantle/climb/...).

2.1.1 chose to **OWN the custom controller** rather than the heightfield, because the
dungeon's go-forward geometry is cavernous (overhangs, descents, vertical shafts) that
a heightfield literally cannot express, and because the traversal track wants a
controller it can extend, not a collider primitive. The heightfield remains the better
tool for the *flat-ish open terrain* case if that case ever dominates.

**Trigger to revisit.** If the custom controller proves insufficient or too costly on
large open terrain (e.g. measured per-tick cast budget blows up over big walkable
fields, or robustness on broad flat ground is worse than a heightfield would give) —
adopt a heightfield collider for the non-overhang regions and keep the custom
controller for the cavernous ones.

**Reference.** Slice 2.1.1 spec/plan (local design scaffolding);
`packages/dungeon/src/char-move.ts` (the custom controller that was built instead);
memory `project_dungeon_epic2_procgen`.
