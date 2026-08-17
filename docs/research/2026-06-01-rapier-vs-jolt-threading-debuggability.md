# Rapier vs Jolt — threading, scalability & debuggability (the backend-lock follow-up)

**Date:** 2026-06-01
**Context:** The CPU-physics backend choice (`2026-06-01-cpu-physics-backend-comparison.md`) nominally locked Rapier, but ADR 0001 reopened it (marking the backend provisional) with Jolt under reconsideration for featureset breadth. The initial reopening was framed around vehicle physics; on review the owner refocused it onto the axes that actually matter for furnace: **performance, multi-threading/scalability, and debuggability**, plus a wrapper-implications through-line. This doc records that follow-up and the resolution it produced.
**Method:** Deep-research harness, **lighter run** (single-vote skeptical verification, not the 3-vote adversarial pass) — 5 angles, 23 sources fetched, 105 claims extracted, top 20 verified, **17 confirmed / 3 refuted**. Confidence labels below reflect the lighter verification. The pivot finding was independently confirmed at the **wasm-binary level**, so it does not rest on the lighter vote count.
**Outcome:** Backend **resolved → Rapier** (start simple), with the *real* future-proofing being a **backend-neutral, thread-ready wrapper**, not the engine underneath. Jolt → backlog scale-up (`docs/backlog/engine-architecture/jolt-backend-swap.md`). Decision recorded in ADR 0001.

---

## TL;DR

1. **Multi-threading is a real, verified divergence — and it favors Jolt.** The published `@dimforge/rapier3d` ships **single-threaded wasm only** (verified by parsing the binary). Jolt **ships a multithreaded wasm build** that scales one simulation across **all cores**. My going-in prior ("both collapse to single-threaded on the web") was **wrong** and was corrected by the owner mid-evaluation.
2. **But it's deferred headroom, not a now-need.** At bowling scale (~10–100 bodies) both are trivially fast; no wasm-context head-to-head benchmark exists for either.
3. **The decision was de-risked by a design pattern, not by picking the bigger engine.** A **poll/drain event API** (collision events read *after* `step()`, never mid-step push-callbacks) is portable across both engines, thread-safe under Jolt's worker model, and backend-neutral. Designing the wrapper this way from day one makes the backend a **reversible choice**.
4. So: **start with Rapier** (lowest wrapper cost for the immediate problem), keep the scaling door open via the neutral wrapper, and document **Jolt as the scale-up swap** (or a future consumer-selectable backend).

---

## Findings by axis

### Multi-threading / scalability

**Rapier — single-threaded wasm, one core per world (HIGH — binary-verified).**
The published `@dimforge/rapier3d` package ships only single-threaded wasm. Verified at the strongest level: parsing the `Memory` section of the installed `rapier_wasm3d_bg.wasm` shows exactly one linear memory, `SHARED=false`, not imported — threaded wasm-bindgen/rayon *mandatorily* requires shared (and typically imported) memory. A grep of the JS glue for `sharedarraybuffer|new Worker|rayon|atomics|hardwareConcurrency` returned **zero** matches. The README's "Feature selection" enumerates four variant families (main, `-simd`, `-deterministic`, `-compat`); **none** is multithreaded. Rapier's `rayon`-based parallel pipeline is a **native-only Rust Cargo feature**, absent from every published web variant.

Consequences for scaling Rapier on the web:
- A single `World` is **pinned to one core**, regardless of available cores.
- More cores are usable only by running **N independent `World`s, each on its own Web Worker** — data-parallelism across *non-interacting* simulation islands. (Standard pattern for single-threaded engines; confidence: architectural reasoning, MEDIUM.)
- **A single coupled scene never exceeds one core** with the stock build.

