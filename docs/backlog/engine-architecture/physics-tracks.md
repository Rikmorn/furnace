---
summary: the two-track physics posture (ADR 0001) and its residue: deferred determinism/networking concerns, the unbuilt GPU track, and the unfinished body-mutation surface
---

# Physics tracks

Tracker for the **two-track physics posture** and the body-mutation surface it left
unbuilt. The canonical decision is ADR 0001 (`docs/reference/adr/0001-physics-two-track-architecture.md`):
furnace wraps a mature CPU engine (Rapier, wasm) behind the `physics` API for gameplay, and
defers the GPU-resident track for visual/throughput simulation. Each section below is one
previously standalone entry with its Context, *Trigger to revisit* and *Reference*
preserved.

They are merged because they are that ADR's residue plus the shipped track's own unfinished
surface — a reader deciding anything about physics needs the three together. Two live
reference docs point at sections below: ADR 0001 §Consequences cites the CPU-track section
for the deferred determinism/networking concerns, and
`docs/reference/engine-architecture.md` §4 cites the GPU-track section as where the
deferred GPU route is tracked.

**Not merged here on purpose:** `jolt-backend-swap.md` stays a standalone entry. It is the
canonical home of the *voxels-are-a-bridge* ruling and carries by far the heaviest external
citation load in the register (13 referencing files across research, reference, learnings
and package docs), so folding it in would trade many live re-points for one fewer file.

## CPU-authoritative physics — deterministic / networked concerns (deferred remainder)

**Status reframed 2026-06-01 (the physics pivot).** The basic **CPU-authoritative rigid-body physics module** — borrow a mature engine (**Rapier — backend resolved 2026-06-01**; ADR 0001 + `jolt-backend-swap.md`) wrapped behind a clean furnace `physics` API — is now **ACTIVE as Demo 1** (the bowling demo), no longer deferred. This entry now tracks only the **advanced gameplay-physics concerns the bowling demo does NOT need**: cross-platform **determinism**, **networked / lockstep** simulation, and **rollback / replay**.

furnace's physics is a deliberate two-track posture (`docs/research/2026-06-01-gpu-resident-vs-cpu-gameplay-physics.md`): CPU-authoritative for gameplay-critical / interactive physics (the active track — this demo), GPU-resident for visual / throughput sim (deferred — the *GPU-resident physics* section).

**Build/borrow (active, for the module):** borrow **Rapier (Rust → wasm)** — web-native, opt-in cross-platform determinism, with joints / scene queries / CCD / sensors / character-controller all provided. Wrapped behind furnace's own `physics` API so consumer code never imports the backend (a clean wrapper over one backend — good hygiene, *not* speculative pluggable multi-backend machinery). `static` / `dynamic` / `kinematic` are the furnace-owned, backend-agnostic body concepts. JS stays authoritative for transforms (the existing `mesh.setPosition` path). wasm is permitted in core (AGENTS.md anticipates wasm hot-path crates). Tracked in the CPU-borrow epic (pivoted from the superseded GPU epic).

**Deferred remainder (what this entry now tracks):**
- **Cross-platform determinism** — Rapier's opt-in enhanced-determinism (bit-level, IEEE-754, at a SIMD/parallelism cost). The bowling demo doesn't need it.
- **Networked / lockstep** simulation and **rollback / replay** netcode — note even CPU engines don't ship rollback out of the box (Box2D: requires internal-state reduction with stability trade-offs).

**Trigger to revisit:** First demo needing **deterministic, networked, or replay** physics — multiplayer lockstep, deterministic replay, or cross-platform-reproducible simulation. Basic single-player interactive physics (bowling and similar) does **not** trigger it — that is the active module.

**Reference:** `docs/research/2026-06-01-gpu-resident-vs-cpu-gameplay-physics.md` (determinism evidence — Box2D/Rapier/Jolt/Havok); ADR 0001 (`docs/reference/adr/0001-physics-two-track-architecture.md`); the CPU-borrow physics epic. Related: `jolt-backend-swap.md` (deferred Jolt scale-up backend), the *GPU-resident physics* section (the deferred GPU visual/throughput track).

