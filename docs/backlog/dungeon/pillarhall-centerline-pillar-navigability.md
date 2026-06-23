# Dungeon: pillarHall can place a pillar on the door→far-wall centerline

**Context.** Slice 2.2.2 Task 8 added a headless cave→vestibule→room walk-probe
(`packages/dungeon/tests/area-traversal.gpu.test.ts`). It drives the `CharacterMover`
straight from the cave hub, through a tunnel mouth, across the cave↔room seam, and into
the room for 400 ticks. The committed test walks the `walk-1` +X branch and passes
cleanly (clean seam after the Task 8 cave/door geometry fixes; the +X room's far wall is
reached only at the very end of the 400-tick walk, a <45-tick terminal stall).

**Finding (surfaced, NOT fixed in Task 8 — out of scope).** Sweeping the same walk over
other branches/seeds (`walk-1` +Z, `area-1`, `seedB`, `dungeon-7`) shows the walk wedges
*inside the room* before reaching the far wall. Root cause: `pillarHall`'s `pillarGrid`
(`packages/dungeon/src/themes/box-room.ts`) culls pillars only inside the **door-side**
walk corridor (`Math.abs(x) < corridorHalf && z < 0` in the generation frame). A
straight-through path from the door to the *far* wall can still hit a pillar sitting on
the centerline deep in the room (e.g. `walk-1` +Z room has a pillar at local-frame
centerline ~17m in). A player walking dead-straight stalls against it. This is a
**room-interior navigability** concern (the pillar layout), distinct from the cave↔room
**seam** Task 8 was scoped to, so it was surfaced rather than fixed.

**Trigger to revisit.** When hardening the walk-probe into a multi-branch / multi-seed
fuzz gate (cf. `traversal.gpu.test.ts`'s lane fuzz), or when the room generator gets a
navigability pass. Either widen the corridor cull to the full door→far-wall lane (cull
`Math.abs(x) < corridorHalf` for all z, not just `z < 0`), or have the walk-probe weave
around pillars instead of walking dead-straight. Until then, keep the committed probe on
the known-clean `walk-1` +X seam.

**Reference.** `packages/dungeon/src/themes/box-room.ts` (`pillarGrid`),
`packages/dungeon/tests/area-traversal.gpu.test.ts`.
