# Physics body setters

Tracker for the deferred runtime body-mutation surface on `@furnace/core/physics`:
the further body setters beyond the one `setBodyLinearVelocity` that Stage 4A shipped
(teleport / rotation / angular velocity / impulses), and the `rigidMesh` interpolation
`reset` that must ship *with* any in-place teleport API to avoid a one-tick smear.
They are merged because they are a coherent pair — an in-place set-pose / teleport API
is useless without the interpolation reset, and the reset is useless without teleport —
and share the "first consumer needing to move an existing body" trigger.

## Physics body-setter surface (teleport / impulse / angular)

**Filed 2026-06-04** (Stage 4A — "Playable Core"). Stage 4A added `setBodyLinearVelocity` — the FIRST setter on the body API (the wrapper previously had getters only: `getBodyTranslation`/`getBodyRotation`). This entry tracks the further runtime body setters, deferred to scope-to-need.

### Context

`setBodyLinearVelocity(ctx, body, v)` (→ Rapier `setLinvel`) was added because imparting motion to an existing body is the fundamental "playable" primitive (the bowling throw). It is runtime-quiet (warn on non-finite, silent no-op on stale handle) and pure pass-through to Rapier.

Natural siblings, NOT added because no current consumer needs them:
- **`setBodyTranslation(ctx, body, p)`** (teleport) — Rapier `setTranslation`. Wanted by: respawn-elsewhere, portal, editor drag, snap-to-grid.
- **`setBodyRotation(ctx, body, q)`** — Rapier `setRotation`. Wanted by: oriented respawn, editor.
- **`setBodyAngularVelocity(ctx, body, w)`** — Rapier `setAngvel`. Wanted by: spin/torque-style throws, spin-up.
- **`applyImpulse(ctx, body, j)` / `applyForce` / `applyTorqueImpulse`** — Rapier `applyImpulse`/`addForce`/`applyTorqueImpulse`. Mass-aware (impulse → Δvelocity scaled by mass), distinct ergonomics from the direct `setLinvel` "kick". Wanted by: explosions, knockback, wind, jumps where mass should matter.

All are pure pass-through (gate-rule clean) — each hands a value/vector straight to Rapier, no JS-side physics math. They'd mirror `setBodyLinearVelocity`'s shape exactly (runtime-quiet failure policy, `ctx` first, hot-path setter classification in `api-posture.md`).

**Note on the kinematic gap:** `setBodyTranslation` on a *dynamic* body is a Rapier "next-kinematic-position" style move vs. a hard teleport; furnace should expose whichever Rapier gives cleanly and document the semantics, not compute interpolation itself.

### Trigger to revisit

First consumer/demo needing a specific one:
- teleport/respawn-elsewhere → `setBodyTranslation`
- explosion/knockback/jump where mass matters → `applyImpulse`
- spin-throw / torque → `setBodyAngularVelocity` / `applyTorqueImpulse`

Add only the setter(s) the need requires, mirroring `setBodyLinearVelocity`. Don't ship the whole quartet speculatively. Note: an in-place teleport setter must land together with the `rigidMesh` interpolation reset in the *rigidMesh teleport / interpolation-reset* section below.

### Reference

- Origin: Stage 4A (`setBodyLinearVelocity`, the "first setter"; surfaced in the stage's adjacent findings).
- Decision: setBodyLinearVelocity setter (not spawn-on-launch) + the gate-rule of pure pass-through to Rapier.
- Impl: `packages/core/src/physics/body.ts` (`setBodyLinearVelocity` — the shape to mirror)
- API: `docs/reference/core-modules.md` `@furnace/core/physics`; `docs/reference/api-posture.md` (setter classification)

## rigidMesh teleport / interpolation-reset

**Filed 2026-06-03** during Stage 2 (sim↔render binding). Deferred — no Stage 2 consumer.

### Context

`rigidMesh` (Stage 2) owns prev/curr interpolation buffers. When a body is moved
*in place* (teleported) rather than simulated, prev≠curr across the jump and
`interpolate` smears the mesh across it for one tick. The fix is a `reset(ctx, rm)`
that collapses `prev = curr = body pose` (Godot ships `reset_physics_interpolation`
for exactly this).

### Why deferred

`reset` has no reachable consumer in Stage 2: Stage 1 physics sets a body's pose
only at `createBody`, so there is **no API to move an existing body in place**.
The Stage 2 demo's reset/replay re-drops via destroy+recreate (`create` re-seeds
prev=curr → no smear). `reset` and a body in-place set-pose API are a coherent
pair — `reset` is useless without teleport, teleport-without-`reset` smears (the
teleport setter itself is tracked in the *Physics body-setter surface* section above).

### Trigger to revisit

A body in-place set-pose / teleport API lands (e.g. `physics.setBodyPose`), OR a
scene wants reposition-without-recreate. Ship `reset(ctx, rm)` (≈6 lines: read
body pose into prev and curr) **with** that teleport API. The set-pose API is its
own design decision (velocity-zeroing, wake semantics, `setTranslation` vs
`setNextKinematicTranslation`).

### Reference

- Prior art: Godot `reset_physics_interpolation()`.
