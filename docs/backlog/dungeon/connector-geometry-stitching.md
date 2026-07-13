# Dungeon: isosurface↔built blending at collar-to-rock contact

> Narrowed at the W4 sweep (2026-07-13): the entry's placer-era history (enclosures,
> threshold plates, `layout.ts` clearance synergy) retired with the mesh connector
> kit. What remains open is exactly one question.

**Context.** A cave mouth's masonry collar (`built.ts mouthCollar`) presents a
standardized door-class portal and masks the irregular bore rim by interpenetration —
but nothing BLENDS the isosurface to the collar at the rock contact. The single
shipped blending pattern in the research corpus is single-representation: stamp a box
SDF into the cave field at the mouth before meshing
(`docs/research/2026-07-10-world-substrate-and-region-composition.md` §1). The
one-field direction (`docs/research/2026-07-13-one-field-direction.md`) makes this
natural — collar/patch becomes the boundary treatment between per-cell material
classes.

**Trigger to revisit:** the Jolt-era isosurface↔built blending pass, or the field
charter's material-class boundary design — whichever lands first.

**Reference:** `packages/dungeon/src/built.ts` (`mouthCollar`),
`packages/dungeon/src/themes/cave.ts` (collar application at mouths).
