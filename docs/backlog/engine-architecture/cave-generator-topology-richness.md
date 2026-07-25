# Cave generator — tweakable web topology

**Context.** F3b gate round 1 (2026-07-25), user: a cave stamped into a region can
read as "just a tunnel" — the wish is "a tweakable procgened web of caves to make
them look more natural." The generator's skeleton already builds
chambers + spanning-tree passages + `extraLoops` (0–3) with explicit verticality,
but at default params (chambers 3) in a modest region the result reads tunnel-like
rather than web-like. The carved footprint of a default 20×10×20 m cave measures
~17% of the region (71 m²) — sparse by construction.

**Shape of the work.** Design-level, not a bug: richer topology dials (chamber
count scaling with region volume, branch/web density, dead-end spurs, loop bias),
possibly a `topology` preset enum (tunnel / branchy / web) so SchemaForm stays
small; document region-size guidance (what region volume a given chamber count
wants). Keep D-F3-11 (bias + visibility, no repair loops) and the patch-op budget
tests honest — a web preset raises op counts, so the budget ceilings are part of
the design.

**Trigger to revisit:** the next cave-content slice (F4's seeing pass will make
cave structure visible enough to tune against, or the first dungeon content pass
that authors real cave areas).

**Reference:** `packages/core/src/field/cave.ts` (skeleton half);
`docs/research/2026-07-21-f3-traversable-cave-generation-research.md` (topology
precedents); F3 spec D-F3-11/12.
