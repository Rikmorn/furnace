# Walkability `narrow` probes 0.5 m for a 0.3 m capsule (cell-rounding artifact)

`analyzeChunk`'s `narrow` filter asks whether rock stands within a capsule radius at torso height,
resolved to cells as `wallCellsXZ = Math.ceil(profile.capsule.radius / cellSize)`
(`packages/core/src/field/analyze.ts`). At the production 0.25 m lattice and the dungeon's 0.3 m
capsule that is `ceil(1.2) = 2` cells — **a 0.5 m probe for a 0.3 m radius, 67% over-strict**. The
rounding is deliberate and miss-safe (the module's `metricsFor` comment: `ceil` on what the capsule
REQUIRES, `floor` on what it is ALLOWED, so every threshold lands strictly tighter than the real
mover), and it is faithful to the F0 donor. But the margin is an artifact of the lattice, not a
designed one — at a 0.5 m cell size the same expression gives a 0.5 m probe for the same capsule,
so the strictness varies with cell size rather than with the agent.

Measured 2026-07-26 by `packages/dungeon/scripts/measure-analyze.ts` on the F3b default cave
(seed 1, 108 chunks): **236 `narrow` flags, 214 of them reachable and on standable ground.**
Counterfactual at a 1-cell (0.25 m) probe: **86** — so roughly 150 of the 236, about 64%, exist
only because of the rounding. `narrow` is the single largest contributor to that world's 323
default-visible candidate flags on walkable ground, and the second largest (787 of 1485) on the
largest committed field world.

Two things this entry is NOT. It is not a bug report: the filter is behaving as written and in the
miss-safe direction, and F4's stop condition explicitly forbade tuning it to make the P-F4-3 number
look better. And it is not a proposal for a specific fix — the honest options (probe the true metre
radius with a fractional-cell test, keep `ceil` but require the pinch at the *nearest* cell, or
leave it and lean on stage-2 `analyzerVerify` to filter) have real tradeoffs that need the design
pass the halt exists to make room for. A related datum from the same measurement: the rim artifact
documented in `analyzeChunk`'s `@remarks` (unallocated space reads SOLID, so region edges grow
phantom `narrow`) contributes **0 of the 236** here — that hypothesis was checked and refuted, so
this rounding is the real driver, not edge effects.

**Trigger to revisit:** the F4 stop-condition decision. P-F4-3 was refuted (323 / 1485 candidates
on walkable ground, where the premise wanted a triage-able number) and the tranche halted before
Tasks 10/11 could pick UI defaults. Whatever the user rules — accept the count and lean on
severity/verify filtering, or revisit the thresholds — this measurement is the input, and this
entry closes when that ruling lands.

**Reference:** `packages/core/src/field/analyze.ts` (`metricsFor`, `narrowSides`),
`packages/dungeon/scripts/measure-analyze.ts` (the measurement, re-runnable with
`bun scripts/measure-analyze.ts` from `packages/dungeon`), `packages/dungeon/src/walk-probe.ts`
(stage 2, the filter the counts would otherwise have to go through one at a time).
