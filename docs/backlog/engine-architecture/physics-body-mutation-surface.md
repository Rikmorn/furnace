---
summary: the body setters beyond `setBodyLinearVelocity` (teleport, rotation, angular velocity, impulses) and the `rigidMesh` interpolation `reset` that must ship with any in-place teleport to avoid a one-tick smear
---

# Physics body-mutation surface — the further setters and the `rigidMesh` interpolation reset

The deferred runtime body-mutation surface on `@furnace/core/physics`: the further body
setters beyond the one `setBodyLinearVelocity` that Stage 4A shipped (teleport / rotation /
angular velocity / impulses), and the `rigidMesh` interpolation `reset` that must ship *with*
any in-place teleport API to avoid a one-tick smear.

**This is one record, not two,** and stays one at the genre-contracts un-merge: an in-place
set-pose / teleport API is useless without the interpolation reset, the reset is useless
without teleport, and both fire on the same "first consumer needing to move an existing body"
trigger. Splitting them would produce two entries neither of which can be taken alone.

## The setter surface (teleport / impulse / angular)

**Filed 2026-06-04** (Stage 4A — "Playable Core"). Stage 4A added `setBodyLinearVelocity` — the FIRST setter on the body API (the wrapper previously had getters only: `getBodyTranslation`/`getBodyRotation`). This half tracks the further runtime body setters, deferred to scope-to-need.

`setBodyLinearVelocity(ctx, body, v)` (→ Rapier `setLinvel`) was added because imparting motion to an existing body is the fundamental "playable" primitive (the bowling throw). It is runtime-quiet (warn on non-finite, silent no-op on stale handle) and pure pass-through to Rapier.

Natural siblings, NOT added because no current consumer needs them:
- **`setBodyTranslation(ctx, body, p)`** (teleport) — Rapier `setTranslation`. Wanted by: respawn-elsewhere, portal, editor drag, snap-to-grid.
- **`setBodyRotation(ctx, body, q)`** — Rapier `setRotation`. Wanted by: oriented respawn, editor.
- **`setBodyAngularVelocity(ctx, body, w)`** — Rapier `setAngvel`. Wanted by: spin/torque-style throws, spin-up.
- **`applyImpulse(ctx, body, j)` / `applyForce` / `applyTorqueImpulse`** — Rapier `applyImpulse`/`addForce`/`applyTorqueImpulse`. Mass-aware (impulse → Δvelocity scaled by mass), distinct ergonomics from the direct `setLinvel` "kick". Wanted by: explosions, knockback, wind, jumps where mass should matter.

All are pure pass-through (gate-rule clean) — each hands a value/vector straight to Rapier, no JS-side physics math. They'd mirror `setBodyLinearVelocity`'s shape exactly (runtime-quiet failure policy, `ctx` first, hot-path setter classification in `api-posture.md`).

**Note on the kinematic gap:** `setBodyTranslation` on a *dynamic* body is a Rapier "next-kinematic-position" style move vs. a hard teleport; furnace should expose whichever Rapier gives cleanly and document the semantics, not compute interpolation itself.

## The interpolation reset that must ride with it

**Filed 2026-06-03** during Stage 2 (sim↔render binding). Deferred — no Stage 2 consumer.

`rigidMesh` (Stage 2) owns prev/curr interpolation buffers. When a body is moved
*in place* (teleported) rather than simulated, prev≠curr across the jump and
`interpolate` smears the mesh across it for one tick. The fix is a `reset(ctx, rm)`
that collapses `prev = curr = body pose` (Godot ships `reset_physics_interpolation`
for exactly this).

`reset` has no reachable consumer today: Stage 1 physics sets a body's pose
only at `createBody`, so there is **no API to move an existing body in place**.
The Stage 2 demo's reset/replay re-drops via destroy+recreate (`create` re-seeds
prev=curr → no smear).

**Trigger to revisit:** the first consumer or demo needing to move an existing body —
teleport / respawn-elsewhere → `setBodyTranslation`; explosion / knockback / jump where mass
matters → `applyImpulse`; spin-throw / torque → `setBodyAngularVelocity` /
`applyTorqueImpulse`; reposition-without-recreate → the same teleport API. Add only the
setter(s) the need requires, mirroring `setBodyLinearVelocity`; don't ship the whole quartet
speculatively. **An in-place teleport setter must land together with `reset(ctx, rm)`**
(≈6 lines: read the body pose into prev and curr) in the same change — teleport without
`reset` smears. The set-pose API is its own design decision (velocity-zeroing, wake
semantics, `setTranslation` vs `setNextKinematicTranslation`).

**Reference:**

- Origin: Stage 4A (`setBodyLinearVelocity`, the "first setter"; surfaced in the stage's adjacent findings).
- Decision: the `setBodyLinearVelocity` setter (not spawn-on-launch) + the gate-rule of pure pass-through to Rapier.
- Impl: `packages/core/src/physics/body.ts` (`setBodyLinearVelocity` — the shape to mirror)
- API: `docs/reference/core-modules.md` `@furnace/core/physics`; `docs/reference/api-posture.md` (setter classification)
- Prior art for the reset: Godot `reset_physics_interpolation()`.