## GPU-resident physics — visual / throughput simulation track

Shared GPU buffers for solver writes and renderer reads, no CPU↔GPU state copy per frame (from `docs/reference/engine-architecture.md` §4).

**Status reframed 2026-06-01 (the physics pivot).** This is furnace's **deferred GPU visual/throughput simulation track — NOT the gameplay rigid-body physics module.** Two research passes (`docs/research/2026-06-01-gpu-resident-physics-solver.md`, `docs/research/2026-06-01-gpu-resident-vs-cpu-gameplay-physics.md`) established a two-track posture: gameplay-critical rigid-body physics is **CPU-authoritative** (now the active Demo 1, borrowing Rapier — see the *CPU-authoritative physics* section); GPU-resident is the right tool only for **visual / throughput sim where no CPU game logic reacts per-frame** — particles, cloth, fluids, large-scale debris, big non-interactive simulations.

Why deferred, not built first: GPU is *weakest* at stable rigid-body stacking (XPBD's documented weak regime), and the WebGPU readback wall + cross-GPU non-determinism make it wrong for interactive/gameplay physics. It is *strongest* at massively-parallel, loosely-coupled elements — so the right first GPU-resident demo is a particle/cloth/debris piece, not bowling.

Inherits the **compute/storage shader-bridge completion** scope: storage address spaces in `binding/types.ts` currently throw at materialization, and `@compute` entry points are "future" — building this track is what forces that substrate into existence. The renderer reads the solver's storage buffers directly (instanced render-from-buffer). The reference GPU *rigid-body* pipeline (LBVH broadphase, SAT + quickhull narrowphase, graph-colored substep-XPBD solver) is documented in the solver research; a particle/cloth track will likely use a simpler PBD/XPBD-particle formulation instead — settled when brainstormed.

**Trigger to revisit:** First demo needing large-scale GPU visual/throughput sim — particles, cloth, fluids, debris fields, or any simulation with thousands of loosely-coupled elements where no CPU game logic reacts per-frame. The CPU bowling demo does **not** trigger it.

**Reference:** `docs/research/2026-06-01-gpu-resident-vs-cpu-gameplay-physics.md` (two-track posture + readback/determinism evidence); `docs/research/2026-06-01-gpu-resident-physics-solver.md` (substep-XPBD + graph coloring + analytic narrowphase); `docs/research/2026-05-21-shallot.md` §5 (prior art); ADR 0001 (`docs/reference/adr/0001-physics-two-track-architecture.md`). Related: the *CPU-authoritative physics* section (the active CPU track).

## Physics body setters

Tracker for the deferred runtime body-mutation surface on `@furnace/core/physics`:
the further body setters beyond the one `setBodyLinearVelocity` that Stage 4A shipped
(teleport / rotation / angular velocity / impulses), and the `rigidMesh` interpolation
`reset` that must ship *with* any in-place teleport API to avoid a one-tick smear.
They are merged because they are a coherent pair — an in-place set-pose / teleport API
is useless without the interpolation reset, and the reset is useless without teleport —
and share the "first consumer needing to move an existing body" trigger.

### Physics body-setter surface (teleport / impulse / angular)

**Filed 2026-06-04** (Stage 4A — "Playable Core"). Stage 4A added `setBodyLinearVelocity` — the FIRST setter on the body API (the wrapper previously had getters only: `getBodyTranslation`/`getBodyRotation`). This entry tracks the further runtime body setters, deferred to scope-to-need.

#### Context

`setBodyLinearVelocity(ctx, body, v)` (→ Rapier `setLinvel`) was added because imparting motion to an existing body is the fundamental "playable" primitive (the bowling throw). It is runtime-quiet (warn on non-finite, silent no-op on stale handle) and pure pass-through to Rapier.

Natural siblings, NOT added because no current consumer needs them:
- **`setBodyTranslation(ctx, body, p)`** (teleport) — Rapier `setTranslation`. Wanted by: respawn-elsewhere, portal, editor drag, snap-to-grid.
- **`setBodyRotation(ctx, body, q)`** — Rapier `setRotation`. Wanted by: oriented respawn, editor.
- **`setBodyAngularVelocity(ctx, body, w)`** — Rapier `setAngvel`. Wanted by: spin/torque-style throws, spin-up.
- **`applyImpulse(ctx, body, j)` / `applyForce` / `applyTorqueImpulse`** — Rapier `applyImpulse`/`addForce`/`applyTorqueImpulse`. Mass-aware (impulse → Δvelocity scaled by mass), distinct ergonomics from the direct `setLinvel` "kick". Wanted by: explosions, knockback, wind, jumps where mass should matter.

All are pure pass-through (gate-rule clean) — each hands a value/vector straight to Rapier, no JS-side physics math. They'd mirror `setBodyLinearVelocity`'s shape exactly (runtime-quiet failure policy, `ctx` first, hot-path setter classification in `api-posture.md`).

**Note on the kinematic gap:** `setBodyTranslation` on a *dynamic* body is a Rapier "next-kinematic-position" style move vs. a hard teleport; furnace should expose whichever Rapier gives cleanly and document the semantics, not compute interpolation itself.

#### Trigger to revisit

First consumer/demo needing a specific one:
- teleport/respawn-elsewhere → `setBodyTranslation`
- explosion/knockback/jump where mass matters → `applyImpulse`
- spin-throw / torque → `setBodyAngularVelocity` / `applyTorqueImpulse`

Add only the setter(s) the need requires, mirroring `setBodyLinearVelocity`. Don't ship the whole quartet speculatively. Note: an in-place teleport setter must land together with the `rigidMesh` interpolation reset in the *rigidMesh teleport / interpolation-reset* section below.

#### Reference

- Origin: Stage 4A (`setBodyLinearVelocity`, the "first setter"; surfaced in the stage's adjacent findings).
- Decision: setBodyLinearVelocity setter (not spawn-on-launch) + the gate-rule of pure pass-through to Rapier.
- Impl: `packages/core/src/physics/body.ts` (`setBodyLinearVelocity` — the shape to mirror)
- API: `docs/reference/core-modules.md` `@furnace/core/physics`; `docs/reference/api-posture.md` (setter classification)

### rigidMesh teleport / interpolation-reset

**Filed 2026-06-03** during Stage 2 (sim↔render binding). Deferred — no Stage 2 consumer.

#### Context

`rigidMesh` (Stage 2) owns prev/curr interpolation buffers. When a body is moved
*in place* (teleported) rather than simulated, prev≠curr across the jump and
`interpolate` smears the mesh across it for one tick. The fix is a `reset(ctx, rm)`
that collapses `prev = curr = body pose` (Godot ships `reset_physics_interpolation`
for exactly this).

#### Why deferred

`reset` has no reachable consumer in Stage 2: Stage 1 physics sets a body's pose
only at `createBody`, so there is **no API to move an existing body in place**.
The Stage 2 demo's reset/replay re-drops via destroy+recreate (`create` re-seeds
prev=curr → no smear). `reset` and a body in-place set-pose API are a coherent
pair — `reset` is useless without teleport, teleport-without-`reset` smears (the
teleport setter itself is tracked in the *Physics body-setter surface* section above).

#### Trigger to revisit

A body in-place set-pose / teleport API lands (e.g. `physics.setBodyPose`), OR a
scene wants reposition-without-recreate. Ship `reset(ctx, rm)` (≈6 lines: read
body pose into prev and curr) **with** that teleport API. The set-pose API is its
own design decision (velocity-zeroing, wake semantics, `setTranslation` vs
`setNextKinematicTranslation`).

#### Reference

- Prior art: Godot `reset_physics_interpolation()`.
