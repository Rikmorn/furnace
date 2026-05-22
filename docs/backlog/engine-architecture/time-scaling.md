# Time scaling (slow-mo, fast-forward, pause-via-scale)

Variation on `frame.fixedLoop` that exposes a `timeScale` multiplier. `timeScale = 0.5` runs simulation at half speed (slow-mo); `timeScale = 2.0` runs at double speed; `timeScale = 0` pauses simulation entirely while still allowing render to update. Render-side `alpha` interpolation continues to work correctly because it's based on the simulation clock, not real time.

API sketch: `frame.fixedLoop(ctx, { fixedDt, timeScale: () => 0.5, onTick, onFrame })` — function-shaped so consumer can change scale live. Or method on the returned handle: `loopHandle.setTimeScale(0.3)`.

Useful for: bullet-time gameplay effects, debug stepping ("run 1 tick at a time"), demos that want to replay events at slower speed, performance debugging (run at 0.1x to inspect rapid events).

Doesn't affect input handlers or `frame.loop` (variable timestep); only the fixed-step simulation clock.

**Trigger to revisit:** When a demo or game needs any of the above effects. Specifically when debug stepping becomes useful for inspecting physics behavior (likely concurrent with `physics` arriving).

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Rendering API".
