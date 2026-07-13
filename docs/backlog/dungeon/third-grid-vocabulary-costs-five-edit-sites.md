# A third grid vocabulary costs five edit sites, three of them pure TypeScript tax

**Context:** Surfaced in the W3 holistic review. W3's central claim — "hall and maze share ONE
pipeline" — holds SEMANTICALLY. There is no maze-specific logic anywhere downstream of the stamp:
`expandGridRegion`, the connectors, the skin, the collar, the carve, and the collider are all
vocabulary-agnostic, and even the per-vocabulary dressing is a stamp FIELD (`GridStamp.dressingLayers`)
rather than a dispatch. Nothing in the finalize path asks "am I a maze?".

But adding vocabulary #3 must still touch FIVE sites, and only two of them are the declared plug point:

1. `generateRegion`'s stamp dispatch (`world-build.ts`) — the DECLARED plug point.
2. `expandGridRegionFromEntry`'s stamp dispatch (`world-build.ts`) — the DECLARED plug point (the
   loader's re-expansion must construct the same stamp bake did).
3. `resolveSpec`'s `region.algorithm === "hall" ? X : X` ternary (`world-build.ts`) — whose two
   branches are BYTE-IDENTICAL.
4. `bakeWorld`'s per-algorithm object literal (`bake.ts`) — whose branches differ only in the
   `algorithm` string literal they write.
5. `assertCompatible`'s string allow-list (`world-loader.ts`) — `algorithm !== "cave" && !== "hall"
   && !== "maze"`.

Sites (3) and (4) exist ONLY to keep TypeScript's correlated-union inference happy through a spread:
a single `{ ...region }` over the `hall | maze` union decorrelates `algorithm` from `params`, so both
files hand-write per-algorithm branches whose bodies are otherwise the same code. They are a real
maintainability tax and they are INVISIBLE to whoever adds vocabulary #3 — nothing points at them, and
each already carries an apologetic comment explaining why it exists.

Possible fix: a single `stampFor(algorithm, params, seed)` dispatcher that every site shares, so the
union is narrowed in exactly one place. Note this is a leak in the TYPE PLUMBING, not in the pipeline
claim — the fix is a refactor of how the discriminated union is threaded, not a change to the
generation model.

**Trigger to revisit:** When a third grid vocabulary lands, OR at the field-charter brainstorm — the
one-field direction turns stampers into brushes, which changes the plug-point shape these five sites
serve (docs/research/2026-07-13-one-field-direction.md §6).

**Reference:** `packages/dungeon/src/world-build.ts` (`generateRegion`, `expandGridRegionFromEntry`,
`resolveSpec`), `packages/dungeon/src/bake.ts` (`bakeWorld`'s grid-region branch),
`packages/dungeon/src/world-loader.ts` (`assertCompatible`). The shared stamp contract itself is
`packages/dungeon/src/themes/grid-stamp.ts` (`GridStamp`). Filed 2026-07-13 from the W3 review.
