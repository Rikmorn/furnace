# Fixed-step state interpolation — consumer-led pattern

## Engine posture

When animating with a fixed-step loop (`frame.fixedLoop`, or an inline accumulator over `frame.loop`), state advances in discrete ticks at a chosen rate while rendering happens per-RAF at the screen's refresh rate. At low fixed-Hz the mismatch is visible as stutter — the cure is to lerp between the previous-tick and current-tick state at render time using `alpha = accumulator / fixedDtMs` (which `frame.fixedLoop` provides to `onFrame`).

The engine ships the **math primitives** (`quat.slerp`, the `alpha` value from `frame.fixedLoop`, the matrix math) and stops there. It does **not** ship a higher-level abstraction that stores prev/curr slots per object, copies state tick-to-tick, or auto-plumbs `alpha` through `frame.render`. That layer is consumer-owned. Each of the decisions involved — where prev/curr storage lives, which state types participate, lerp-vs-slerp-vs-discrete per field, whether render reads loop state — would constrain consumers in ways that are hard to undo, and only one demo currently needs the pattern at all.

## How to implement this in a consumer

The pattern, in pseudocode:

```ts
// Storage: two slots per interpolated value.
let prevAngle = 0;
let currAngle = 0;

// Per fixed-step tick (inside the accumulator's while loop):
prevAngle = currAngle;
currAngle += fixedDtSec * rate;

// Per render frame:
const alpha = accumulatorMs / fixedDtMs;
const displayAngle = prevAngle + (currAngle - prevAngle) * alpha;  // scalar lerp
mesh.setRotation(m, quatFromYaw(displayAngle));
```

For rotations specifically, use `quat.slerp(out, prevQuat, currQuat, alpha)` — `slerp` handles the antipodal case that a naive component-wise lerp gets wrong at large angles. For vec3 (positions, scales) the inline formula above is correct; the engine doesn't currently ship a `vec3.lerp` since no consumer has needed one yet (trivial to add when that changes).

Worked example: `packages/cookbook/src/demos/animation/entry.ts` — three cubes side-by-side comparing variable-dt vs fixed-step-no-interp vs fixed-step-with-alpha-interp, all driven by one `frame.loop` with the accumulator inlined. Read the `frame:` body for the canonical loop, and the `state.svelte.ts` shape for the prev/curr storage convention.

## Possible future helper (distant)

If multiple consumer applications — not the cookbook — converge on *identical* storage shapes for the same kinds of state (e.g., several apps independently grow a "transform with prev/curr slots that auto-lerps on render" abstraction), a thin engine-side helper would pay rent. The shape would probably look something like:

```ts
mesh.tickTransform(m, { rotation, position, scale });  // records as current; previous = prior current
frame.render(ctx, { draw, camera, alpha });            // engine slerps/lerps internally
```

…with `alpha` defaulting to 1 (no interpolation) so existing call sites are unaffected, and `mesh.tickTransform` being opt-in. We're nowhere near this. Calling it out so future-us doesn't have to reinvent the design space when the signal finally arrives.

**Trigger to revisit:** Two or more independent consumer applications (not the cookbook) reimplement the same prev/curr storage shape with the same lerp/slerp semantics. Until then this stays consumer-led and the engine deliberately stops at the math primitives.

**Reference:** `packages/cookbook/src/demos/animation/entry.ts` for the canonical worked example. `frame.fixedLoop` for the `alpha` value. `packages/core/src/transform/quat.ts` for `slerp`.
