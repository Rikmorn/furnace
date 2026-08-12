---
summary: swapping the physics backend to Jolt, or exposing backend choice, for single-scene multicore and ghost-free mesh collision
---

# Jolt as the physics scale-up backend (and/or consumer-selectable backend)

**Filed 2026-06-01** when the CPU-physics backend was resolved to **Rapier** (ADR 0001; `docs/research/rapier-vs-jolt-threading-debuggability.md`). This entry tracks the **deferred option to swap the physics backend to Jolt** — or to expose backend choice to consumers — once a real need arrives.

## Context

Rapier was chosen as the *simple start*: lowest wrapper cost for the immediate problem (the bowling demo), Rust/wasm-bindgen memory ergonomics (cascading `World.free()`), and a ready `-deterministic` package. The threading/scalability/debuggability evaluation surfaced a **genuine, deferred Jolt advantage**:

- **Jolt ships multithreaded wasm** (`jolt-physics/wasm-multithread`, since 0.28.0) that scales a **single** simulation across **all cores** via `JobSystemThreadPool`. The published `@dimforge/rapier3d` is **single-threaded wasm** (binary-verified): one core per `World`, with more cores reachable only by running independent worlds on separate Web Workers (data-parallel across non-interacting scenes, never one coupled scene).
- furnace runs physics **as wasm**, so it **cannot reach Rapier's native `rayon` parallel solver**. Single-scene multicore from Rapier would require furnace to build and maintain a custom `wasm-bindgen-rayon` Rapier wasm — unsupported, high-maintenance. Jolt provides single-scene multicore **off the shelf**.
- On native (the wry WebView furnace ships), Jolt's threading requirement (`SharedArrayBuffer` → `COOP`/`COEP` cross-origin isolation) is **self-administered** (furnace owns the origin/headers), not an external tax — so the Jolt path is more accessible on native than a browser-only framing implies.

**Why this is a cheap option, not a fork in the road:** the physics wrapper is **backend-neutral and thread-ready by design** (ADR 0001, Decision 7) — collision/contact events are a **drainable queue read after each `step()`**, never mid-step push-callbacks. That shape is portable across both engines and survives Jolt's Emscripten-worker model. So swapping Rapier→Jolt rewrites wrapper internals only; **consumer code is untouched**. The reversal cost is real but asymmetric, and the wrapper front-loads it.

## Slice 2.2.1 spike finding — a *second* reason to swap: edge-aware mesh collision (2026-06-22)

A second, independent motivation arrived from the procgen collision work. The generated
Surface-Nets render mesh suffers internal-edge "ghost collisions" under Rapier's `trimesh`
(no internal-edge filtering); Slice 2.2.1 worked around it with blocky **voxel** colliders.
A throwaway headless spike confirmed **Jolt's `CharacterVirtual` walks those exact generated
trimeshes ghost-free** (single-frame deflection never exceeds the walk step on any surface)
— so the endgame is **field → Surface-Nets mesh → collide on Jolt** (the NMS pattern),
adopting Jolt's `CharacterVirtual` KCC in place of the custom `CharacterMover`, with voxels
retired. Full method/results/caveats: `docs/learnings/jolt-mesh-collision-spike.md`.

Spike-verified facts that shrink the swap's risk:
- `jolt-physics@1.0.0` exposes the needed surface from JS (`MeshShapeSettings`,
  `CharacterVirtual`/`ExtendedUpdate`, `CapsuleShape`, `mEnhancedInternalEdgeRemoval` on
  both body and character; partially fills evidence gap #1 below).
- Bundle ≈ +0.4 MB (~30%) over Rapier-compat (Jolt wasm ~1.99 MB vs ~1.57 MB) — modest.
- Single-thread `wasm-compat` build needs **no** cross-origin isolation → fits browser-only
  core. (Multicore — the original trigger — still needs isolation.)
- **Nuance for the implementer:** `mEnhancedInternalEdgeRemoval` *pins* the character at
  curved walls instead of sliding; clean floor traversal needs no flag. Don't blindly enable
  it — evaluate slide feel.

## Trigger to revisit

Any **one** of:
1. **A demo or consumer need for single-scene multicore CPU physics** — heavy interactive rigid-body simulation that must scale across compute and *cannot* move to the GPU-resident track (i.e. gameplay-critical, per-frame-readback physics, not fire-and-forget visual sim). This is the primary trigger and maps onto the deferred job-system / compute-scalability ambition.
2. **A decision to offer a consumer-selectable backend** (`physics` API stays fixed; consumer picks Rapier vs Jolt at build/config time) — the "who knows" upside the neutral wrapper enables.
3. A Jolt-only featureset becoming a real gameplay need (soft bodies, large-scale destruction, etc.) — the original AAA-breadth flip condition from `cpu-physics-backend-comparison.md`.
4. **Edge-aware mesh collision for procgen geometry** (added 2026-06-22) — wanting to
   collide the detailed Surface-Nets render mesh directly (ghost-free) and retire the blocky
   voxel proxies. Spike-confirmed viable (see the Slice 2.2.1 section above). This is a
   dungeon/Epic-2 trigger; first step would be a Rapier-vs-Jolt A/B regression test on the
   identical chamber mesh (the gold-standard the spike deferred).

Bowling and similar single-player, low-body-count, single-scene interactive physics do **not** trigger it — Rapier is the active backend for those.

## Evidence gaps to fill first (left open by the lighter research run)

When triggered, resolve these before committing to the swap (detailed in `docs/research/rapier-vs-jolt-threading-debuggability.md` §Open gaps):
1. **Jolt's debug wasm** — what `jolt-physics` actually exposes from JS (debug-render geometry, runtime introspection). Repo: https://github.com/jrouwe/JoltPhysics.js. *Partially characterized 2026-06-22:* the core sim/mesh/character surface is confirmed bound and usable headless (see the Slice 2.2.1 spike section + `docs/learnings/jolt-mesh-collision-spike.md`); the debug-render/introspection surface specifically is still uncharacterized.
2. **Jolt threaded JS callbacks** — has an official/safe path landed since the 2024 `JoltPhysics.js#134`/`#110` discussion, or is the unofficial post-js worker swizzle still required? Determines how thread-ready a Jolt wrapper really is. (Less critical if the wrapper holds the drainable-event shape, which sidesteps cross-worker callbacks.)
3. **Rapier multi-world-on-workers + `wasm-bindgen-rayon` Rapier** — confirm whether either is a real, used scaling path before assuming Jolt is the *only* multicore option.
4. **Jolt wasm determinism** — guarantee + any optimization trade-off analogous to Rapier's `-deterministic` vs SIMD/parallel mutual exclusion.

## Reference

- ADR: `docs/reference/adr/0001-physics-two-track-architecture.md` (Decision 6–7, Consequences, Resolved 2026-06-01)
- Research: `docs/research/rapier-vs-jolt-threading-debuggability.md` (this evaluation), `docs/research/cpu-physics-backend-comparison.md` (the original Rapier-vs-Jolt comparison)
- Related: `physics-tracks.md` §CPU-authoritative physics (deferred determinism/networking remainder), `physics-tracks.md` §GPU-resident physics (the deferred GPU visual/throughput track — note: NOT a substitute for multicore *interactive* CPU physics)
