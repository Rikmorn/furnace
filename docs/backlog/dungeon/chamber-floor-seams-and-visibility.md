# Dungeon: generated-room rim seams + chamber floor visibility polish

**Context.** Epic 2 Slice 2.1 added three generated rooms walked on with real trimesh
physics (cavern bowl, vertical shaft, walk-in bumpy chamber). The traversal half of this
entry is now **resolved by Slice 2.1.1**: the box-floor chamber workaround (the solid box
strip restored under the thin carved sheet so a capsule could cross) was **removed**, and
the custom `CharacterMover` collide-and-slide controller walks the generated chamber floor
directly — it is now the real walking surface. What remains is purely *visual*:

- **Generated-room ↔ authored-box rim seams.** Visible seams where the generated rooms
  meet the authored box geometry (shaft / cavern / chamber rims). Accepted for now.
- **Chamber carved-floor visibility / look.** With the box floor gone the bumpy carved
  sheet is the surface, but its look may still want tuning (sheet visibility, displacement
  range, how the carved bumps read against the lighting) now that nothing sits over it.
- **Hall ↔ chamber seam fall-through gap.** Surfaced at the 2.1.1 visual gate: removing the
  box-floor workaround exposed the seam in its *worst* form — the generated chamber sheet
  doesn't quite meet the authored corridor floor, leaving a gap at the hall↔chamber seam
  that the player can **drop through into the void**. This is the same rim-seam issue as
  above (a discontinuity where generated meets authored geometry), not a `CharacterMover`
  bug — it is the expected fallout of removing the workaround, and the seam-stitching /
  skirt fix listed below resolves it (it closes the hole, not just the visual seam).

**Options to revisit (pick when polishing):**
- Blend / skirt the generated mesh into the authored box geometry at the rim so the seam
  isn't a hard discontinuity.
- Tune the chamber sheet's displacement / material so the carved floor reads as intended.
- Give the carved floor real *thickness* (a closed slab with meshed top + sides) if a
  no-exposed-edge look is wanted at the rim.

**Trigger to revisit.** During a dungeon visual-polish pass. Not blocking — traversal over
the generated geometry is solved (Slice 2.1.1); only the look at the seams and the carved
floor's visibility remain.

**Reference.** Slice 2.1 + 2.1.1 plan/spec (local design scaffolding);
`packages/dungeon/src/{generator,field,level}.ts`; `packages/dungeon/src/char-move.ts`;
memory `project_dungeon_epic2_procgen`.
