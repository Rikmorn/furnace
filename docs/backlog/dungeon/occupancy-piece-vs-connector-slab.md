# Dungeon: `Occupancy.checkPieceEnvelope` doesn't test a new piece against committed connector floor slabs

**Context.** `packages/dungeon/src/occupancy.ts` `Occupancy.checkPieceEnvelope` — the check run
against a CANDIDATE piece's envelope before it's accepted — tests it against placed pieces'
envelopes (rule "envelope-envelope") and against committed connectors' reserved-air `boxes`
(rule "envelope-clearance"). It does **not** test the candidate against committed connectors'
`slabSolids` (a connector's floor slab, or ramp/stair boxes, promoted to a solid obstacle for
LATER clearance checks via `checkClearance`'s `clearance-slab` rule). So a new piece that
nestles entirely **below** a connector's clearance-air box while still overlapping that
connector's thin floor slab would slip through `checkPieceEnvelope` uncaught — the slab is only
ever checked against other *clearances*, never against a *piece envelope*.

This is a real gap in the rule table (5 acceptance rules were designed, but "piece vs.
committed-connector solid" isn't one of them — only "piece vs. committed-connector air" is).
It is narrow and **currently unreachable**: nothing in the Slice 2.2.5a proof graph
(`world.ts`) stacks a room underneath a connector's floor — rooms sit beside/below/above
connectors by full clearance margins, never wedged directly under a thin slab.

**Trigger to revisit.** Slice 2.2.5b's *generated* graphs, or any hand-composed world that
places a piece stacked directly under a connector (e.g. a room tucked beneath a ramp or
stair-run) — at that point add a 6th `checkPieceEnvelope` rule (candidate envelope vs. every
committed clearance's `slabSolids`), symmetric with the existing piece-vs-clearance-air rule.

**Reference.** `packages/dungeon/src/occupancy.ts` (`checkPieceEnvelope`, `ClearanceEntry.slabSolids`,
`checkClearance`'s `clearance-slab` rule — the asymmetry this entry tracks).
Surfaced + verified during the Slice 2.2.5a `occupancy.ts` rule-table review (2026-07-02).
