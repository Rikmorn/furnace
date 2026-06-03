# Fixed-step state interpolation — consumer-led pattern

## Engine posture

When animating with a fixed-step clock (`frame.fixedClock`, advanced from inside `frame.loop`), state advances in discrete ticks at a chosen rate while rendering happens per-RAF at the screen's refresh rate. At low fixed-Hz the mismatch is visible as stutter — the cure is to lerp between the previous-tick and current-tick state at render time using the `alpha` that `frame.fixedClock.advance` returns.

The engine ships the **math primitives** — `vec3.lerp`, `quat.slerp`, the `alpha` value from `frame.fixedClock.advance`, and the matrix math — and stops there. It deliberately does **not** ship a higher-level abstraction that stores prev/curr slots per object, copies state tick-to-tick, or auto-plumbs `alpha` through `frame.render`. That layer is consumer-owned: where prev/curr storage lives, which state types participate, lerp-vs-slerp-vs-discrete per field, and whether render reads loop state are all application-specific decisions that constrain consumers in ways that are hard to undo.

## How a consumer implements this

The pattern, in pseudocode:

```ts
// Storage: two slots per interpolated value.
let prevAngle = 0;
let currAngle = 0;

// Per fixed-step tick (inside fixedClock's onTick callback):
prevAngle = currAngle;
currAngle += fixedDtSec * rate;

// Per render frame:
const alpha = clock.advance(deltaMs, onTick);  // runs onTick per elapsed step
const displayAngle = prevAngle + (currAngle - prevAngle) * alpha;  // scalar lerp
mesh.setRotation(m, quatFromYaw(displayAngle));
```

For rotations, use `quat.slerp(out, prevQuat, currQuat, alpha)` — slerp handles the antipodal case that a naive component-wise lerp gets wrong at large angles. For positions, scales, and other vec3 state, `vec3.lerp(out, prevVec, currVec, alpha)` is the right call. For scalars, the inline `a + (b - a) * t` formula above is fine.

Worked example: `packages/cookbook/src/demos/animation/entry.ts` — three cubes side-by-side comparing variable-dt vs fixed-step-no-interp vs fixed-step-with-alpha-interp, all driven by one `frame.loop` + a `frame.fixedClock`. Read the `frame:` body for the canonical loop, and the `state.svelte.ts` shape for the prev/curr storage convention.

## Future direction

A thin engine-side helper that absorbs prev/curr storage and auto-applies the lerp at render time (e.g. `mesh.tickTransform(m, { rotation, position, scale })` + an `alpha` param on `frame.render`) is conceivable if multiple consumer applications converge on identical storage shapes for the same kinds of state. Not on the roadmap — surfaced here so the design space isn't reinvented if the signal arrives.

The physics `rigidMesh` composite (`@furnace/core/rigid-mesh`, Stage 2) realises engine-owned prev/curr storage + alpha-blend **for the physics-renderable case** in its own module: a `Body` is the gameplay truth, a `Mesh` is the smoothed visual output, and the binding is opt-in per body. `rigidMesh.commit` (per fixed tick) snapshots the body pose into prev/curr; `rigidMesh.interpolate(ctx, rm, alpha)` (per render frame) blends them into the mesh with `vec3.lerp` / `quat.slerp`. This matches how Unity, Godot, Avian, and `@react-three/rapier` bind a physics body to a smoothed render transform. It does **not** generalise the all-meshes version above — `mesh.tickTransform` + `alpha` on `frame.render` for arbitrary (non-physics) state stays deferred, and the consumer recipe in this doc remains the path for non-composite meshes.

## References

- `packages/cookbook/src/demos/animation/entry.ts` — canonical worked example.
- `packages/core/src/frame/fixed-clock.ts` — the `alpha` value's source.
- `packages/core/src/transform/quat.ts` — `slerp` for rotations.
- `packages/core/src/transform/vec3.ts` — `lerp` for positions/scales.
