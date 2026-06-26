# Collision representation decoupled from render — field-derived collision proxies

**RESOLVED 2026-06-22 — not an open item.** Kept as a breadcrumb because this topic
churned hard (three gate rounds). Was the leading direction for 2.2; superseded
`character-mover-trimesh-wall-robustness.md` and `heightfield-walkable-collision-surface.md`
(both deleted).

## How it resolved

The root cause was real: internal-edge "ghost collisions" on the detailed Surface-Nets
render trimesh under Rapier's `trimesh` (no internal-edge filtering) trap the capsule
(curved-wall stuck, floor stall, seam fall-through). The fix shape was also right: collide
against a **separate, simpler representation derived from the field** (single source of
truth, two realizations), not against the render mesh.

- **Proxy form chosen: field-derived voxels** — shipped in **Slice 2.2.1**
  (`packages/dungeon/src/proxy.ts`, core `voxels` `ShapeDescriptor`). Ghost-free by
  construction. The accepted trade is blockiness, absorbed by the 2.1.1 camera eye-height
  smoothing + anisotropic-Y voxels. The custom `CharacterMover` stays and is fed clean
  voxel input (a layering, not a walk-back).
- **Heightfield is dead** — broken in the vendored `rapier3d-compat@0.19.3` wasm
  (`docs/learnings/rapier-heightfield-broken-0.19.3.md`); also 2.5D (no caves).
- **Convex-hull / VHACD decomposition** — not pursued; voxels covered every region kind
  with one code path.

## The endgame moved elsewhere

Voxels are a **bridge**, not the permanent answer. The 2026-06-22 Jolt spike confirmed the
real endgame — collide the detailed render mesh directly on an **edge-aware** engine (Jolt
`CharacterVirtual`, the NMS pattern), retiring voxels. That work now lives in
**`jolt-backend-swap.md`** (trigger #4 + the Slice 2.2.1 spike section) and
**`docs/learnings/jolt-mesh-collision-spike.md`**.

## Remaining 2.2 work (separate entries)

The 2.2 holistic split left generator richness (2.2.2, landed) and populate/scatter (2.2.3a,
landed — GPU instancing in `@furnace/core` + decorative scatter in the dungeon; see the
`packages/core` + `packages/dungeon` bullets in `AGENTS.md`) — broader procgen direction in
`procedural-generation-direction.md`. Recipe-as-truth stays in `region-recipe-as-truth.md`.
