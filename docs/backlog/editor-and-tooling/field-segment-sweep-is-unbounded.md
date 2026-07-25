# The segment brush is the first editor gesture with unbounded op extent

**Context.** Every other field gesture is bounded by construction: a stroke's sphere is
`digRadius` (clamped `[0.25, 4]` m), a kit fill is the snapped box around it, a flood is
capped by `SELECTION_UI_BUDGET = 200_000` cells. The segment brush (F3b, D-F3-14) is not.
Each of its two clicks is individually bounded by `DIG_RANGE_M = 30`, but the WASD fly
camera stays live between them, so the sweep length is whatever the user walks — and the
op's cost is linear in that length. No clamp ships, deliberately: nobody has yet flown a
tunnel long enough to be unhappy, and the F4 tool-feel pass is where that judgement
belongs. What this entry buys is the measurement, taken now while the code is warm.

**Measured** (bun/JSC, M1, `DEFAULT_CELL_SIZE` 0.25 m, dig capsule on a virgin store,
one `applyOp`). Taken twice — by the F3b reviewer and again by the implementer before
filing. The chunk and byte columns agreed **exactly**; the millisecond column is the
implementer's (slower) run, and the two differed by 10–30%, which is the run-to-run
spread to expect rather than a disagreement:

| sweep | radius | `applyOp` | dirty chunks | density resident |
|---|---|---|---|---|
| 4 m | 0.75 | 4.4 ms | 12 | 0.05 MB |
| 60 m | 4 | 113 ms | 304 | 1.25 MB |
| 200 m | 4 | 132 ms | 864 | 3.54 MB |
| 500 m | 4 | 323 ms | 2064 | 8.45 MB |

**Reading it.** The 60 m row needs no flying at all: two clicks 30 m out in opposite
directions reach it, so it is inside the gesture's own reach. The synchronous cost of a
commit is that `applyOp` plus an undo snapshot of the same chunk set — a ~100 ms hitch at
the reachable end, ~320 ms at the walked end. The REMESH is not synchronous:
`REMESH_PER_FRAME = 2` drains the dirty set at two chunks a frame, so 304 chunks is
~2.5 s of progressive re-meshing at 60 fps and 2064 is ~17 s. That degrades rather than
freezes, which is why this is a premise to record and not a bug to fix.

**If F4 wants a cap:** a `SEGMENT_MAX_LENGTH_M` checked in `segmentClick` before the
commit, refusing through `reportToolError` (the precedent every other tool-problem path
already uses), is ~4 lines. The precedent for capping a gesture rather than the primitive
is `SELECTION_UI_BUDGET`. **Do not build it on the strength of this entry alone** — pick
the number from a feel round, not from the table above.

**Trigger to revisit:** the F4 tool-feel pass, or the first report of a hitch or a
minutes-long remesh after a long segment. Also fires if F5's streaming work changes what
"resident density" costs, since the last column is the part that scales worst.

**Reference:** `segmentClick` + `DIG_RANGE_M` + `REMESH_PER_FRAME` in
`packages/editor/src/viewport-host/field-host.ts`; `opBounds`/`opSampleBounds` in
`packages/core/src/field/ops.ts` (the cost is linear in the bounds volume);
`field-segment-box-cross-section.md` (the other half of D-F3-14).
