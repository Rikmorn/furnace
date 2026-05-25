# Engine-managed alpha interpolation for mesh transforms

`frame.fixedLoop` exposes `alpha` (accumulator / fixedDtMs) in its `onFrame` callback, but applying it — keeping a previous-tick state, lerping/slerping between previous and current at render time — is consumer code. For mesh transforms specifically that boilerplate is identical every time:

```ts
prevQuat = currQuat;
currQuat = advance(...);
// per render:
quat.slerp(displayQuat, prevQuat, currQuat, alpha);
mesh.setRotation(m, displayQuat);
```

A future engine API could absorb this:

```ts
mesh.tickTransform(m, { rotation, position, scale });  // records as current; previous = prior current
frame.render(ctx, { draw, camera, alpha });            // engine lerps/slerps internally
```

Each mesh gains one extra transform slot (~28 bytes for prev quat + vec3 + vec3); `frame.render` accepts an optional `alpha` (default 1 = no interpolation, render `current`).

## Why not now

- Generic "interpolatable state" is hard: positions lerp, rotations slerp, colors are color-space-dependent, scales are arguably multiplicative, discrete state can't interpolate at all, and userland game state isn't engine-owned. The narrow case (mesh transforms) is unambiguous, but the broader case bleeds into ECS-style component interpolation that we shouldn't pre-commit to.
- Only one current call-site (the cookbook animation demo) needs the pattern. Two reimplementations isn't a pattern; three is. Wait for the signal.
- The cookbook demo IS the right place to teach the pattern by hand right now — readers see exactly what's happening, not "magic interpolation inside `render()`".

## What to verify when picking this up

- Render-side `alpha` defaults to 1 (no interpolation) so existing call sites are unaffected.
- `mesh.tickTransform` is opt-in — meshes that use `mesh.setRotation`/`setPosition`/`setScale` directly continue to work, no double-buffering overhead.
- Slerp for quat (handle the antipodal case); lerp for vec3.
- The cookbook animation demo collapses from inline prev/curr/lerp bookkeeping to one `mesh.tickTransform` call per tick.

**Trigger to revisit:** A second or third consumer reimplements the prev-quat/curr-quat/slerp-on-alpha boilerplate. Or: a frame-loop-related consumer ergonomics issue surfaces that this would address.

**Reference:** Pattern taught in `packages/cookbook/src/demos/animation/` (post the 2026-05-25 honest-fix refactor). `frame.fixedLoop`'s `alpha` field is the primitive this would build on.
