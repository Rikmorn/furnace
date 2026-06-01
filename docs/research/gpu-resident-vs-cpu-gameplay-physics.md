# GPU-resident physics vs CPU-authoritative gameplay — strategic research

**Date:** 2026-06-01
**Context:** Strategic research triggered by a realization while designing Demo 1 — GPU-resident physics makes CPU-side game logic awkward (reading state back to the CPU stalls the pipeline). Question: how far should furnace commit to GPU-resident simulation *as an engine direction*, separate from the demo? Does not impact the demo (which needs zero readback); does impact the approach.
**Method:** Deep-research harness — 5 angles, 22 sources, 103 claims, 25 adversarially verified (3-vote). **25 confirmed / 0 refuted** — unusually clean.

## TL;DR — the field has converged, and it's a hybrid

**GPU-resident physics is the right foundation only for *visual-only / throughput-bound* simulation** (VFX, destruction, cloth, large-scale particles) where no CPU gameplay logic must react per-frame. **For gameplay-critical rigid-body physics the near-universal shipping pattern is CPU-authoritative** (Jolt, Box2D, Rapier, Havok, PhysX-CPU), with GPU sim reserved as a visual/specialized tool. Mature engines ship **both, with a clear role split** — they do not make GPU sim the gameplay foundation.

**Recommendation for furnace:** commit to GPU-resident as the default for **visual / throughput sim**; keep gameplay-critical authority on the **CPU** if/when furnace needs it (hybrid: CPU-authoritative + GPU-visual). If a GPU-authoritative path is ever offered, ship it with explicit async-readback ring-buffering and a non-determinism warning — not as a general-purpose gameplay foundation.

## Findings (all high-confidence, 3-0 verified)

### 1. CPU-authoritative is the field pattern for gameplay physics
Jolt (Horizon Forbidden West, Death Stranding 2), Box2D, Rapier, Havok, PhysX-CPU all run the authoritative solver on the CPU. GPU physics is reserved for VFX/destruction/cloth/large-scale visual sim with no gameplay dependency. Jolt's maintainer calls full GPU physics wish-list-only, citing callback/collision-filtering impracticality and CPU↔GPU transfer bottlenecks, and notes **PhysX and Havok *retreated* from ambitious GPU physics** for the same reasons. Havok explicitly splits CPU gameplay-critical objects (rigid bodies, ragdolls, character controllers) from a separate lightweight "Physics Particles" path for "non-gameplay critical object or VFX." Rapier: "a great alternative to PhysX *as long as you don't need a GPU-based solution*."

