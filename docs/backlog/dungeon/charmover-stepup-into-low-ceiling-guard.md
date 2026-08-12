---
summary: CharacterMover commits to a step-up without checking headroom, so a tight ceiling produces a climb-and-fall wedge
---

# CharacterMover step-up into a low ceiling — headroom guard

## Context

Surfaced by the Slice 2.2.2 off-axis cave-tunnel wedge at the shipping `TUNNEL_R = 1.6`
(`themes/cave.ts`). Walking more than ~0.75 m off the +Z tunnel axis, the player capsule
wedges: a representative lane at x = 11 stalls at z ≈ 5.67 (maxStall = 176, zero forward
progress). In the narrowing round voxel bore the air-floor curves up while the ceiling drops,
so `CharacterMover`'s step-up pass fires into the descending curved ceiling — a raised position
with no headroom. The step-up heuristic **commits to the raised height** whenever the raised
slide makes more horizontal progress than the flat slide; it never checks that the raised
capsule actually fits. The downward ground-ray in `applyGravity` then probes
`reach = footOffset + GROUND_SNAP` below the raised position, which can be out of reach of the
real floor below → the capsule is left floating, falls, and re-attempts the step-up next tick:
a climb-and-fall oscillation that makes no forward progress (a wedge).

This is a **generic** char-move fragility, not specific to the cave theme — any
tight-ceiling-over-walkable-floor spot (low arches, narrowing bores, sloped tunnels) can
reproduce it. Two related levers:

- **(a) A char-move headroom guard.** Reject a step-up whose raised position has no headroom —
  e.g. an upward shapecast (or the rest-sweep already in `applyGravity` returning `toi ≈ 0`
  with a non-floor / horizontal normal) signals the raised capsule is buried in the ceiling.
  On no-headroom, fall back to the flat slide instead of committing to the raised height. This
  is the robust, theme-agnostic fix.
- **(b) Wider walkable through-passage at the geometry layer.** The wedge band is narrow partly
  because the bore narrows AND the mouth necks into the room's door, so the funnel is only a
  fraction of the tunnel bore. Widening only the tunnel bore (`TUNNEL_R`) does **not** open the
  through-passage — the door caps it. Tunnel-bore radius + matching door width have to move
  together. *(The 1.6 m-wide `box-room.ts` door that originally capped this funnel retired with
  the mesh room generators at the W4 sweep; the live door standard is `themes/grid-stamp.ts`'s
  `DOOR_W_CELLS` = 4 cells = 2.0 m, and `DoorSpec` now lives in `substrate/skin.ts`. The lever
  is unchanged — the numbers moved.)*

The shipped 2.2.2 cave is walkable through its **designed** band (the `traversal.gpu.test.ts`
cave-hub fuzz sweeps every lane in x[9.25,10.75] and passes); this entry tracks the underlying
heuristic, not a gate blocker.

## Trigger to revisit

When another theme produces a tight-ceiling-over-walkable-floor spot that wedges the player, OR
during the collide-and-slide / Jolt `CharacterVirtual` backend work (the documented endgame for
voxel-curve slide quality — see `docs/backlog/engine-architecture/jolt-backend-swap.md`), at
which point the step-up/ground-pass heuristics should be revisited together with the new
collider backend.

## Reference

- `packages/dungeon/src/agent/char-move.ts` — the step-up pass (`resolve`, `STALL_GAIN` step-up
  branch) and the downward-ray ground pass (`applyGravity`, `GROUND_SNAP`, `STEP_HEIGHT`,
  `footOffset`).
- `packages/dungeon/src/themes/cave.ts` (gone) — `TUNNEL_R` and the round-bore `capsuleCavern` tunnel
  whose narrowing produced the wedge.
- Sibling deferral: `docs/backlog/dungeon/traversal-verbs-on-character-mover.md`.
- The wedge corpus this class belongs to is `docs/reference/dungeon-architecture.md` §3
  "The walkability analyzer" (absorbed there at F4; the mouth/door-geometry entry it
  originally cited retired at the W4 sweep).
