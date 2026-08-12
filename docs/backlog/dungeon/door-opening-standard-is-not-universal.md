# The door-opening standard is not universal — two door heights ship (3.0 grid vs 2.8 collar)

**Context.** Surfaced at the W4 sweep. `docs/reference/dungeon-architecture.md` records the
grid door standard as **2.0 w × 3.0 h m** (`themes/grid-stamp.ts` — `DOOR_W_CELLS = 4`,
`DOOR_H_CELLS = 6`, at `CELL = 0.5`). But the ORGANIC collar still presents **2.0 × 2.8**
(`themes/cave.ts` — `DOOR_OPENING = { width: 2, height: 2.8 }`).

So two door heights ship, and a collar-bore connector joins a 3.0 m grid door to a 2.8 m
collar door. The widths agree (2.0); only the heights diverge. The 3.3 charter's rationale
sentence reads as if the 2.8 door were retired — **it is not**.

The world walks (7 GPU lanes green), so this is a **standards/reality gap, not a known
break**. But the claim "the door-class portal every connector joins" is currently false, and
a standard that two generators spell differently is a standard in name only.

**Trigger to revisit:** the field charter, or any pass unifying the built↔organic portal
contract (at which point pick one height and delete the other spelling).

**Reference:** `packages/dungeon/src/themes/grid-stamp.ts` (gone) (`DOOR_W_CELLS`, `DOOR_H_CELLS`),
`packages/dungeon/src/themes/cave.ts` (gone) (`DOOR_OPENING`, applied by `mouthCollar`),
`packages/dungeon/src/built.ts` (gone) (`mouthCollar`), `docs/reference/dungeon-architecture.md`
(where the grid standard is recorded).
