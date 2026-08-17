# CPU physics backend comparison — choosing the borrow

> **Superseded / reframed 2026-06-01.** This comparison's conclusion ("Rapier LOCKED, Jolt = fallback") was the *starting* posture. The backend was subsequently reopened and re-resolved in `2026-06-01-rapier-vs-jolt-threading-debuggability.md` (threading / scalability / debuggability) and **ADR 0001**: Rapier is the chosen start, and **Jolt is the deferred *scale-up* backend — not a break-glass fallback.** Read the "fallback" language below as historical; current posture lives in `docs/backlog/engine-architecture/jolt-backend-swap.md`.

**Date:** 2026-06-01
**Context:** The physics pivot (`2026-06-01-gpu-resident-vs-cpu-gameplay-physics.md`) chose to *borrow* a CPU rigid-body engine for Demo 1 (bowling), wrapped behind furnace's own clean `physics` API. This picks which engine. Leading candidate going in: Rapier.
**Method:** Deep-research harness — 5 angles, 21 sources, 100 claims, 25 verified (3-vote). **25 confirmed / 0 refuted.** Important: the verified evidence is **asymmetric** — heavily Rapier-favoring; several criteria (headless TDD, bundle size, Jolt web-binding depth) were *not* verified. Confidence labels reflect that.

## Recommendation: **Rapier** (`@dimforge/rapier3d`) — LOCKED

Rapier clears every hard gate, and both furnace-specific spikes (headless `bun:test`, bundle size) came back green (see Spike results below). **Jolt (MIT, AAA-proven) is the documented fallback** if Rapier ever disappoints in integration.

## Ranked comparison

| Engine | 3D | License | Maintenance | Features | Determinism | Web-binding | Verdict |
|---|---|---|---|---|---|---|---|
| **Rapier** | ✅ official 2D+3D | ✅ Apache-2.0 (all pkgs) | ✅ active, ~monthly (0.19.3, 2025-11-05) | ✅ joints/queries/CCD/char-ctrl/events | ✅ opt-in (`-deterministic` pkg) | ✅ official `@dimforge/rapier3d` | **RECOMMENDED** |
| **Jolt** (`jolt-physics`) | ✅ | ✅ MIT | ✅ (founder-led; AAA-proven) | ✅ AAA-grade | ✅ opt-in (~8% slower) | ⚠ separate `JoltPhysics.js` port; web-depth not verified | **FALLBACK** |
| Box2D | ❌ 2D-only | ✅ MIT | ✅ | n/a (2D) | ✅ default | ✅ box2d-wasm | **DISQUALIFIED (2D)** |
| Havok / PhysX-js / ammo.js / cannon-es | — | — | — | — | — | — | **No surviving verified evidence** — can't rank |

## Findings (high-confidence unless noted)