**Architecture constraint (important, derived from furnace's own model):** furnace runs physics **as wasm** (in the browser, and inside the native WebView). Rapier's native parallel solver is therefore **unreachable** — furnace can only ever consume the single-threaded wasm off the shelf. Single-scene multicore from Rapier would require furnace to **build and maintain a custom `wasm-bindgen-rayon` threaded Rapier wasm** — possible but unsupported, and a real maintenance burden. (Confidence: MEDIUM — `wasm-bindgen-rayon` exists; not verified anyone has shipped it for Rapier.)

**Jolt — multithreaded wasm, all cores, one scene (HIGH).**
Jolt ships real multithreaded wasm in the public npm distribution: `jolt-physics/wasm-multithread` and `wasm-compat-multithread` entrypoints, present since **0.28.0 (2024-10-21)**; the physical binaries are in the tarball (`jolt-physics.multithread.wasm.wasm` ~2.4 MB). It is backed by `JobSystemThreadPool`, which with `inNumThreads = -1` auto-detects cores (`hardware_concurrency()-1` workers + the main thread = **all logical cores**; cap by passing a fixed N). It parallelizes a **single** `PhysicsSystem` internally (broadphase, narrowphase, island solving). Verified against the official docs + the `.cpp` implementation.

**Unlocking Jolt threads costs cross-origin isolation — but that's target-dependent (HIGH + furnace-doc-verified).**
Spinning up Jolt threads in a browser requires `SharedArrayBuffer`, which requires cross-origin isolation (`COOP: same-origin` + `COEP: require-corp`). A **single-threaded fallback** (wasm / wasm-compat / asm.js) runs without isolation and is selectable **by import path alone — identical API** (the returned `Jolt` object is used the same way). Key nuance for furnace:
- **On the open web**, isolation is an external imposition: document-scoped, affects how *all* cross-origin resources load, and is partly the host's call.
- **On native**, furnace runs in a **wry WebView** (`furnace-runtime`, per `docs/reference/packaging-and-distribution.md` §6–7) and **owns the document origin and headers** (dev: `localhost`; prod: bundled assets via custom protocol). So isolation is **self-administered**, not a third-party tax. (That WKWebView/WebView2 still gate `SharedArrayBuffer` behind isolation is general web-platform knowledge, not re-verified here; furnace satisfying it itself is the structural difference.)

### Performance

**All published benchmarks are native-only — headroom signal, not a web-target number (HIGH).**
Rapier's published benchmark explicitly states "native CPU (WebAssembly versions … have not been benchmarked)" and "Number of threads: 1." Jolt's `PerformanceTest` is a native command-line harness with no WebAssembly path; its multi-core scaling figures (~4.9× at 8 threads, ~5.7× at 16 with SMT, independently noted) are native. **No wasm-context head-to-head Rapier-vs-Jolt benchmark survived verification.** At bowling scale both are trivially fast; perf only matters as future-heavy-demo headroom, where Jolt's multi-core scaling is the stronger raw signal — exploitable on web only with isolation.

### Debuggability

**Thin and asymmetric — treat as incomplete (MIXED).** The run aimed for breadth across both engines, but only **Rapier-side** facts survived verification:
- **Rapier contact introspection (HIGH):** `World.contactPair`/`contactPairsWith` read the contact graph at runtime → `TempContactManifold` (points/normal/penetration), confirmed against shipped source.
- **Rapier determinism (HIGH):** standard web builds are **locally** deterministic only; **cross-platform** determinism needs the separate `-deterministic` build, which is "less optimized" (mutually exclusive with SIMD *and* parallel). A reproducible-repro debugging tool, but a build-variant trade-off.
- **Rapier `debugRender()`** (vertices/colors buffers) appears in the API surface (`DebugRenderBuffers`) but the specific claim was not among the verified top-20.
- **Jolt's debuggability surface was not verified at all** (its JS-side debug renderer, sleeping/active state, applied forces, joint state, leaked-object detection). This is a **verification gap, not proven Jolt inferiority** — same asymmetry caveat the original backend comparison carried. Do not read it as "Rapier wins debuggability."

### Wrapper implications

**Rapier is materially lighter to wrap for memory management (HIGH).** Rapier's `World.free()` **cascades** to all child rigid-bodies/colliders/transients (verbatim in `world.d.ts`: "All the fields of this physics world will be freed as well, so there is no need to call their `.free()` methods individually"). Only a handful of long-lived top-level objects need manual `.free()` (World, EventQueue, pipelines, controllers, `DebugRenderPipeline`). Jolt's emscripten model carries the general per-object manual-destroy burden — though the absolutist *"every `new Jolt.XXX` must be destroyed or everything leaks"* framing was **refuted** in verification, so the burden is real but not apocalyptic.

**The threaded-callback leak is the worker model, not memory or headroom (HIGH on mechanism, MEDIUM on remedy).** Emscripten threads are Web Workers; they share the wasm **linear memory** via `SharedArrayBuffer`, but **not JS objects/functions** (each worker has its own JS context). A JS-implemented `ContactListener` lives on the main thread; when a collision job runs on a worker and tries to call it, the worker's context lacks that JS function and it fails. So the leak is the **shared-buffer/worker model** — *not* memory management, *not* computational headroom. Callback-free threaded sims work; the break is specifically C++→JS callbacks crossing the worker boundary, which (as of the 2024 discussion) needed risky, unofficial post-js plumbing.
**Remedy → the design conclusion that decided the backend:** don't take push-callbacks during the threaded step. **Collect contacts during the step and read them on the main thread *after* `step()` returns (poll/drain).** This is exactly how **Rapier already works** (`EventQueue.drainCollisionEvents()`). So a **drainable event-queue API** is simultaneously portable (matches Rapier natively), thread-safe (no worker-boundary problem under Jolt's threaded build), and backend-neutral. furnace's wrapper adopts this shape from day one.

