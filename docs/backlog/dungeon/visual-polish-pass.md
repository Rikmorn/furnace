# Dungeon visual polish pass

Tracker for the dungeon "look, not structure" work all deferred to the same 3.4 / 3.5
visual-polish pass — the first time the dungeon's LOOK (rather than its generation
correctness) is the thing being judged. Two entries: a richer rim-collar case set and
a material/UV atlas for the masonry kit. (A third — real procedural archetype meshes
for the decorative scatter — resolved into F3b's catalog mesh bake and was deleted at
the F3b seal.) They are merged because they share that one trigger and both live on
the same kit/scatter surface. Sections keep their original order.

## Richer rim-collar case set (corners, diagonals, opening-sized collars)

**Context.** W2 ships the **2-piece rim collar** (E3): at every suppressed↔kept panel junction,
`packages/dungeon/src/substrate/collar.ts` (gone) emits one piece from the SUPPRESSED side — `rimPostV`
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

**Reference.** `packages/dungeon/src/substrate/collar.ts` (gone) (`collarInstances`, `inPlaneSteps`);
`packages/dungeon/src/substrate/pieces.ts` (gone) (`rimPostV` / `rimEdgeH` / `COLLAR_SECTION`); spec §2
(collar), decision E3.

## Kit pieces: material / UV atlas instead of flat per-piece materials

**Context.** W2's masonry kit ships **flat per-piece materials** — the charter minimum.
`packages/dungeon/src/substrate/pieces.ts` (gone) defines `KIT_MATERIALS` as four solid
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

**Reference.** `packages/dungeon/src/substrate/pieces.ts` (gone) (`KIT_MATERIALS`, `variantHash`,
`PIECE_BOX`); `packages/dungeon/src/substrate/skin.ts` (gone) (the per-material bucketing in `bucket`);
spec decision D-W2-1.

