# Dungeon visual polish pass

Tracker for the dungeon "look, not structure" work all deferred to the same 3.4 / 3.5
visual-polish pass — the first time the dungeon's LOOK (rather than its generation
correctness) is the thing being judged. Three entries: a richer rim-collar case set,
a material/UV atlas for the masonry kit, and real procedural archetype meshes for the
decorative scatter. They are merged because they share that one trigger and all live
on the same kit/scatter surface. Sections keep their original order.

## Richer rim-collar case set (corners, diagonals, opening-sized collars)

**Context.** W2 ships the **2-piece rim collar** (E3): at every suppressed↔kept panel junction,
`packages/dungeon/src/substrate/collar.ts` emits one piece from the SUPPRESSED side — `rimPostV`
for a vertical junction edge, `rimEdgeH` for a horizontal one — so a carved opening reads as a
deliberately framed cut rather than a ragged hole. The floor-rim path (a suppressed +Y face) is
exercised by test, and the piece-type dispatch is pinned by a regression test.

Two pieces is the minimum that reads as "built edge". It does NOT handle:
- **corners / diagonals** — where two collar runs meet, the two boxes simply abut (no mitred or
  corner piece), which is visible at a carve's rectangle-ish corners;
- **opening-sized collars** — a large bore gets N small pieces rather than one arch/lintel scaled
  to the opening, so a big cut reads as beading rather than architecture.

**Trigger to revisit.** The visual polish pass (3.4 / 3.5) — the first time the collar is judged
as *architecture* rather than as "the hole is framed, not ragged". Pairs naturally with the
*Kit pieces: material / UV atlas instead of flat per-piece materials* section below (both are
look-not-structure work on the same kit).

**Reference.** `packages/dungeon/src/substrate/collar.ts` (`collarInstances`, `inPlaneSteps`);
`packages/dungeon/src/substrate/pieces.ts` (`rimPostV` / `rimEdgeH` / `COLLAR_SECTION`); spec §2
(collar), decision E3.

## Kit pieces: material / UV atlas instead of flat per-piece materials

**Context.** W2's masonry kit ships **flat per-piece materials** — the charter minimum.
`packages/dungeon/src/substrate/pieces.ts` defines `KIT_MATERIALS` as four solid
`MaterialDescriptor`s (ashlar / floor-ceiling / trim / collar) and `skin.ts` buckets every emitted
piece into one InstanceGroup per material index. Per-piece variation today is a **seeded value
jitter on the instance tint** (`variantHash` → an FNV-1a hash of (seed, cell, face), replacing the
spike's banded `%5`), which reads as subtle tonal variety but carries no texture detail.

That is enough to gate the slice on silhouette + composition, but it is the ceiling on how good
masonry can look: no albedo/normal detail, no per-piece UV variation, no wear//damage maps.

**Trigger to revisit.** The 3.4 / 3.5 visual polish pass — the first time the dungeon's LOOK
(rather than its structure) is the thing being judged. At that point the work is a material/UV
atlas: one atlased material per kit family, per-piece UV rects selected by the same
`variantHash`, so the instanced path stays one draw per family.

**Reference.** `packages/dungeon/src/substrate/pieces.ts` (`KIT_MATERIALS`, `variantHash`,
`PIECE_BOX`); `packages/dungeon/src/substrate/skin.ts` (the per-material bucketing in `bucket`);
spec decision D-W2-1.

## Dungeon: real procedural archetype meshes for decorative scatter

**Disposition note (2026-07-23).** This entry is ALSO named as resolving into F3b's catalog
mesh bake (F3 spec §7): when F3b's mesh bake lands, real archetype meshes may satisfy this need
directly. The section is kept here for now; **F3b's seal may delete just this section** from the
tracker once its mesh bake supersedes it.

### Context

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

### Trigger to revisit

When the decoration's primitive silhouette stops reading — i.e. when the uniform-primitive
stand-ins are the visible limiter on the scatter's look (e.g. the ceiling glow-worms can't
show a head/tail as symmetric cylinders, or spires need to be genuinely tall-and-thin rather
than uniform-scaled). Likely during a dungeon visual-polish pass.

### Reference

- `packages/dungeon/src/scatter.ts` (the scatter system + `InstanceGroup` baking).
- `packages/dungeon/src/region.ts` — `ArchetypeGeometry` descriptor (the swap-in seam) +
  `ScatterLayerSpec`.
- `packages/dungeon/src/realize.ts` (posture-aware instanced realization).
- 2.2.3a research: `docs/research/2026-06-26-dungeon-2.2.3a-instancing-and-scatter.md`.
- Uniform-scale precondition: the `litInstanced` shader variant (`packages/core/src/shader/builtins.ts`).
