# Physics body-setter surface (teleport / impulse / angular)

**Filed 2026-06-04** (Stage 4A — "Playable Core"). Stage 4A added `setBodyLinearVelocity` — the FIRST setter on the body API (the wrapper previously had getters only: `getBodyTranslation`/`getBodyRotation`). This entry tracks the further runtime body setters, deferred to scope-to-need.

## Context

`setBodyLinearVelocity(ctx, body, v)` (→ Rapier `setLinvel`) was added because imparting motion to an existing body is the fundamental "playable" primitive (the bowling throw). It is runtime-quiet (warn on non-finite, silent no-op on stale handle) and pure pass-through to Rapier.

Natural siblings, NOT added because no current consumer needs them:
- **`setBodyTranslation(ctx, body, p)`** (teleport) — Rapier `setTranslation`. Wanted by: respawn-elsewhere, portal, editor drag, snap-to-grid.
- **`setBodyRotation(ctx, body, q)`** — Rapier `setRotation`. Wanted by: oriented respawn, editor.
- **`setBodyAngularVelocity(ctx, body, w)`** — Rapier `setAngvel`. Wanted by: spin/torque-style throws, spin-up.
- **`applyImpulse(ctx, body, j)` / `applyForce` / `applyTorqueImpulse`** — Rapier `applyImpulse`/`addForce`/`applyTorqueImpulse`. Mass-aware (impulse → Δvelocity scaled by mass), distinct ergonomics from the direct `setLinvel` "kick". Wanted by: explosions, knockback, wind, jumps where mass should matter.

All are pure pass-through (gate-rule clean) — each hands a value/vector straight to Rapier, no JS-side physics math. They'd mirror `setBodyLinearVelocity`'s shape exactly (runtime-quiet failure policy, `ctx` first, hot-path setter classification in `api-posture.md`).

**Note on the kinematic gap:** `setBodyTranslation` on a *dynamic* body is a Rapier "next-kinematic-position" style move vs. a hard teleport; furnace should expose whichever Rapier gives cleanly and document the semantics, not compute interpolation itself.

## Trigger to revisit

First consumer/demo needing a specific one:
- teleport/respawn-elsewhere → `setBodyTranslation`
- explosion/knockback/jump where mass matters → `applyImpulse`
- spin-throw / torque → `setBodyAngularVelocity` / `applyTorqueImpulse`

Add only the setter(s) the need requires, mirroring `setBodyLinearVelocity`. Don't ship the whole quartet speculatively.

## Reference

- Origin: Stage 4A (`setBodyLinearVelocity`, the "first setter"; surfaced in the stage's adjacent findings).
- Decision: setBodyLinearVelocity setter (not spawn-on-launch) + the gate-rule of pure pass-through to Rapier.
- Impl: `packages/core/src/physics/body.ts` (`setBodyLinearVelocity` — the shape to mirror)
- API: `docs/reference/core-modules.md` `@furnace/core/physics`; `docs/reference/api-posture.md` (setter classification)
