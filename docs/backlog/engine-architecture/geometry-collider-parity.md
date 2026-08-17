---
summary: the principle that every render-geometry primitive should have a collider counterpart, bounded by the gate-rule that the collider must be native to Rapier — so an open-ended cylinder would stay render-only
---

# Geometry ↔ collider primitive parity

**Filed 2026-06-04** (Stage 4A — "Playable Core", `2026-06-04-stage-4a-playable-core`). A forward design note, surfaced when the bowling pins gained a cylinder collider to match the existing `geometry.cylinder` render primitive.

## Context

Stage 4A added a `{ cylinder: { halfHeight, radius } }` `ShapeDescriptor` variant so the dynamic pins have a collision body matching their `geometry.cylinder` render mesh. This established a principle worth holding going forward:

> **A render-geometry primitive should have a collider counterpart, so we never ship a render shape that can't be given a collision body.**

Current pairings:
- `geometry.sphere` ↔ `{ ball }` collider ✓
- `geometry.cube` ↔ `{ cuboid }` collider ✓
- `geometry.cylinder` ↔ `{ cylinder }` collider ✓ (Stage 4A)
- `geometry.plane` ↔ (no dedicated collider — a thin `{ cuboid }` substitutes; static ground use only)

Gaps will appear as new render primitives land. Backlog primitives already queued (`box-parallelepiped-primitive.md` and `cone-and-open-cylinder.md`) would, on the parity principle, each want a collider counterpart — but only if Rapier provides one natively (per the Stage-4A gate-rule: no JS-side physics math; gaps flag toward the Jolt swap, never faked). E.g. a cone collider exists in Rapier; an open-cylinder (no caps) has no natural rigid-body collider and would stay render-only.

This is an observation/principle, not a committed task — there is no current consumer waiting on a specific new collider.

## Trigger to revisit

When a NEW render-geometry primitive lands (cone, capsule-as-render, parallelepiped, etc.) AND a demo/consumer needs that shape as a collision body. At that point: add the matching `ShapeDescriptor` variant IF Rapier provides the collider natively; otherwise flag the gap toward `jolt-backend-swap.md` and keep the render primitive collider-less with a documented note.

## Reference

- Origin: Stage 4A (cylinder collider; surfaced in the stage's adjacent findings).
- Gate-rule: pure pass-through to Rapier; no JS-side physics math.
- Related: `box-parallelepiped-primitive.md` and `cone-and-open-cylinder.md` (queued render primitives), `jolt-backend-swap.md` (where collider gaps flag)
- API: `docs/reference/core-modules.md` `@furnace/core/physics` (`ShapeDescriptor`), `@furnace/core/geometry`
