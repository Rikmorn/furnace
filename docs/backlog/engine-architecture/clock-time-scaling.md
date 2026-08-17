---
summary: slow-mo, pause and single-step already compose on `frame.fixedClock` with zero engine surface; what stays deferred is a discoverable `clock.tick()` or `setTimeScale` convenience on `FixedClock`
---

# Time scaling (slow-mo, fast-forward, pause-via-scale)

> **Shipped as a demo-side recipe (Stage 4B, 2026-06-04):** slow-mo / pause /
> single-step all compose on the existing `frame.fixedClock` with ZERO engine
> surface — `advance(deltaMs * timeScale)`, `timeScale = 0`, and
> `advance(fixedDtMs)` (exactly one tick, by the accumulator-`< fixedDtMs`
> invariant). Documented in `engine-conventions.md §Time`; the bowling demo wires
> the controls. STILL DEFERRED: a discoverable `clock.tick()` and/or
> `setTimeScale` convenience on `FixedClock`. **Revisit trigger:** the
> `advance(fixedDtMs)` single-step idiom proves unergonomic across multiple
> demos/consumers.

Time-scaling layered on `frame.fixedClock` via a `timeScale` multiplier on the simulation clock. `timeScale = 0.5` runs simulation at half speed (slow-mo); `timeScale = 2.0` runs at double speed; `timeScale = 0` pauses simulation entirely while still allowing render to update. Render-side `alpha` interpolation continues to work correctly because it's based on the simulation clock (the `alpha` that `clock.advance` returns), not real time.

API sketch: the cheap path needs no new engine surface — the consumer scales the delta it feeds the clock: `clock.advance(deltaMs * timeScale, onTick)` (`timeScale = 0` → feed `0` → render still runs, sim freezes). What scaling *can't* express is single-tick debug stepping ("run exactly one tick"), which wants a dedicated `clock.tick()` / `clock.step()` primitive on `FixedClock`. Decide at brainstorm whether to ship just the consumer-scaled-delta recipe (documented, zero new surface), a `setTimeScale` convenience on the clock, or the `tick()` primitive.

Useful for: bullet-time gameplay effects, debug stepping ("run 1 tick at a time"), demos that want to replay events at slower speed, performance debugging (run at 0.1x to inspect rapid events).

Doesn't affect input handlers or `frame.loop` (the variable-timestep render loop, unchanged); only the `frame.fixedClock` simulation clock.

**Trigger to revisit:** When a demo or game needs any of the above effects. Specifically when debug stepping becomes useful for inspecting physics behavior (likely concurrent with `physics` arriving).

**Reference:** Core architecture design § "Rendering API".
