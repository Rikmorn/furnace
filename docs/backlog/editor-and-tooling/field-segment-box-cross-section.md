# Segment brush: a BOX cross-section (rectangular corridor sweep)

**Context.** The segment brush shipped in F3b (spec D-F3-14, plan Task 13) sweeps the
brush SPHERE between two clicked points — a `capsule` `BrushShape` in
`packages/core/src/field/ops.ts`, committed as one ordinary brush op with the active
tool's effect (dig → tunnel, fill → rampart). The original ask
(`field-two-point-tunnel-brush.md`, now resolved and deleted) framed it as sweeping
"whatever shape we selected in the tool", i.e. the BOX cross-section too: a rectangular
corridor rather than a round tunnel. That half was explicitly cut from Task 13 as the
first trim, and it is the half with real design questions attached:

- **Orientation.** A swept box needs a roll about the sweep axis that two clicked points
  do not supply. World-up-aligned is the obvious default and is wrong for a vertical
  sweep (the degenerate case the capsule handles by having no orientation at all).
- **Kit lattice discipline.** Kit classes are grid-locked to the 0.5 m lattice and
  `assertOpValid` accepts only an axis-aligned BOX for them — so a swept box is the one
  shape that could plausibly carry a kit class, and only when the sweep is
  axis-aligned AND both endpoints snap. That is a new validation rule, not a reuse.
- **SDF cost.** A capsule's SDF is one clamped projection; an oriented box sweep needs a
  rotation into the box's frame per sample, in the applier's innermost loop.

None of that is hard, but none of it is free, and the round tunnel covers the use case
that motivated the ask ("creating connections in space is difficult").

**Trigger to revisit:** a use of the segment brush that WANTS square corridors — most
likely built-kit masonry passages, where the round capsule cannot carry a kit class at
all. Or the F4 tool-feel round, if the sphere/box brush duality gets revisited wholesale.

**Reference:** F3 spec §3.3 + D-F3-14 (local design spec); `BrushShape` in
`packages/core/src/field/types.ts`; the capsule SDF + `assertOpValid` kit rule in
`packages/core/src/field/ops.ts`; the gesture in
`packages/editor/src/viewport-host/field-host.ts` (`segmentClick`). Precedent: WorldEdit
`//line` and Axiom's path tools ship both cross-sections.
