---
summary: the editor's load-time compaction threshold (COMPACT_THRESHOLD_OPS) was derived under single-author logs; origin boundaries now starve folds and nobody re-derived it
---

# COMPACT_THRESHOLD_OPS has not been re-derived for mixed authorship

**Context.** `field-world.ts` compacts at world load when `logStats(...).compactableOps`
clears `COMPACT_THRESHOLD_OPS` (200 at the time of filing — read the constant, don't
trust this line). Since the undo-attribution slice (sealed 2026-08-14), `eligibleRuns`
closes a run at every origin boundary, so an interleaved human/agent log yields smaller
runs — some starved below the fold minimum — and `compactableOps` shrinks for the same
op count. The editor then compacts LESS often, which is correct behaviour, but the 200
was derived under single-author assumptions and is now load-bearing under two: nobody
has asked what the right threshold is once agent authoring is routine and logs
interleave authors.

**Trigger to revisit:** the first world whose load-time compaction visibly stops firing
after agent sessions (log length grows past what pre-attribution worlds compacted at);
or F5 "scale" work re-examines log-size economics anyway.

**Reference:** `COMPACT_THRESHOLD_OPS` in `field-world.ts`; `eligibleRuns` in
`packages/core/src/field/maintenance.ts` (the origin-boundary clause and its
starvation pin in `maintenance.test.ts`).
