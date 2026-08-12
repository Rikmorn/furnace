---
summary: missing render primitives (box/parallelepiped, cone/open cylinder, tunable tessellation) and the render-vs-collider parity principle that governs them
---

# Geometry primitive gaps

Tracker for the deferred geometry-primitive work: the render primitives furnace does
not yet expose (box/parallelepiped, cone/open-cylinder, tunable tessellation) and the
render-↔-collider parity principle that governs when each new render shape should also
gain a collision body. All four were fenced out of Physics Stage 3 / Stage 4A as
"not load-bearing for bowling" and share the same trigger family — a demo finally needs
the shape. Order: the two queued render primitives first (the parity entry points at
them), then the tessellation API, then the parity principle.

## Box / parallelepiped primitive

### Context
Axis-aligned boxes are served today by `geometry.cube` + `mesh.setScale` (the
bowling lane). A dedicated `geometry.box({ width, height, depth })` would bake
correct per-face normals (no inverse-transpose needed under non-uniform dims),
and a parallelepiped would add shear. Neither is load-bearing for bowling.

### Trigger to revisit
A demo needs correct normals under non-uniform box dimensions without the
deferred inverse-transpose normal fix, or a sheared parallelepiped.

### Reference
Physics Stage 3 (render shapes) design §1 OUT.

## Cone + open-ended cylinder

### Context
`geometry.cylinder` (Stage 3) is single-radius and always capped. Engines commonly
also expose `radiusTop ≠ radiusBottom` (cone/frustum) and an `openEnded`/`capped`
toggle (open tube). Deferred — bowling pins are capped solids.

### Trigger to revisit
A demo needs a cone/funnel/frustum or an open tube.

### Reference
Physics Stage 3 (render shapes) design §1 OUT.

## Tunable tessellation geometry API

### Context
`geometry.sphere`/`cylinder` (Stage 3) ship with FIXED internal tessellation and
no segment params — matching `cube`/`plane` and the Unity/Unreal basic-primitive
posture (the 7-engine survey put tunable tessellation behind a separate procedural
API: Unity ProBuilder, Unreal Geometry Script `AppendSphereLatLong`). When furnace
needs tunable density, add a distinct geometry-generation surface rather than
bolting segment counts onto the basic factories.

### Trigger to revisit
A demo needs a low-poly aesthetic, a hero close-up, or LOD that the fixed default
can't serve.

### Reference
Physics Stage 3 (render shapes) design §0/§1.

## Geometry ↔ collider primitive parity

**Filed 2026-06-04** (Stage 4A — "Playable Core", `2026-06-04-stage-4a-playable-core`). A forward design note, surfaced when the bowling pins gained a cylinder collider to match the existing `geometry.cylinder` render primitive.

### Context

Stage 4A added a `{ cylinder: { halfHeight, radius } }` `ShapeDescriptor` variant so the dynamic pins have a collision body matching their `geometry.cylinder` render mesh. This established a principle worth holding going forward:

> **A render-geometry primitive should have a collider counterpart, so we never ship a render shape that can't be given a collision body.**

Current pairings:
- `geometry.sphere` ↔ `{ ball }` collider ✓
- `geometry.cube` ↔ `{ cuboid }` collider ✓
- `geometry.cylinder` ↔ `{ cylinder }` collider ✓ (Stage 4A)
- `geometry.plane` ↔ (no dedicated collider — a thin `{ cuboid }` substitutes; static ground use only)

Gaps will appear as new render primitives land. Backlog primitives already queued (the *Box / parallelepiped primitive* and *Cone + open-ended cylinder* sections above) would, on the parity principle, each want a collider counterpart — but only if Rapier provides one natively (per the Stage-4A gate-rule: no JS-side physics math; gaps flag toward the Jolt swap, never faked). E.g. a cone collider exists in Rapier; an open-cylinder (no caps) has no natural rigid-body collider and would stay render-only.

This is an observation/principle, not a committed task — there is no current consumer waiting on a specific new collider.

### Trigger to revisit

When a NEW render-geometry primitive lands (cone, capsule-as-render, parallelepiped, etc.) AND a demo/consumer needs that shape as a collision body. At that point: add the matching `ShapeDescriptor` variant IF Rapier provides the collider natively; otherwise flag the gap toward `jolt-backend-swap.md` and keep the render primitive collider-less with a documented note.

### Reference

- Origin: Stage 4A (cylinder collider; surfaced in the stage's adjacent findings).
- Gate-rule: pure pass-through to Rapier; no JS-side physics math.
- Related: the *Box / parallelepiped primitive* and *Cone + open-ended cylinder* sections above (queued render primitives), `jolt-backend-swap.md` (where collider gaps flag)
- API: `docs/reference/core-modules.md` `@furnace/core/physics` (`ShapeDescriptor`), `@furnace/core/geometry`
