# Richer rim-collar case set (corners, diagonals, opening-sized collars)

**Context.** W2 ships the **2-piece rim collar** (E3): at every suppressed↔kept panel junction,
`packages/dungeon/src/substrate/collar.ts` emits one piece from the SUPPRESSED side — `rimPostV`
for a vertical junction edge, `rimEdgeH` for a horizontal one — so a carved opening reads as a
deliberately framed cut rather than a ragged hole. The floor-rim path (a suppressed +Y face) is
exercised by test, and the piece-type dispatch is pinned by a regression test.

Two pieces is the minimum that reads as "built edge". It does NOT handle:
- **corners / diagonals** — where two collar runs meet, the two boxes simply abut (no mitred or
  corner piece), which is visible at a carve's rectangle-ish corners;
- **opening-sized collars** — a large bore gets N small pieces rather than one arch/lintel scaled
  to the opening, so a big cut reads as beading rather than architecture.

**Trigger to revisit.** The visual polish pass (3.4 / 3.5) — the first time the collar is judged
as *architecture* rather than as "the hole is framed, not ragged". Pairs naturally with
`kit-material-atlas.md` (both are look-not-structure work on the same kit).

**Reference.** `packages/dungeon/src/substrate/collar.ts` (`collarInstances`, `inPlaneSteps`);
`packages/dungeon/src/substrate/pieces.ts` (`rimPostV` / `rimEdgeH` / `COLLAR_SECTION`); spec §2
(collar), decision E3.
