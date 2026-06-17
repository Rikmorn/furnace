# Dungeon: generated-room floor seams + chamber bumpy-floor visibility

**Context.** Epic 2 Slice 2.1 added three generated rooms walked on with real trimesh
physics (cavern bowl, vertical shaft, walk-in chamber). The visual gate surfaced
character-controller-vs-trimesh seam issues that were worked around, not solved:

- **Chamber (walk-in bumpy floor).** The carved floor is a *thin* trimesh sheet
  (`boxCavern` whose walls/ceiling sit outside the grid → only the y≈0 floor meshes,
  via `taperedNoiseDisplace` + `rectWeight` for a flush, edge-tapered surface). A
  capsule controller catches on the thin sheet's exposed edge at the seam with the
  solid box floor, blocking traversal. Worked around by **restoring the solid box
  floor strip under the sheet** (`level.ts` front strip `{center:[0,0,-19],
  size:[12,0.2,6]}`) so crossing is box-to-box. Side effect: the flat box floor (top
  y=0.1) now visually dominates and **the bumpy sheet is mostly hidden** (only bumps
  > 0.1 poke through, and they read weakly). So the chamber is walkable but the
  "carved floor" look is lost.
- **Shaft / cavern rims.** User noted visible seams where the generated rooms meet the
  authored box geometry (accepted for now).

**Options to revisit (pick when polishing):**
- Give the carved floor real *thickness* (a closed slab with meshed top + sides) so it
  has no thin exposed edge — then it can replace the box floor and the bumps show.
- Or keep the box base but offset the sheet up so its whole range sits above the box
  top (bumps fully visible), tapering to flush at the seam.
- Tune controller autostep / snap-to-ground for thin-trimesh seams generally.
- Blend/skirt the generated mesh into the authored box geometry at the rim.

**Trigger to revisit.** After Slice 2.1's persistence round-trip lands (the "main work"),
during a dungeon visual-polish pass. Not blocking — the controller-generalisation
de-risk (walk on sloped / vertical / horizontal trimesh) is already met.

**Reference.** Slice 2.1 plan/spec (`docs/superpowers/` local scaffolding);
`packages/dungeon/src/{generator,field,level}.ts`; memory `project_dungeon_epic2_procgen`.