- **3D + official bindings** [verified] — Rapier ships official 2D *and* 3D JS/TS bindings (Rust→wasm via wasm-bindgen). Satisfies the hard 3D requirement.
- **License** [verified] — Apache-2.0 across main, `-compat`, and `-deterministic` packages. Permissive, redistributable inside a browser-only ESM core. Obligation: attribution/NOTICE preservation. (Jolt's MIT is marginally more permissive but not decisive.)
- **Maintenance** [verified] — 0.19.3 (2025-11-05), monthly cadence; dimforge's 2025-review confirms ongoing work (new BVH, voxel colliders, web package 2–5× faster than 2024). Bus-factor caveat: founder-led (Sébastien Crozet / dimforge).
- **Features** [verified] — joints (motorized PD + multibody), raycasts/scene queries (`intersectionsWithRay`, `castShape`), CCD, kinematic character controller, per-collider contact/sensor events. Everything the gameplay-physics growth surface needs.
- **Determinism nuance** [verified] — since v0.15.0 the *default* `rapier3d` is built **without** enhanced-determinism (locally deterministic only). Cross-platform determinism is a **separate** `@dimforge/rapier3d-deterministic` package (also 0.19.3, Apache-2.0, lockstep-released, *less optimized → slower by design*). Matters only if/when the deferred determinism/networking track activates.
- **Bundler friendliness** [verified] — official `@dimforge/rapier3d-compat` inlines the wasm as base64 → no separate `.wasm` fetch, "much wider bundler support" (Vite/webpack/esbuild). Larger bundle as the tradeoff.
- **Jolt as fallback** [verified] — MIT, C++17, AAA-proven (Horizon Forbidden West, Death Stranding 2), cross-platform deterministic option. But its web support is a *separate* `JoltPhysics.js` emscripten port (`jolt-physics` npm, ships `.d.ts`); its web-binding maturity/TS-quality was **not** established at Rapier's depth. (Note: the `@isaac-mason/jolt-physics` fork is an **abandoned 2023 type-prototype** — not the package to use; the maintained one is `jolt-physics` by jrouwe.)

## Spike results (verified 2026-06-01 — both green; **Rapier LOCKED**)

1. **Headless `bun:test` — ✅ CONFIRMED.** `@dimforge/rapier3d-compat@0.19.3` installs and runs under `bun:test`: `RAPIER.init()` (base64 wasm decode + instantiate) works in Bun, a world steps, and body state reads back correctly (a dropped ball lands in the analytic free-fall range, 60 steps @ dt=1/60). One harmless deprecation warning on the `World`/init param shape — use the current single-object form in the wrapper. This was the decisive unknown; Rapier is cleared for furnace's TDD workflow.
2. **Bundle size — ✅ MEASURED.** Rapier 3D wasm = 1.5 MB raw / **571 KB gzipped**. Packaging paths: `@dimforge/rapier3d-compat` (base64-inlined single file, bundler/headless-friendly) = 2.1 MB raw / **816 KB gzipped**; `@dimforge/rapier3d` (separate `.wasm` fetch) ≈ **~593 KB gzipped**. Inlining costs ~225 KB gz. Significant but acceptable, and **module-level tree-shakeable** — it lives behind `@furnace/core/physics`, so only physics consumers pay it (the triangle/hello-world and any non-physics consumer pay zero). Packaging choice (compat vs separate-wasm) deferred to the integration phase.
3. **TS API ergonomics** — official `.d.ts` ships (e.g. `rapier_wasm3d.d.ts`); quality assessed during wrapper design.

**Verdict: Rapier LOCKED.** Both spikes favorable; no disqualifier found.

## Jolt head-to-head (both spiked 2026-06-01 — resolves the evidence asymmetry)

Spiked `jolt-physics@1.0.0` (JoltPhysics.js wasm-compat) the same way. **It also runs headless in `bun:test`** (inits, steps, reads back — clean). So the decision is *not* on raw "does it work," but the finer axes:

| Dimension | Rapier | Jolt | Edge |
|---|---|---|---|
| Headless `bun:test` | ✅ | ✅ | tie |
| wasm gz | **571 KB** | 708 KB | Rapier |
| compat single-file gz | **816 KB** | 866 KB | Rapier (slight) |
| Create-a-world API | `new World(gravity)` (~3 lines) | layer+broadphase filter boilerplate (~25 lines) | Rapier |
| Toolchain | Rust→wasm-bindgen (idiomatic TS) | C++→emscripten/embind (`get_/set_`, **manual memory mgmt** — objects must be `Jolt.destroy()`d or leak wasm heap) | Rapier |
| Featureset | complete (joints/queries/CCD/char/events) | complete **+ AAA breadth** (vehicles, soft bodies, more) | Jolt |
| License | Apache-2.0 | MIT | Jolt (marginal) |
| Cross-platform determinism | ready `-deterministic` npm pkg | CMake flag, **self-compile** (no npm flavour) | Rapier |
| Pedigree | web-proven, monthly | AAA console (Horizon FW, DS2) | tie/Jolt |

**Decision (verified, not asymmetry):** Rapier wins on integration for a *borrowed, wrapped* backend — smaller, dramatically simpler/safer to wrap (wasm-bindgen vs embind + manual memory management), and ships ready cross-platform determinism. Jolt's real wins (MIT, AAA featureset breadth) don't outweigh: the license gap is marginal, and the extra features are headroom unused by bowling or the mapped growth surface. **Flip condition:** if furnace later wants AAA simulation breadth as *gameplay* (vehicles, soft bodies, large-scale destruction), Jolt's headroom + pedigree justify the heavier API, larger bundle, and self-built determinism. Not the case for throw-and-topple. Jolt remains the documented fallback.

## Caveats
- Evidence is asymmetric (Rapier-weighted); "Jolt is #2" partly reflects thinner verified evidence, not proven inferiority.
- Box2D/Havok/PhysX-js/ammo.js/cannon-es produced zero surviving verified claims — Box2D is ruled out structurally (2D); the others are *unassessed*, not rejected. A targeted second pass could confirm no dark-horse, but none is a likely better fit than Rapier for a permissive-license + active + 3D + official-TS-bindings profile.
- Version facts current ~2025-11-05; re-check npm before pinning.

## Primary sources
- Rapier.js repo / README / CHANGELOG: https://github.com/dimforge/rapier.js
- Rapier docs: https://rapier.rs/docs/
- `@dimforge/rapier3d-compat`: https://www.npmjs.com/package/@dimforge/rapier3d-compat
- `@dimforge/rapier3d-deterministic`: https://www.npmjs.com/package/@dimforge/rapier3d-deterministic
- dimforge 2025 review: https://dimforge.com/blog/2026/01/09/the-year-2025-in-dimforge/
- Jolt Physics: https://github.com/jrouwe/JoltPhysics · JoltPhysics.js: https://github.com/jrouwe/JoltPhysics.js
- rapier-node (headless): https://github.com/Thorium-Sim/rapier-node

**Fed:** `docs/reference/adr/0001-physics-two-track-architecture.md`, which lists this file on its Evidence line — Decision 6 (Rapier as the starting backend). The deferred alternative it opened is tracked at `docs/backlog/engine-architecture/jolt-backend-swap.md`.
