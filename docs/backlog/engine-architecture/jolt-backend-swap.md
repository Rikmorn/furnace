# Jolt as the physics scale-up backend (and/or consumer-selectable backend)

**Filed 2026-06-01** when the CPU-physics backend was resolved to **Rapier** (ADR 0001; `docs/research/rapier-vs-jolt-threading-debuggability.md`). This entry tracks the **deferred option to swap the physics backend to Jolt** — or to expose backend choice to consumers — once a real need arrives.

## Context

Rapier was chosen as the *simple start*: lowest wrapper cost for the immediate problem (the bowling demo), Rust/wasm-bindgen memory ergonomics (cascading `World.free()`), and a ready `-deterministic` package. The threading/scalability/debuggability evaluation surfaced a **genuine, deferred Jolt advantage**:

- **Jolt ships multithreaded wasm** (`jolt-physics/wasm-multithread`, since 0.28.0) that scales a **single** simulation across **all cores** via `JobSystemThreadPool`. The published `@dimforge/rapier3d` is **single-threaded wasm** (binary-verified): one core per `World`, with more cores reachable only by running independent worlds on separate Web Workers (data-parallel across non-interacting scenes, never one coupled scene).
- furnace runs physics **as wasm**, so it **cannot reach Rapier's native `rayon` parallel solver**. Single-scene multicore from Rapier would require furnace to build and maintain a custom `wasm-bindgen-rayon` Rapier wasm — unsupported, high-maintenance. Jolt provides single-scene multicore **off the shelf**.
- On native (the wry WebView furnace ships), Jolt's threading requirement (`SharedArrayBuffer` → `COOP`/`COEP` cross-origin isolation) is **self-administered** (furnace owns the origin/headers), not an external tax — so the Jolt path is more accessible on native than a browser-only framing implies.

**Why this is a cheap option, not a fork in the road:** the physics wrapper is **backend-neutral and thread-ready by design** (ADR 0001, Decision 7) — collision/contact events are a **drainable queue read after each `step()`**, never mid-step push-callbacks. That shape is portable across both engines and survives Jolt's Emscripten-worker model. So swapping Rapier→Jolt rewrites wrapper internals only; **consumer code is untouched**. The reversal cost is real but asymmetric, and the wrapper front-loads it.

## Trigger to revisit

Any **one** of:
1. **A demo or consumer need for single-scene multicore CPU physics** — heavy interactive rigid-body simulation that must scale across compute and *cannot* move to the GPU-resident track (i.e. gameplay-critical, per-frame-readback physics, not fire-and-forget visual sim). This is the primary trigger and maps onto the deferred job-system / compute-scalability ambition.
2. **A decision to offer a consumer-selectable backend** (`physics` API stays fixed; consumer picks Rapier vs Jolt at build/config time) — the "who knows" upside the neutral wrapper enables.
3. A Jolt-only featureset becoming a real gameplay need (soft bodies, large-scale destruction, etc.) — the original AAA-breadth flip condition from `cpu-physics-backend-comparison.md`.

Bowling and similar single-player, low-body-count, single-scene interactive physics do **not** trigger it — Rapier is the active backend for those.

## Evidence gaps to fill first (left open by the lighter research run)

When triggered, resolve these before committing to the swap (detailed in `docs/research/rapier-vs-jolt-threading-debuggability.md` §Open gaps):
1. **Jolt's debug wasm** — what `jolt-physics` actually exposes from JS (debug-render geometry, runtime introspection). Repo: https://github.com/jrouwe/JoltPhysics.js — uncharacterized.
2. **Jolt threaded JS callbacks** — has an official/safe path landed since the 2024 `JoltPhysics.js#134`/`#110` discussion, or is the unofficial post-js worker swizzle still required? Determines how thread-ready a Jolt wrapper really is. (Less critical if the wrapper holds the drainable-event shape, which sidesteps cross-worker callbacks.)
3. **Rapier multi-world-on-workers + `wasm-bindgen-rayon` Rapier** — confirm whether either is a real, used scaling path before assuming Jolt is the *only* multicore option.
4. **Jolt wasm determinism** — guarantee + any optimization trade-off analogous to Rapier's `-deterministic` vs SIMD/parallel mutual exclusion.

## Reference

- ADR: `docs/reference/adr/0001-physics-two-track-architecture.md` (Decision 6–7, Consequences, Resolved 2026-06-01)
- Research: `docs/research/rapier-vs-jolt-threading-debuggability.md` (this evaluation), `docs/research/cpu-physics-backend-comparison.md` (the original Rapier-vs-Jolt comparison)
- Related: `cpu-authoritative-gameplay-physics.md` (deferred determinism/networking remainder), `gpu-resident-physics.md` (the deferred GPU visual/throughput track — note: NOT a substitute for multicore *interactive* CPU physics)
