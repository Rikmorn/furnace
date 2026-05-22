# GPU-resident physics

Shared GPU buffers for solver writes and renderer reads, no CPU↔GPU state copy per frame. From `docs/reference/engine-architecture.md` §4 — the architectural tradeoff (architectural purity now, multi-year maturity debt vs Havok/Rapier).

Lands as the `@furnace/core/physics` Tier 2 module (per the core architecture design spec). Depends on `frame.fixedLoop` for deterministic timing — the spec calls out that physics' first job is "use the fixed timestep, don't reinvent its own clock."

The reference pipeline (broadphase via LBVH, narrowphase via SAT + quickhull, GPU solver) is documented in the engine-architecture doc; concrete shape settled when this is brainstormed.

**Trigger to revisit:** When physics is on the table at all — typically the first demo with collisions or simulation.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Tier 2 modules"; prior art at `docs/research/shallot.md` § "Hand-rolled GPU-resident physics".
