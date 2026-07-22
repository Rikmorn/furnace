# field reconfigure: a flood-masked downstream op replays against end-of-log state

**Context.** `reconfigureGenerator` (`packages/core/src/field/reconfigure.ts`) culls
replay to an affected chunk set — the old span's chunks ∪ the new evaluation's, closed
transitively over downstream ops that intersect it. Only those chunks are rewound to
their pre-span state; every other chunk keeps its END-OF-LOG bytes. That is exact as
long as a replayed op READS only inside its own bounded influence, which holds for all
four brush effects, class-kind masks, region selections and patch ops (independently
verified at the Task 3 spec review, 2026-07-22).

A **flood** selection mask breaks it. `SelectionSpec` `flood-material` / `flood-void`
BFS outward from a seed and are unbounded by construction, so the op's read set is not
its write set. `readsOutsideItsWrites` handles this conservatively — such an op always
joins the affected set, so it is always replayed, and it is reported whenever its output
differs from the PRE-RECONFIGURE bytes (the drift baseline is old-final, not
from-scratch, so "loud in practice" rather than loud by construction) — but that only
covers its WRITES. The flood itself still traverses chunks that were never rewound, and
those chunks hold state produced by ops that originally ran AFTER it. The flood replays
against a future it never saw.

Reproduced (cellSize 0.25, verified 2026-07-22):

- two disconnected dirt rails at `y = z = 10 m` (chunk `cy = cz = 2`, clear of the
  stamp): left `x ∈ [0, 8]`, right `x ∈ [12.5, 28]`
- a hall committed at `[0, 0, 0]`
- op A (after the stamp) = `paint` → rock over `x ∈ [20, 28]`, masked
  `flood-material { seed: [8, 40, 40], classId: 1 }` — paints nothing, because the rails
  are disconnected
- op B (after A) = a bridge `fill` of dirt over `x ∈ [7, 14]`, whose chunks
  (`1..3, 2, 2`) are disjoint from both A's (`4..7, 2, 2`) and the stamp's

Reconfigure the hall 8 → 12. B is correctly NOT absorbed, so its bytes persist; A is
absorbed and replays, its flood now crosses the bridge and paints the right rail.
Right-rail material: `before = 1`, `afterReconfigure = 0`, `fromScratch = 1`. A is
reported as `drifted`, so the divergence is loud — but the report cannot say the new
output is itself wrong.

The mechanical fix is to force the affected set to the whole store as soon as any
downstream op reads unboundedly (or to bound a flood's read set at record time and
intersect that). Both are design decisions with real cost — the first throws away
culling for any log containing one flood-masked op, which is the exact cost D-F3-3
exists to avoid — so this belongs to a planning session, not to executor discretion.
The gap is documented honestly in `reconfigureGenerator`'s TSDoc and in
`docs/reference/core-modules.md` until then.

**Trigger to revisit:** the first flood-masked op that survives into a saved world
alongside a reconfigurable entity (the editor's flood-select tool makes this reachable
the moment a user selects-then-paints and later reopens a stamp), or any F3b/F4 work
that widens `readsOutsideItsWrites`' input set — a generator emitting flood-masked ops
would make `directlyAffected` under-approximate the OLD span's reads the same way.

**Reference:** `docs/reference/core-modules.md` §`@furnace/core/field` (Smart objects —
reconfigure, "Known gap (flood reads)"); `packages/core/src/field/reconfigure.ts`
(`readsOutsideItsWrites`, `closeOverDownstream`, `restorePreState`);
`packages/core/src/field/selection.ts` (`materializeSelection`).
