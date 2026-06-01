# CPU-authoritative physics — deterministic / networked concerns (deferred remainder)

**Status reframed 2026-06-01 (the physics pivot).** The basic **CPU-authoritative rigid-body physics module** — borrow a mature engine (**Rapier — backend resolved 2026-06-01**; ADR 0001 + `jolt-backend-swap.md`) wrapped behind a clean furnace `physics` API — is now **ACTIVE as Demo 1** (the bowling demo), no longer deferred. This entry now tracks only the **advanced gameplay-physics concerns the bowling demo does NOT need**: cross-platform **determinism**, **networked / lockstep** simulation, and **rollback / replay**.

furnace's physics is a deliberate two-track posture (`docs/research/gpu-resident-vs-cpu-gameplay-physics.md`): CPU-authoritative for gameplay-critical / interactive physics (the active track — this demo), GPU-resident for visual / throughput sim (deferred — `gpu-resident-physics.md`).

**Build/borrow (active, for the module):** borrow **Rapier (Rust → wasm)** — web-native, opt-in cross-platform determinism, with joints / scene queries / CCD / sensors / character-controller all provided. Wrapped behind furnace's own `physics` API so consumer code never imports the backend (a clean wrapper over one backend — good hygiene, *not* speculative pluggable multi-backend machinery). `static` / `dynamic` / `kinematic` are the furnace-owned, backend-agnostic body concepts. JS stays authoritative for transforms (the existing `mesh.setPosition` path). wasm is permitted in core (AGENTS.md anticipates wasm hot-path crates). Tracked in the CPU-borrow epic (`docs/superpowers/specs/2026-06-01-demo-1-cpu-physics-epic.md`, pivoted from the superseded GPU epic).

**Deferred remainder (what this entry now tracks):**
- **Cross-platform determinism** — Rapier's opt-in enhanced-determinism (bit-level, IEEE-754, at a SIMD/parallelism cost). The bowling demo doesn't need it.
- **Networked / lockstep** simulation and **rollback / replay** netcode — note even CPU engines don't ship rollback out of the box (Box2D: requires internal-state reduction with stability trade-offs).

**Trigger to revisit:** First demo needing **deterministic, networked, or replay** physics — multiplayer lockstep, deterministic replay, or cross-platform-reproducible simulation. Basic single-player interactive physics (bowling and similar) does **not** trigger it — that is the active module.

**Reference:** `docs/research/gpu-resident-vs-cpu-gameplay-physics.md` (determinism evidence — Box2D/Rapier/Jolt/Havok); ADR 0001 (`docs/reference/adr/0001-physics-two-track-architecture.md`); the CPU-borrow physics epic (`docs/superpowers/specs/2026-06-01-demo-1-cpu-physics-epic.md`). Related: `jolt-backend-swap.md` (deferred Jolt scale-up backend), `gpu-resident-physics.md` (the deferred GPU visual/throughput track).
