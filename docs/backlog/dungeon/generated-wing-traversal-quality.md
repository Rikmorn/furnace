# Generated-wing traversal quality — 3.1 gate observations (2026-07-06)

Walk-feel findings from the first baked-wing gate (seed `2222:1`, post-`themeParams`
parity fix — so these are GENERATOR quality, verified not bake fidelity; the parity
test `bake-dressing-parity.test.ts` pins that split). User classification at the gate:
"not something we can solve at this point" — noted, not fixed in 3.1.

**Context.**
- **Vertical transitions into/out of caves feel worst.** Climbing connectors meeting
  cave mouths combine three known classes: voxel-quantized cave floors (0.25 m steps)
  against built collar sills, descending-landing geometry at organic thresholds, and
  the isosurface↔built rim (`connector-geometry-stitching.md` — Epic-3.4 territory,
  "built places, organic carves" + the carve-union probe).
- **Tight corners catch the capsule.** Enclosure inner corners and short dogleg turns
  at ~oblique joins; related to `oblique`-class seam wedges (the threshold-plate fix
  covered door planes, not mid-connector corners).
- These are exactly what 3.2's spatial failure viz + curation verbs should make
  visible and locally fixable (reroll/delete/move the offending piece), and what the
  3.4 organic arc re-founds for caves.

**Trigger to revisit:** 3.2 (make them visible + curatable) and 3.4 (carve-union
re-founding for the cave side). Fold into whichever brainstorm lands first.

**Reference:** `connector-geometry-stitching.md`, `landing-walled-low-portal-discriminator.md`,
`region-connection-algorithm-refinement.md` (the sibling generator-quality entries);
`docs/backlog/editor-and-tooling/generation-cockpit-ux-gate-findings.md` (same gate,
editor-side findings).
