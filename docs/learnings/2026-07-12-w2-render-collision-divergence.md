# W2 gate post-mortem: collision probes green, render wrong — three rules

The W2 slice (substrate + grid-built halls) passed 1548 tests, two-stage reviews on
all 15 tasks, and four full-collider traversal probes — and still arrived at the
Safari gate with the collar-bore opening RENDERING CLOSED (while crossable), a
Surface-Nets blob bulging into the hall, and void holes at the floor rim. Two gate
rounds fixed it (commits `f2104e9`, `900606f`). This records why every layer missed
it and what changes. Sibling of `shadow-mapping-stage4-silent-bugs.md` — same class,
generator-side.

## What each layer verified (and the hole between them)

- **The plan carried both root causes** (capsule carve; patch field reading off-grid
  as unconditionally solid). Executor implemented faithfully; reviewers verified
  diff-vs-plan and ran tests. Code review cannot catch a design error the plan itself
  encodes and no test contradicts.
- **Every test asserted collision or counts; none asserted render-mesh SHAPE.** The
  E2 property test checks box containment, not "the patch has a hole through it."
  A lid across the doorway passed the whole suite legitimately.
- **The spike validated the patch mechanism mid-grid only.** The collar-bore exits
  through the region's GRID EDGE — a boundary condition the spike never exercised,
  filed under one coarse "substrate mechanisms production-viable" premise row.
- **The bug edited the content under test.** The over-carve DELETED the colonnade
  pillar sitting in the probe lanes; the traversal probes ran green against geometry
  the bug had modified. Fixing the carve made the probes fail honestly
  (spawn-inside-pillar) and exposed real bad content (a door with a pillar on its
  approach axis) — which became the stamper's door-lane validation.

## The rules (bind them in specs/plans from W3 on)

1. **Mesh-topology properties get headless GEOMETRIC assertions, not just walks.**
   Any mechanism whose output mesh must have a required topological property — an
   opening, a hole, a seam overlap, a clip — gets a triangle-level test: the
   sightline probe (Möller–Trumbore segment-vs-mesh, `tests/substrate-carve.test.ts
   segTri/patchBlocks`) cost ~an hour and would have failed at Task 3 of the original
   plan. Same family: the shell-band overlap assertion (`connector-built.test.ts`,
   mesh must enter but never exceed the band). Pixel gates stay the final authority
   for LOOK; topology is testable before pixels.
2. **A spike-proven mechanism at a NEW boundary condition is a NEW premise.**
   Grid edge vs mid-grid, rotated vs identity placement, portal-exit vs interior —
   each gets its own premises-table row and probe, not a citation of the spike.
3. **When a generator bug is fixed, re-ask what content the bug was producing.**
   Probes that were green against bug-modified content are not evidence; re-run them
   and expect NEW failures that are the fix working (the pillar class). Corollary:
   traversal fixtures should isolate what they probe (the seam fixture dropped
   pillars; pillar collision belongs to the hall-walk probe).

## Also learned here

- **Interpenetration is the seam-sealing mechanism on BOTH substrate classes.** Two
  independently-meshed SN surfaces meeting edge-to-edge at a plane always show a
  crack ring (vertices never align). The fix is always overlap: field overshoot at
  cave mouths (W1), grid extension through the built shell band (`extendA`,
  recorded in the manifest like `radius`/`overshoot`). Any future seam between
  separately-meshed volumes starts from "where do the surfaces overlap?", never
  "do the edges meet?".
- **Flat-ended cylinders, not capsules, punch walls.** A capsule's spherical end
  sweeps `radius` past its segment — into rooms, floors, pillars. `CarveVolume`
  now has both; wall openings use the cylinder with a threshold Y-clip.
