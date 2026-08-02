# Palette default positions should be rules, not numbers

`PALETTES[id].default` holds literal `{x, y}` pairs, and F4.5c Task 11 added a literal
`maxHeight` beside them. Those numbers are proven pairwise non-overlapping at the
**1280×800 design floor** — and only there. On any larger display the arrangement is the
floor arrangement, drawn in the corner of a bigger canvas.

The visible cost is the extent cap. `entities` and `log` stop at **320 px** (~10 rows) and
scroll, on every viewport. On a 1440 px-tall display they could show 25+ rows, and there is
no resize affordance to escape it. The cap is not decoration: it is what mathematically pays
gate rider **R21** (`entities` bottom 24+320 = 344 ≤ `flags` origin 380). Removing it
unpays R21 at *every* viewport, because `entities`' height is content-driven and its only
other ceiling is `calc(100% − 24px)` = 706 at the floor — so it can reach any `flags` y.

## Context

F4.5c escalated the cap's reach as a UX call. The ruling was **viewport-proportional**;
executing it revealed the change is a slice, not a commit, and the unconditional cap shipped
unchanged pending this entry.

Two facts make the small version impossible:

1. **`defaultWorkspace()` has no production caller that knows the cell.** All three creators
   (`useWorkspace.tsx` mount, restore, reset) live inside `WorkspaceProvider`, which
   `Shell.tsx` renders **seven levels above** the element that defines the cell. A
   `defaultWorkspace(cell = DESIGN_FLOOR_CELL)` parameter would therefore take the floor on
   every real path and be exercised only by tests.
2. **Scaling the extent over a floor-pinned `flags` y reintroduces the collision**, because
   `flags.default.y` is a static 380. Computed at the floor share of the usable column:

   | cell height | entities extent | entities bottom | derived flags y | vs. static 380 |
   |---|---|---|---|---|
   | 730 (floor) | 320 | 344 | 380 | exact |
   | 900 | 401 | 425 | 461 | **collides** |
   | 1100 | 497 | 521 | 557 | **collides** |
   | 1400 | 640 | 664 | 700 | **collides** |

   It breaks at **h = 900** — a full-screen 1080p window — i.e. strictly worse than the
   unconditional cap it would replace.

## The three shapes, and which one this entry is for

- **(A) The provider learns the cell.** A `setCell` action the layer calls on measure, plus
  `deserializeWorkspace(raw, cell)`. Needs a **fourth flag** beside `touched` / `restored` /
  `clearOnArrival` — "what is on screen is the computed default, neither the user's nor the
  disk's" — because `touched` is also false after a restore, so re-deriving then would
  destroy a saved arrangement. Four interacting flags in a load-bearing path.
- **(B) Positions become unplaced-until-placed.** `PaletteState.x/y: number | null`. A
  palette the user has never moved has *no* position; the layer computes it from the cell
  every render. **This is the shape this entry is for.** A default becomes a rule rather than
  a number, and the fresh-vs-saved question answers itself — a number means placed, `null`
  means derived, and no flag is required. It also makes the computed default true everywhere
  including reset and resize, which (A) does not.
- **(C) Cap growth by the neighbour**, layer-side only (`extent = min(proportional(cell),
  flagsY − 24 − GUTTER)`). Zero provider change, zero persisted change, exact at the floor —
  but it only helps where the user *made* room, and does nothing for the headline case of a
  fresh workspace on a tall display. Rejected as looking like compliance without being it.

**(B)'s cost:** it changes the **persisted shape** and `isPaletteState`. Old blobs migrate
benignly (a number means placed). It also redefines `deserializeWorkspace`'s handling of "a
blob written before this palette existed gets its default".

Note the definition of "fresh" this needs: it must outlive a **no-blob restore**. After first
boot with a store, `restored.current` is true even for a user who has never saved anything,
so fresh cannot be spelled `!touched && !restored`. That is exactly the fourth flag (A)
needs and exactly what (B) makes unnecessary.

## Trigger to revisit

Either of:

- **The F4.5 holistic gate complains about the cap** — the rider is on the Task 17 pack
  ("Entities and Messages stop at ~10 rows and scroll; does that read as intentional or as a
  bug?"). A complaint there is this entry becoming actionable with evidence.
- **Resizable palettes are wanted.** They are the honest fix for "10 rows is not enough",
  and they need the same unplaced-until-placed model — a palette whose size the user has set
  is placed in exactly the sense (B) means. Doing them without this entry would build the
  model twice.

If neither fires, the cap is defensible: it is proven, unconditional, and the arrangement it
protects is the one a 1280-wide window actually gets.

## Reference

- `packages/editor/src/frontend/lib/palette-store.ts` — `PALETTES`, `DESIGN_FLOOR_CELL`,
  `cellBounds`, `clampToCell`, and the `maxHeight` field's own docblock, which concedes the
  unconditional reach.
- `packages/editor/tests/palette-store.test.ts` — the pairwise non-overlap check.
  `separation()` returns a *kind* (`declared` / `columns` / `extent`), so the tests pin **why**
  each rider is paid; the `extent` proofs are the ones this entry would change.
- `packages/editor/src/frontend/hooks/useWorkspace.tsx` — the three workspace creators and the
  `touched` / `restored` / `clearOnArrival` flags.
- `packages/editor/src/frontend/components/shell/PaletteLayer.tsx` — `useCellSize`, the only
  place that knows the cell.
