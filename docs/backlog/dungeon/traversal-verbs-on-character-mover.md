# Traversal verbs as extension points on `CharacterMover`

**Context.** Slice 2.1.1 built a custom collide-and-slide `CharacterMover`
(`packages/dungeon/src/agent/char-move.ts`) on the core `physics.castRay`/`castShape`
primitives — deliberately as an *extensible* base, not a one-off walk solver. The
go-forward traversal track wants additional movement verbs layered on it over time:
**crouch, jump, mantle, climb, rope, swim**. Each is a later traversal-track slice that
co-evolves with the geometry that demands it (don't build the verb before there's a
room that needs it).

Two concrete forward-considerations surfaced in this slice's reviews, to handle when
the relevant verb lands:

1. **Jump must gate the snap-to-ground on upward velocity.** `applyGravity` currently
   snaps the feet to walkable ground whenever a downward ray finds it within
   `foot + GROUND_SNAP`, unconditionally zeroing `vVel`. When **jump** lands, gate that
   snap on `vVel <= 0` (only snap when not moving up) — otherwise the `GROUND_SNAP`
   reach yanks a rising player straight back to the floor on the first tick and kills
   the jump arc.
2. **Ground detection is a single centre ray → premature edge drop.** Ground is
   detected with one downward ray from the capsule *centre*. A capsule standing just
   past a ledge (centre over the void, but the foot-radius still over solid ground)
   reads "no ground → fall," giving a premature drop at edges. If edge behaviour proves
   bad on generated terrain, revisit with multi-ray / foot-radius sampling (e.g. probe a
   ring at the foot radius and accept ground if any sample hits walkable surface).

**Trigger to revisit.** When the first traversal verb beyond walk is scheduled (a room
or mechanic demands crouch/jump/climb/...), or when edge-of-ledge behaviour on generated
terrain reads bad enough to fix the single-ray ground probe.

**Reference.** `packages/dungeon/src/agent/char-move.ts` (`applyGravity`, `resolve`); Slice
2.1.1 spec/plan (local design scaffolding); memory `project_dungeon_epic2_procgen`.
