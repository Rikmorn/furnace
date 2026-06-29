# Dungeon: `connect.ts route` emits an empty connector for a descending stair-run

**Context.** Slice 2.2.4 added `connect.ts route(from, to, opts?)` — the constraint-checked
connector router (corridor / ramp / stairs, walkable by construction). The stairs branch of
`buildConnectorLocal` passes the *signed* height delta `dh` straight to
`box-room.ts stepBoxes(top, frontZ, width, treadDepth)`, exactly as the slice spec dictated.
`stepBoxes` computes `n = Math.ceil(top / (STEP_HEIGHT - STEP_MARGIN))`; for a **descending**
route (`to` lower than `from`, so `dh < 0`) `n` goes negative and the step loop emits **zero
boxes** — a silently empty, unwalkable connector. The ramp branch is fine for descents (the
pitch math is symmetric); only the stairs branch has this gap.

A sibling case in the **ramp** branch shares the same root: the setup-loud slope-limit guard
tests the *signed* `pitch = atan2(dh, run)` against `SLOPE_LIMIT_RAD - RAMP_MARGIN`, so a
*forced* steep **descending** ramp (`opts.kind = "ramp"`, `dh < 0`, large `|dh|`) has a large
*negative* pitch, the `pitch > limit` test is false, and it silently builds an unwalkable
steep down-ramp instead of throwing. A `Math.abs(pitch)` in the guard closes it (the geometry
math below the guard must keep the *signed* `pitch` so the slab still tilts the right way for a
genuine gentle descent). The auto path is unaffected — `chooseKind` already uses `|dh|` and
routes steep descents to stairs — so this is reachable only via the forced-kind escape hatch.

This does **not** affect Slice 2.2.4: every `route` call in the shipped composition is
ascending or flat — Task 7 cave→room corridors are coplanar (`dh ≈ 0` → corridor), and the
Task 9 multi-level climbs are always built `from`-low → `to`-high (`dh > 0`). Neither a
descending stair-run nor a forced descending ramp is exercised, and the slice's GPU walks all
pass. It is a latent robustness gap, not a current bug.

**Trigger to revisit.** When `route` is wired into the generated world graph (Slice 2.2.5),
where edge direction is no longer hand-controlled and a stair connector may be requested
high→low. At that point decide the descending-stairs representation:
- Build the stairs from the high side and pass `|dh|` (the steps are geometrically the same;
  only the walking direction differs — a descent down the same stack), OR
- Normalize `route` to always build low→high internally and let `placePiece` orient it, OR
- Have `route` swap `from`/`to` when `dh < 0` for the stairs kind and document that connectors
  are direction-agnostic.

And symmetrize the ramp guard with `Math.abs(pitch)` so a forced steep descending ramp throws
setup-loud too (keep the geometry below the guard on signed `pitch`).

Whichever is chosen, add GPU walk tests that *descend* a routed stair-run AND a routed ramp
(the current `connect.gpu.test.ts` only climbs). Until then, a forced descending
`route(..., {kind:"stairs"})` should arguably throw setup-loud rather than return an empty
connector — consider that as the minimal guard if 2.2.5 slips.

**Reference.** `packages/dungeon/src/connect.ts` (`buildConnectorLocal` stairs + ramp branches —
the stairs `dh→stepBoxes` empty-loop and the ramp `pitch > limit` signed guard),
`packages/dungeon/src/themes/box-room.ts` (`stepBoxes`). Surfaced by the Task 4 spec + code
reviews, Slice 2.2.4.