### 2. The readback wall is structural in WebGPU (not incidental)
WebGPU's only GPU→CPU path is `mapAsync` — asynchronous, and a mapped buffer **cannot** participate in any GPU command (mutual exclusion). No synchronous main-thread mapping exists (deliberately excluded). Naive readback can't complete in-frame and stalls the pipeline; measured 5–15 ms in practice, spanning multiple 60 fps frames. Efficient streaming forces manual ring-buffer/double-buffering across submissions, with either a **~10× memory blow-up** (ML-domain estimate) or full per-frame device sync. The `gpuweb` design issue for a better readback API (#1972) is **still open in 2026**; `GPUQueue.readBuffer` never shipped.

### 3. Even mature GPU engines concede the boundary
PhysX 5 GPU is itself a **hybrid**: joint projection, CCD, and triggers stay on the CPU. Its GPU bodies use the *same* CPU-facing API as CPU bodies, but any CPU modification forces a GPU re-sync with a cost "relatively low but [that] should be taken into consideration." For genuine GPU-to-GPU dataflow it offers a dedicated opt-in **Direct GPU API** (raw device pointers) that **disables the CPU API** (CPU reads return stale data) — primary use case RL/training, *not* rendering/gameplay. Unreal **Niagara's collision-event system flatly does not work for GPU sims** ("events only work with CPU simulation," still true in UE 5.7) — GPU particle sims cannot natively emit gameplay collision events.

### 4. Determinism is the hard differentiator (the strongest constraint)
CPU engines achieve **cross-platform bit-level determinism** — what lockstep/replay actually needs — by suppressing fast-math, FMA, and divergent trig. Box2D does it **by default** (CI-verified); Rapier/Havok/Jolt offer it as costed opt-in (~8% slower, FMA off). GPU floating-point reductions are **non-associative and atomic-reordered**: run-to-run determinism on the *same* GPU is achievable, but **does not extend across different GPUs** (different kernel/reduction order → different bits). Cross-GPU bit-exactness requires special reproducible-accumulator machinery. **This is a near-blocker for GPU-resident as an authoritative foundation for lockstep multiplayer and bit-exact replay** — exactly where CPU engines already have a solved answer.
- Qualifier: even CPU Box2D does **not** ship rollback determinism out of the box (rollback needs internal-state reduction with stability trade-offs). So full netcode is non-trivial even on CPU — this tempers, not negates, the CPU advantage.

## Strategic implication for furnace

The earlier "CPU vs GPU — pick one, solve it for good, no point rebuilding later" framing needs an update: **the field does not treat these as one-or-the-other.** Mature engines ship *both*, with roles split:

| Track | Authority | Use | Determinism | Gameplay logic |
|---|---|---|---|---|
| **GPU-resident (this demo's track)** | GPU | Visual / throughput sim — particles, debris, cloth, large-scale | Same-GPU only; not cross-GPU | Awkward (readback stalls); move logic onto GPU or accept latency |
| **CPU-authoritative (future, if needed)** | CPU (JS/wasm) | Gameplay-critical rigid bodies; networked; deterministic | Cross-platform opt-in | Free — state is in CPU memory |

So: **GPU-resident is the *visual / throughput* physics track, not the gameplay-authority foundation.** Building it now (for the bowling demo, which is visual-only) is the right tool for that track — it is *not* wasted by this finding. But gameplay-critical, deterministic, or networked physics, if furnace ever wants it, is a **separate CPU-authoritative track** — not something the GPU solver should be stretched to cover. The "solve it once" logic holds *within the visual track*; it does not mean the GPU solver becomes the gameplay foundation.

This warrants an **ADR**: positions GPU-resident physics as furnace's visual/throughput track and records the readback + determinism + CPU-gameplay boundary, so the demo's GPU-resident work is not later over-generalized into "furnace does gameplay physics on the GPU."

## Caveats
- Havok's cross-platform-determinism claim is a vendor self-assertion (corroborated by historical FPU practice, not independently benchmarked here).
- The ~10× readback-memory figure is the `gpuweb` issue author's ML-domain estimate, not a measured benchmark.
- PhysX's documented re-sync cost is the *write* direction (CPU→GPU); the GPU→CPU readback latency (5–15 ms) is from WebGPU practice, platform/driver-dependent.
- WebGPU is evolving — a future `readBuffer`-style API or worker `mapSync` could reduce readback friction.
- The CPU-authority finding is the *dominant industry pattern*, not a logical impossibility of GPU-authoritative gameplay; no shipped fully-GPU-authoritative gameplay counter-example was measured.

## Open questions (furnace-specific follow-ups)
1. Measured GPU→CPU readback latency under WebGPU/Dawn on furnace's targets (Safari/Apple Silicon, desktop discrete) with double/triple-buffering — actual frames of latency vs the 5–15 ms general figure.
2. Concrete state of wgpu/Bevy/Rapier experimental GPU-physics bridges — any usable GPU-sim + CPU-gameplay bridge today, or all research-phase?
3. For a hybrid "GPU-authoritative + async readback," the acceptable gameplay-latency budget per genre (which tolerate multi-frame readback vs require same-frame CPU authority).
4. How far GPU-side gameplay logic (compute event detection, indirect dispatch, GPU-driven spawning) can cover furnace's intended gameplay surface before hitting the data-dependent-branching / debugging / iteration-speed ceiling.

## Primary sources
- NVIDIA PhysX 5.4 — GPU Rigid Bodies: https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/GPURigidBodies.html
- MDN — `GPUBuffer.mapAsync`: https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync
- gpuweb issue #1972 (readback API, still open): https://github.com/gpuweb/gpuweb/issues/1972
- Box2D — Determinism (Erin Catto): https://box2d.org/posts/2024/08/determinism/
- Jolt Physics: https://github.com/jrouwe/JoltPhysics
- Havok Physics: https://www.havok.com/havok-physics/
- Rapier announcement (Dimforge): https://www.dimforge.com/blog/2020/08/25/announcing-the-rapier-physics-engine/
- Unreal Niagara — Events & Event Handlers (CPU-only): https://dev.epicgames.com/documentation/unreal-engine/events-and-event-handlers-in-niagara-effects-for-unreal-engine
- NVIDIA CCCL — Controlling Floating-Point Determinism: https://developer.nvidia.com/blog/controlling-floating-point-determinism-in-nvidia-cccl/
- Gaffer On Games — Floating-Point Determinism / Deterministic Lockstep: https://gafferongames.com/post/floating_point_determinism/
