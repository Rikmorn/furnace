# rigidMesh teleport / interpolation-reset

**Filed 2026-06-03** during Stage 2 (sim↔render binding). Deferred — no Stage 2 consumer.

## Context

`rigidMesh` (Stage 2) owns prev/curr interpolation buffers. When a body is moved
*in place* (teleported) rather than simulated, prev≠curr across the jump and
`interpolate` smears the mesh across it for one tick. The fix is a `reset(ctx, rm)`
that collapses `prev = curr = body pose` (Godot ships `reset_physics_interpolation`
for exactly this).

## Why deferred

`reset` has no reachable consumer in Stage 2: Stage 1 physics sets a body's pose
only at `createBody`, so there is **no API to move an existing body in place**.
The Stage 2 demo's reset/replay re-drops via destroy+recreate (`create` re-seeds
prev=curr → no smear). `reset` and a body in-place set-pose API are a coherent
pair — `reset` is useless without teleport, teleport-without-`reset` smears.

## Trigger to revisit

A body in-place set-pose / teleport API lands (e.g. `physics.setBodyPose`), OR a
scene wants reposition-without-recreate. Ship `reset(ctx, rm)` (≈6 lines: read
body pose into prev and curr) **with** that teleport API. The set-pose API is its
own design decision (velocity-zeroing, wake semantics, `setTranslation` vs
`setNextKinematicTranslation`).

## Reference

- Prior art: Godot `reset_physics_interpolation()`.
