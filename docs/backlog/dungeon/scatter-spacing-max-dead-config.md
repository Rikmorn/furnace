---
summary: ScatterLayerSpec.spacing.max is inert — scatter() reads only spacing.min, so every authored max-gap range does nothing
---

# `ScatterLayerSpec.spacing.max` is dead config — scatter() reads only `spacing.min`

**Context.** Surfaced during W2 Task 13 (hall dressing) and reported-but-not-filed in the
executor's wrap: every scatter layer spec in the repo declares a `spacing: { min, max }`
range (cave dressing, room floor scatter, and now the hall crates/rubble layers with
"1.6–2.6" / "0.9–1.6"), but `packages/dungeon/src/scatter.ts` (gone) consumes only `spacing.min`
(Poisson-style rejection by minimum distance). The `max` half of every authored range is
inert — the authored intent ("no larger gaps than X") is silently not enforced, and the
field's presence in the type invites authors to keep tuning a knob that does nothing.

Pre-existing (not a W2 regression). Two honest resolutions, per the single-source-of-truth
rule: (a) delete `max` from `ScatterLayerSpec` and every spec literal (reductive — spacing
becomes a scalar `minDistance`), or (b) implement max-gap enforcement if a dressing pass
actually wants density floors. Do not leave the split state.

**Trigger to revisit.** The next scatter/dressing-touching tranche (3.4 Seeing dressing
polish, or any task editing `ScatterLayerSpec`). Option (a) is the default unless a real
max-gap need has appeared.

**Reference.** `packages/dungeon/src/scatter.ts` (gone) (`spacing.min` consumption),
`packages/dungeon/src/world/region.ts` (`ScatterLayerSpec.spacing`), hall layers in
`packages/dungeon/src/world-build.ts` (gone) (W2 Task 13). Surfaced in the W2 execution report
("not done" item 4), filed by the W2 verification pass 2026-07-12.