---

## The corrected strategic frame

Two arguments from the first synthesis were **wrong and are withdrawn**:
1. ~~"Jolt's multicore is redundant with furnace's GPU-resident track."~~ **Wrong.** The GPU-resident track only serves *fire-and-forget* sim (no per-frame CPU readback). Heavy **interactive/gameplay** physics that needs to scale across compute cannot move to the GPU track — the readback wall is exactly why it's CPU-authoritative. Multicore CPU physics is **not** covered by the GPU plan.
2. ~~Framing the isolation requirement as a flat decisive cost.~~ It is **target-dependent**: an external tax on the open web, but **self-administered on native** (which furnace ships).

With those removed, the call is genuinely close: Jolt's single-scene multicore is **real, relevant, and (on native) accessible**, and is the only off-the-shelf path to single-scene CPU scaling in furnace's wasm architecture. What tips it to "start with Rapier" is that **scaling is deferred** (owner's explicit call) and the **neutral wrapper makes the choice reversible** — so paying Jolt's heavier wrapper cost now (manual memory, isolation setup, leakier threaded callbacks) would be optimizing a deferred need against the immediate one (bowling).

## Open gaps (fill these when the Jolt trigger fires)

The lighter run left four questions unanswered; none plausibly outweighs the deferred-headroom + reversibility logic, so they did not block the lock — but they are the **first things to resolve when the Jolt swap is triggered**:
1. **Jolt's debug wasm** — what `jolt-physics` actually exposes from JS (debug-render geometry, introspection). (Owner pointed at the repo; uncharacterized.)
2. **Jolt threaded JS callbacks** — has an official/safe path landed since the 2024 `JoltPhysics.js#134`/`#110` discussion, or is the post-js swizzle still required? Determines how thread-ready a Jolt wrapper really is.
3. **Rapier multi-world-on-workers + `wasm-bindgen-rayon` Rapier** — is either a real, used scaling path or just theory?
4. **Jolt wasm determinism** — guarantee + any optimization trade-off analogous to Rapier's `-deterministic` vs SIMD/parallel exclusion.

## Caveats

- **Lighter verification:** single-vote skeptical pass, not the 3-vote adversarial harness. The pivot (Rapier single-threaded) is binary-verified and robust; softer claims (multi-world scaling, custom rayon-wasm feasibility, threaded-callback remedy) are reasoning/medium-confidence as labelled.
- **Time-sensitivity:** Rapier binary evidence from `@dimforge/rapier3d-compat@0.19.3`; Jolt from 0.28.0→1.0.0. The Jolt threaded-callback limitation is a 2024-era experimental-feature state that may have improved (gap #2).
- **Debuggability comparison is incomplete** (Jolt side unverified) — see gap #1.

## Primary sources

- Rapier.js repo / npm / docs: https://github.com/dimforge/rapier.js · https://www.npmjs.com/package/@dimforge/rapier3d · https://rapier.rs/docs/
- `@dimforge/rapier3d-deterministic`: https://www.npmjs.com/package/@dimforge/rapier3d-deterministic
- Rapier advanced collision detection (contact introspection): https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/
- Jolt npm / JobSystemThreadPool / multithread release: https://www.npmjs.com/package/jolt-physics · https://jrouwe.github.io/JoltPhysics/class_job_system_thread_pool.html · https://github.com/jrouwe/JoltPhysics.js/issues/134 · https://github.com/jrouwe/JoltPhysics.js/discussions/110
- Jolt PerformanceTest (native): https://github.com/jrouwe/JoltPhysics/blob/master/Docs/PerformanceTest.md
- Cross-origin isolation / SAB: https://web.dev/articles/coop-coep
- furnace native model: `docs/reference/packaging-and-distribution.md` §6–7; `docs/reference/engine-architecture.md` §3

**Fed:** `docs/reference/adr/0001-physics-two-track-architecture.md` Decision 6 and its Rapier-vs-Jolt rationale, which cites this evaluation for the multicore-wasm finding; the reopening conditions and the four evidence gaps it left live at `docs/backlog/engine-architecture/jolt-backend-swap.md`.
