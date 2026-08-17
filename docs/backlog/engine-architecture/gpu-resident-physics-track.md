---
summary: the deferred GPU-resident track for visual/throughput simulation (particles, cloth, debris) — right only where no CPU logic reacts per frame, and the work that would force core's compute/storage shader substrate into existence
---

# GPU-resident physics — visual / throughput simulation track

Shared GPU buffers for solver writes and renderer reads, no CPU↔GPU state copy per frame (from `docs/reference/engine-architecture.md` §4).

**Status reframed 2026-06-01 (the physics pivot).** This is furnace's **deferred GPU visual/throughput simulation track — NOT the gameplay rigid-body physics module.** Two research passes (`docs/research/2026-06-01-gpu-resident-physics-solver.md`, `docs/research/2026-06-01-gpu-resident-vs-cpu-gameplay-physics.md`) established a two-track posture: gameplay-critical rigid-body physics is **CPU-authoritative** (now the active Demo 1, borrowing Rapier; its deferred remainder is `deterministic-and-networked-physics.md`); GPU-resident is the right tool only for **visual / throughput sim where no CPU game logic reacts per-frame** — particles, cloth, fluids, large-scale debris, big non-interactive simulations.

Why deferred, not built first: GPU is *weakest* at stable rigid-body stacking (XPBD's documented weak regime), and the WebGPU readback wall + cross-GPU non-determinism make it wrong for interactive/gameplay physics. It is *strongest* at massively-parallel, loosely-coupled elements — so the right first GPU-resident demo is a particle/cloth/debris piece, not bowling.

Inherits the **compute/storage shader-bridge completion** scope: storage address spaces in `binding/types.ts` currently throw at materialization, and `@compute` entry points are "future" — building this track is what forces that substrate into existence. The renderer reads the solver's storage buffers directly (instanced render-from-buffer). The reference GPU *rigid-body* pipeline (LBVH broadphase, SAT + quickhull narrowphase, graph-colored substep-XPBD solver) is documented in the solver research; a particle/cloth track will likely use a simpler PBD/XPBD-particle formulation instead — settled when brainstormed.

**Trigger to revisit:** First demo needing large-scale GPU visual/throughput sim — particles, cloth, fluids, debris fields, or any simulation with thousands of loosely-coupled elements where no CPU game logic reacts per-frame. The CPU bowling demo does **not** trigger it.

**Reference:** `docs/research/2026-06-01-gpu-resident-vs-cpu-gameplay-physics.md` (two-track posture + readback/determinism evidence); `docs/research/2026-06-01-gpu-resident-physics-solver.md` (substep-XPBD + graph coloring + analytic narrowphase); `docs/research/2026-05-21-shallot.md` §5 (prior art); ADR 0001 (`docs/reference/adr/0001-physics-two-track-architecture.md`). Related: `deterministic-and-networked-physics.md` (the deferred remainder of the active CPU track).
