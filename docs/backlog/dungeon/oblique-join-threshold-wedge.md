# Dungeon: oblique door joins leave a sub-capsule threshold wedge at one jamb corner

**Context.** The placer's yaw-jittered candidates let a connector meet a door portal up
to ~60° off the wall normal (`layout.ts FACING_MIN`). At an oblique join, the room
floor's inner edge recedes diagonally behind the portal plane while the connector
floor's `SEAM_OVERLAP` apron reaches only 0.6 m along the CONNECTOR axis — leaving a
small uncovered floor wedge at one jamb corner of the doorway threshold. Observed in
the 2.2.5b-A seam sweep on the `landing→hallA` closing corridor (54° off-normal join,
pillarHall `wallThick` 0.4): a ~0.1–0.2 m wedge at one lateral edge of the door.

**Why it's deferred, not fixed.** Sub-capsule scale — the character capsule (r 0.3)
rim-rides it; `tests/world-seams.test.ts` guards the world against CAPSULE-scale holes
(unsupported discs ≥ `HOLE_R`) and tolerates slivers like this by design. The wedge is
a cosmetic/robustness blemish, not a fall hazard.

**Trigger to revisit.** Slice 2.2.5b Phase B's built-interface work (cave mouth
structures / door thresholds): a threshold plate — a flat slab at portal level spanning
the door width × the wall thickness, emitted at every `door`-end join (by the connector
or the room) — kills this whole wedge class regardless of join angle, and is a natural
sibling of the mouth-structure pieces. Fold it in there rather than patching apron
reach per-angle.

**Reference.** `packages/dungeon/src/connect.ts` (`floorBoxes` — corridor/ramp
`SEAM_OVERLAP` aprons + the stair end aprons added post-gate in 2.2.5b-A),
`packages/dungeon/tests/world-seams.test.ts` (the sweep that surfaced and now tolerates
it). Surfaced 2026-07-03 while diagnosing the 2.2.5b-A gate fall-through.
