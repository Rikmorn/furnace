# The default palette arrangement does not scale with the cell

`PALETTES[id].default` holds literal `{x, y}` pairs and `PALETTES[id].width` / `.maxHeight`
hold literal sizes. They are proven pairwise non-overlapping at the **1280×800 design floor**
(`DESIGN_FLOOR_CELL`) — and only there. On any larger display the shipped arrangement is the
floor arrangement, drawn in the corner of a bigger canvas: five palettes clustered top-left
across 960 px of a 2560 px cell, with `entities` and `log` starting at ~10 rows.

## What resizable palettes already settled, and what they did not

This is the surviving half of an entry retired when the F4.5 gate ruled for resizable
palettes (its own second trigger, "resizable palettes are wanted", is what fired). No path is
cited for it because it is deleted, per the house rule for retiring an entry — everything of
it that is still true is restated here. That mechanism discharged the part that was about
being **stuck**:

- The declared extent is no longer a ceiling. A user-set height replaces it outright
  (`paletteBox`), so a palette capped at ten rows can be dragged past it. That claim was
  false for three of the four list palettes as first shipped — `log`, `history` and `flags`
  each capped their own list *inside* the palette with a `max-h-64`, which `paletteBox`
  cannot see and a resize therefore cannot drop — and the fix round moved all three
  ceilings into `PALETTES[id].maxHeight`, which is the only home an extent has.
- Size is now unplaced-until-placed — `PaletteState.width/height` absent means "never
  resized". The old entry's shape (B) is therefore **already built, for size**, and its
  claim that doing resize without it would build the model twice is discharged.

What is left is the part that was about the **default**, and resize does not touch it: a
fresh workspace, on a first run, on a tall display, still opens as the floor arrangement.
Every user pays a drag per palette to get the arrangement their screen could have had.

## Why the small version is still impossible

Both facts from the retired entry still hold, and both are why this is a slice rather than a
commit:

1. **`defaultWorkspace()` has no production caller that knows the cell.** All three creators
   (`useWorkspace.tsx` mount, restore, reset) live inside `WorkspaceProvider`, which
   `Shell.tsx` renders seven levels above the element that defines the cell
   (`PaletteLayer`'s `useCellSize` is still the only thing that measures it). A
   `defaultWorkspace(cell = DESIGN_FLOOR_CELL)` parameter would take the floor on every real
   path and be exercised only by tests.
2. **Scaling one figure over floor-pinned neighbours reintroduces the collision.** Growing
   `entities`' extent proportionally while `flags.default.y` stays a static 380 collides at
   **h = 900** — a full-screen 1080p window, i.e. strictly worse than the unconditional
   default it would replace. Positions and extents have to move together or not at all.

The shape this wants is the retired entry's (B) applied to POSITION as well: `x`/`y` become
`number | null`, a `null` is derived from the cell at render, and no fourth
`touched`/`restored`/`clearOnArrival` flag is needed because a number already means "placed".
Size proves the model works; position is the remaining half of it.

**Trigger to revisit:** either of —

- **A sixth palette.** Three columns are full at the design floor, so a sixth has to either
  invent a second extent budget for a second stack or force the arrangement to become
  cell-relative. That is the moment rules pay for themselves, and it is checkable: a new id in
  `PALETTE_IDS` that cannot find a column in `tests/palette-store.test.ts`'s pairwise case.
- **The first-run arrangement is complained about with the handles already shipped.** The
  retired entry's trigger fired on the cap, and the cap is gone; a complaint that survives a
  visible resize affordance is about the DEFAULT, which is this entry.

**Reference:**

- `packages/editor/src/frontend/lib/palette-store.ts` — `PALETTES`, `DESIGN_FLOOR_CELL`,
  `paletteBox` (the declared-vs-user reconciliation this entry would extend to position),
  `cellBounds`, `clampToCell`.
- `packages/editor/tests/palette-store.test.ts` — the pairwise non-overlap check.
  `separation()` returns a *kind* (`declared` / `columns` / `extent`), so the tests pin **why**
  each rider is paid; a cell-relative arrangement changes what those proofs are computed from.
- `packages/editor/src/frontend/hooks/useWorkspace.tsx` — the three workspace creators and the
  `touched` / `restored` / `clearOnArrival` flags.
- `docs/reference/editor-architecture.md` §palette layer — the as-built three columns and the
  resize mechanism this entry is the remainder of.
