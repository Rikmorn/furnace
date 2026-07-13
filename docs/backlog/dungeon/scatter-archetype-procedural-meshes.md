# Dungeon: real procedural archetype meshes for decorative scatter

## Context

Slice 2.2.3a added a decorative scatter system (`packages/dungeon/src/scatter.ts`) that
GPU-instances props across the generated regions — a 5-layer cave showcase (rubble,
crystal-spires, glow-fungus, wall-crystals, ceiling glow-worms) plus a floor scatter on the
built rooms (then the box-room theme's, retired at the W4 sweep; grid regions now carry the
same layers as `GridStamp.dressingLayers`). To ship the slice the **archetypes are
uniform-scaled unit primitives**
(cube / sphere / cylinder), so a "glow-worm" is a stretched-by-uniform-scale cylinder and a
"crystal spire" is a uniform cube/cylinder — the *placement* (slope/density masks, blue-noise
spacing, surface-aligned orientation, ceiling-hang) reads correctly, but the **silhouette**
does not. The instancing path is **uniform-scale-only by construction** (the `litInstanced`
variant derives its normal from `mat3(model)`), so a tall-thin spire or a head/tail worm
can't even be faked with non-uniform scale — it needs a real archetype mesh whose *geometry*
carries the shape.

The swap-in seam already exists: the `ArchetypeGeometry` descriptor in
`packages/dungeon/src/region.ts` is where a scatter layer names its archetype. Replacing the
unit-primitive resolution with real procedurally-generated archetype meshes (a tapered spire,
a segmented worm, a clustered crystal) — keyed by the same descriptor — is the change.

## Trigger to revisit

When the decoration's primitive silhouette stops reading — i.e. when the uniform-primitive
stand-ins are the visible limiter on the scatter's look (e.g. the ceiling glow-worms can't
show a head/tail as symmetric cylinders, or spires need to be genuinely tall-and-thin rather
than uniform-scaled). Likely during a dungeon visual-polish pass.

## Reference

- `packages/dungeon/src/scatter.ts` (the scatter system + `InstanceGroup` baking).
- `packages/dungeon/src/region.ts` — `ArchetypeGeometry` descriptor (the swap-in seam) +
  `ScatterLayerSpec`.
- `packages/dungeon/src/realize.ts` (posture-aware instanced realization).
- 2.2.3a research: `docs/research/2026-06-26-dungeon-2.2.3a-instancing-and-scatter.md`.
- Uniform-scale precondition: the `litInstanced` shader variant (`packages/core/src/shader/builtins.ts`).
