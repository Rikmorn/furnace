# The door-width constant is duplicated in the piece box

**Context:** Surfaced in a W3 review. `packages/dungeon/src/substrate/pieces.ts`'s `PIECE_BOX`
hard-codes `2.0` as the door width in two entries — `lintel: [0.1, 0.1, 2.0 + 0.2]` (door width
plus jamb cover) and `tread: [CELL, 0.25, 2.0]` (the stair step spans the door width). But the
REAL door width is `DOOR_W_CELLS * CELL` in `packages/dungeon/src/themes/grid-stamp.ts`
(`DOOR_W_CELLS = 4`, `CELL = 0.5` → 2.0 m today). The two agree by coincidence, not by
construction: change `DOOR_W_CELLS` and the lintel silently stops covering the opening while the
tread stops spanning it — a silent geometry break with no test to catch it.

Deriving the constant is NOT a mechanical fix, which is why this is filed rather than fixed
inline. `themes/` imports from `substrate/` (e.g. `grid-stamp.ts` pulls `CELL` from
`substrate/grid.ts`); having `substrate/pieces.ts` import `DOOR_W_CELLS` back from `themes/` would
invert that layering. So it needs a call on where the door-width constant actually belongs.
Candidates: (a) hoist the door width into `substrate/` (it is arguably a substrate-level
dimension — the kit pieces are built to it), and have `grid-stamp.ts` consume it from there; or
(b) have the skin/kit take the door width as a parameter, so `pieces.ts` carries no opinion about
it at all.

**Trigger to revisit:** BEFORE any change to `DOOR_W_CELLS` (the change is silently wrong without
this), or when a third grid vocabulary lands (a third consumer of the door contract is the point
at which the duplication stops being tolerable — the clean-code "third occurrence" bar).

**Reference:** `packages/dungeon/src/substrate/pieces.ts` (`PIECE_BOX.lintel`, `PIECE_BOX.tread`),
`packages/dungeon/src/themes/grid-stamp.ts` (`DOOR_W_CELLS`, `DOOR_LANE_WIDTH`, `doorAt`).
Compare `docs/backlog/dungeon/grid-dressing-literal-duplication.md` — the same duplication smell in
the dressing layers. Filed 2026-07-13 from the W3 Task 9 review.
