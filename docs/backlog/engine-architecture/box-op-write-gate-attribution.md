# `lattice-aligned-box-op-writes-nothing` attributes the miss to the wrong gate

Filed 2026-08-12 during the docs-system rung-1 citation triage, which read every cited site
in that entry while re-anchoring its line numbers to symbols.

## Context

`docs/backlog/engine-architecture/lattice-aligned-box-op-writes-nothing.md` opens with
"Sample writes are gated on a STRICT `sdf > 0` (`applyOp`'s fill and paint legs, and
`applySmooth`)". At the fill leg in `packages/core/src/field/ops.ts` that is only half true:

- the **material** write is `writeM = sdf > 0 && solidAfter && getMaterial(...) !== mat`
- the **density** write is `writeD = nd < d` — no `sdf > 0` term at all
- the `dig` leg tests neither

So the entry names one gate for a behaviour that has two, and the one it names does not
govern the density channel — which is the channel its own measured repro (a fill that
changed no geometry) is about.

The entry's **conclusion** is not in dispute here: the measured run is a dated snapshot, and
a face-lying sample plausibly fails `nd < d` for its own reason. What is unverified is the
mechanism the entry asserts, and a wrong mechanism is what makes a fix land in the wrong
place. This matters more than a normal doc nit because the entry is written as evidence for
a future change to op semantics.

## Trigger to revisit

Before any work acts on `lattice-aligned-box-op-writes-nothing.md` — a fix to box-op
inclusivity, a change to the write gates, or a slice that cites it as evidence. Re-derive
what actually excludes a face-lying sample per channel (density vs material, per effect
leg), then restate that entry's first paragraph from the derivation.

## Reference

- `packages/core/src/field/ops.ts` — `applyOp`'s fill / paint / dig legs and their
  `writeD` / `writeM` predicates; `applySmooth`.
- `docs/backlog/engine-architecture/lattice-aligned-box-op-writes-nothing.md` — the entry
  this corrects.
- `docs/learnings/2026-08-12-agent-world-building-cycle-2.md` — the monastery run the
  original observation came from.
