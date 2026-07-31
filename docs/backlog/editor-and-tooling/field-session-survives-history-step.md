# A live stamp session survives a ⌘Z / ⇧⌘Z step

**Context.** `field-host.stepHistory` refreshes everything a history step can move
— the dirtied chunks, the prop layer, the entity list, the entity selection — but
does not touch the live `stamp` session. A plain reconfigure session (opened by
the Entities row's Open button, or by `openEntity`) therefore outlives a step
that rewrote the log underneath it. Two shapes:

- The step UNDOES the commit the session's entity came from. The session now names
  an entity that is not in the log; Apply fails with core's
  `reconfigureGenerator: unknown entity N` and the session keeps standing.
- The step undoes an earlier RECONFIGURE of a surviving entity. Nothing fails —
  the session simply describes params/region relative to a record the step has
  already replaced, and Apply quietly re-lands an edit the user just undid.

F4.5b Task 5 fixed the MOVE case only (`if (stamp?.moving === true)
cancelStampSession()` in `stepHistory`), because a move is cursor-driven and the
canvas that binds ⌘Z is necessarily focused during one — so it was reachable in a
single keypress and inside that task's scope. The plain-reconfigure exposure is
older and wider.

The blanket case is already argued twice in this file: `resetWorld` and
`setMaterialTable` both cancel outright, on the reasoning that a session whose
inputs moved must not be left offering an Apply that would build something the
ghost never showed. A history step is the same class of event.

**Trigger to revisit.** The next task that touches `stepHistory` or the session
lifecycle — F4.5b Task 8/10 (session card + strip) would surface it, since the
card is what leaves an enabled Apply on screen.

**Reference.** `packages/editor/src/viewport-host/field-host.ts` — `stepHistory`,
`resetWorld`, `setMaterialTable`. Tests for the move half:
`packages/editor/tests/field-host-move.test.ts`.
