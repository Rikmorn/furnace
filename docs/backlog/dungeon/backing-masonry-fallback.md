# Backing masonry behind proud panels (the D-W2-1 fallback)

**Context.** W2's wall render model is **proud panels + reveals** (D-W2-1, user-picked over
`backing` and `flush`): each kit panel sits `PANEL_PROUD` = 0.06 m proud of the collision plane,
and the gaps between panels deepen into deliberate shadowed "mortar" reveals. **Nothing renders
behind the panels** — there is no backing masonry slab.

No-void is guaranteed instead by the **E2 patch mechanism**: when a carve breaches a wall,
`prepareCarve` returns the Surface-Nets patch AND the box it meshed, and the same object drives
render suppression, so a suppressed panel is always backed by patch geometry (the shared-box
property test in `tests/substrate-carve.test.ts` is the teeth). That is a structural guarantee,
not a visual one — it holds for carved openings, which is where a void would otherwise show.

The risk it does NOT cover is a **grazing view angle through a reveal gap** on an uncarved wall,
where a player might see past a panel edge into nothing. The reveals are only 0.02 m per side, so
this is expected to be invisible in play — but it was accepted as a *bet*, with backing masonry
recorded as the fallback if the bet is wrong.

**Trigger to revisit.** A **void flash sighted in play** — any report or screenshot of seeing
"through" a wall at a panel gap / reveal / carve rim. Then the fix is to stamp a backing slab
(a full-cell masonry box) behind each panel run, at the cost of instance count.

**Reference.** `packages/dungeon/src/substrate/skin.ts` (gone) (panel emission, `PANEL_PROUD` offset);
`packages/dungeon/src/substrate/pieces.ts` (gone) (`PANEL_PROUD`, `PANEL_REVEAL`);
`packages/dungeon/src/substrate/carve.ts` (gone) (the E2 patch + shared box); spec decision D-W2-1.
