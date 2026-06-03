# Re-export Vec3Tuple / QuatTuple from @furnace/core/physics

**Filed 2026-06-03** during Stage 2 (surfaced by the cookbook physics demo). Adjacent finding — engine-API hygiene, not blocking.

## Context

`BodyDescriptor` (the `physics.createBody` input) exposes `position`, `angularVelocity`,
`linearVelocity` (Vec3Tuple) and `rotation` (QuatTuple) to consumers. But `Vec3Tuple`/
`QuatTuple` are defined in `packages/core/src/physics/types.ts` and NOT re-exported from
the public barrel `packages/core/src/physics/index.ts`. A consumer building `BodyDescriptor`
literals can't name the tuple type — the Stage 2 cookbook `physics` demo had to hand-roll a
local `type Tuple3 = readonly [number, number, number]` (`packages/cookbook/src/demos/physics/entry.ts`).

## Why deferred

Not blocking (the local alias works; tuple literals are inferred at the call site). It's a
small public-surface completeness gap, worth doing as part of a deliberate physics-surface
review rather than a one-off so the export set (Vec3Tuple, QuatTuple, and any siblings) is
chosen coherently.

## Trigger to revisit

Next time the `@furnace/core/physics` public surface is touched, OR a second consumer needs
to name these tuple types. Fix: re-export `Vec3Tuple`/`QuatTuple` from `physics/index.ts`
(and update the demo to drop its local alias). Check whether the engine already has a canonical
tuple type elsewhere (e.g. transform) that physics should reference instead of its own.

## Reference

- Surfaced: Stage 2 Task 6 (cookbook physics demo) code-quality + spec reviews.
- Spec: `docs/superpowers/specs/2026-06-03-physics-stage-2-sim-render-binding-design.md`.
