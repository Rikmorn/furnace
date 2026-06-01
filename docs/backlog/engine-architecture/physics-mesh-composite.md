# Higher-level concept composing a physics Body + a render Mesh

**Filed 2026-06-01** during the Stage 1 physics-wrapper brainstorm; **disposition decided the same day** (see below). Not built in Stage 1 (which stays primitives-only); scheduled into **Stage 2 of Demo 1**.

## Context

Stage 1 keeps **Body** (physics) and **Mesh** (render) as separate, decoupled resources that share only the **transform** (each tick: read the body's transform → apply via `mesh.setPosition`). The decoupling is deliberate: collision shape ≠ render shape (pins collide as capsules, render as cylinders), not every body renders (trigger volumes), not every mesh simulates (static scenery, UI).

A future higher-level concept could **compose** a Body + a Mesh into one handle — a "physics-backed renderable" that owns both, auto-syncs the transform each tick, and cascade-destroys both together. Provisional names: `rigidMesh` / `physicsMesh` / `actor`. **Keeping the two primitives decoupled now is exactly what makes that composite a clean composition later, not a retrofit untangling.**

This is the *convenience-composition* shape and a stepping stone toward — but **distinct from** — the deferred ECS (epic §4 OUT). It must not pre-empt the ECS decision; it's a thin composite over the two existing primitives, not an entity/component framework.

## Disposition — decided 2026-06-01 (trigger fired by Demo 1)

Bowling meets the trigger: ≈12+ body+mesh pairs (1 ball, ~10 near-identical pins, lane, gutters); fixed-step interpolation you don't want hand-rolled per object; and the pins stress **collision≠render** (capsule collide, cylinder render), so the composite's descriptor must carry both shapes.

**Decision:** at **Stage 2**, build the body→mesh **binding mechanism** (transform feed + fixed-step interpolation) as the foundation, then shape this composite as **thin sugar over it**, designed against the real ball/pin/lane cases. Expected to ship in Demo 1.

**Discipline:** do **not** pre-design the composite before the Stage 2 mechanism exists; keep it sugar over the independent Body + Mesh primitives (not ECS — primitives stay usable uncoupled for trigger-volumes / non-simulated meshes; single source of truth via delegation).

This resolves the epic §7 "body↔mesh binding shape" decision (was: explicit pairing vs transform-feed vs composite → **mechanism + composite-sugar**). When Stage 2 planning starts, promote this into that plan and delete this entry.

## Reference

- Epic: `docs/superpowers/specs/2026-06-01-demo-1-cpu-physics-epic.md` §3 (decoupling), §7 (body↔mesh seam, Stage 2)
- ADR: `docs/reference/adr/0001-physics-two-track-architecture.md` (JS-authoritative transforms — the shared bridge)
- Related deferral: ECS (epic §4 OUT) — the composite is a precursor, not a substitute.
