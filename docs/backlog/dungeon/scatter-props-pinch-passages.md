# Scattered props pinch passages — the advisor's whole candidate budget

**Context.** P-F4-3b (2026-07-26, `packages/dungeon/scripts/measure-analyze.ts`) measured the
walkability advisor over the twelve P-F3-1 walked cave configs, bare and with catalog scatter at
the AUTHORED densities a real bake carries. Bare, every config produces **0–3** candidate flags
on walkable ground and **0** pit regions. The same twelve configs with props produce **29–47**
candidates, and 2 of 12 grow a pit region.

The flags are **true positives**, verified by reading the store: the recurring shape is carved
rock at `d = 1` on one side of an axis and a voxelized prop collider at `d = 2` on the other —
**0.50 m of free width against a 0.60 m capsule** (bar `2r + skin` = 0.68 m). A boulder dropped
half a metre off a cave wall really does seal the passage. The 6-column pit at cell `[29,1,52]`
in propped `mined|mixed/v0.25/s1` is the same cause: a pocket between a prop blob and the wall,
entered by a 0.75 m drop off the prop top, 0.05 m past the 0.70 m climb ceiling.

This **INVERTS** the pre-Task-7.1 observation that props REDUCE `narrow`. That was an artifact of
the old rounded-cell-radius predicate (it counted inside corners, and a prop's solidity deleted
the floor anchor beneath it). The opposing-face predicate measures the wall-to-prop gap, which is
the thing that actually blocks a mover.

Nothing here is an analyzer defect — the advisor is doing its job, loudly. The open question is
whether the **scatter generator** should refuse placements that pinch a passage below the agent's
own bar (a min-clearance rejection test at placement time, reading the same `catalog/agent.json`
profile the analyzer reads), or whether the advisor flagging them after the fact is the intended
authoring loop. That is a design decision, not a fix.

**Trigger to revisit.** Either (a) the F4 flags panel ships and prop-induced `narrow` flags
dominate it in real use to the point of drowning the findings a human cares about, or (b) a gate
walk gets physically stuck on a prop-pinched passage in a propped bake. Until one of those, the
advisor surfacing them is the feature.

**Reference.** Measured tables in the Task-7.3 report (`P-F4-3b MEASURED`);
`packages/dungeon/scripts/measure-analyze.ts` + `scripts/measure/` (re-runnable, prints each
candidate's measured free width); `packages/core/src/field/analyze.ts` (`pinchedAtTorso`,
`faceDistance`); `packages/core/src/field/scatter.ts` (where a min-clearance test would live);
`packages/dungeon/catalog/agent.json` (the bar's source).
