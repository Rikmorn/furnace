# Two-point tunnel brush (segment shape on the brush chassis)

**Context.** From the user's post-F2a QoL dump (2026-07-16, F2b planning): "creating
connections in space is a bit difficult — digging could be easier by selecting two
points and having a tunnel with whatever shape we selected in the tool." The natural
design is a third chassis shape kind: `segment` — click point A, click point B, the op
carves/fills the swept volume of the current cross-section (sphere → capsule tunnel,
box → rectangular corridor), previewed with the ghost machinery, one op in the log.
Deliberately **backlogged out of F2b** (user: "not sure it's the right thing to do, I
was just spitballing") — the idea needs a design look first: interaction with the kit
lattice discipline for box cross-sections, the two-click targeting UX (both clicks are
surface-aimed; a tunnel usually wants to START at a surface and END at another), and
overlap with what F3's cave/connection generators may cover natively.

**Trigger to revisit:** the F3 brainstorm (cave + connections arc), or the first
post-F2b field-tool feel round — whichever fires first.

**Reference:** F2 spec §3.1 brush chassis (local/gitignored design spec);
`packages/editor/src/frontend/lib/field-brush.ts`;
`packages/core/src/field/ops.ts` (brush op shape kinds). Precedent note: WorldEdit
`//line` / Axiom path tools are the shipped analogues if design research is wanted.
