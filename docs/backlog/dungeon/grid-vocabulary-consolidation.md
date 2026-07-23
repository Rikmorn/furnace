# Grid vocabulary consolidation

Tracker for the dungeon grid-vocabulary hygiene findings surfaced in the W3 review:
the five edit sites a third grid vocabulary must touch, two duplicated constants
(door width, dressing literals), and the maze decomposition / carve-plan-seam shape
problems. **They all trigger on the same event — a THIRD grid vocabulary landing, or
the next touch of the stamp layer.** Note: F3b's cave is **NOT** a grid vocabulary
(it is field-native, not a stamp over `substrate/grid`), so it does **not** fire this
trigger — the "third grid vocabulary" event stays unfired until a genuine third GRID
stamp joins `hall` and `maze`. Sections keep their original order.

## A third grid vocabulary costs five edit sites, three of them pure TypeScript tax

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

## The door-width constant is duplicated in the piece box

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
Compare the *Grid dressing material literals are copy-pasted between `maze.ts` and `world-build.ts`*
section below — the same duplication smell in the dressing layers. Filed 2026-07-13 from the W3 Task 9 review.

## Grid dressing material literals are copy-pasted between `maze.ts` and `world-build.ts`

**Context:** Surfaced in the W3 Task 4 review (the maze stamper). `MAZE_DRESSING_LAYERS`'
`mazeRubble` layer in `packages/dungeon/src/themes/maze.ts` copy-pastes the material literal
of `DRESSING_RUBBLE` in `packages/dungeon/src/world-build.ts`: same colour `[0.4, 0.38, 0.34, 1]`,
same specular `[0.03, 0.03, 0.03, 10]`, same `spacing`/`scale`/`tint`. They currently collapse
onto ONE material entry only because `instanceGroupsFromLayers` (`packages/dungeon/src/scatter.ts`)
dedupes materials by `JSON.stringify(spec.material)` and the two literals stringify identically.

That is a latent fork, not a shared constant: edit either literal and the maze silently gains a
SECOND material entry in its per-region table, and the rubble colour diverges between halls and
mazes with nothing failing. `DRESSING_RUBBLE` is a non-exported const in `world-build.ts`, and
`world-build.ts` now imports `maze.ts` (the W3 plug point), so the maze cannot import it back —
that would be a module cycle. The duplication is structural, not laziness.

Proposed fix: move `DRESSING_CRATE` / `DRESSING_RUBBLE` into a shared leaf module
(`packages/dungeon/src/themes/dressing.ts`) that both `world-build.ts` and the stampers import —
a leaf has no cycle. Single source of truth for the dressing palette.

**Trigger to revisit:** The next time either dressing literal is edited (colour/spec/scale tuning
in a dressing pass), or when a third grid vocabulary lands and copies the literal a third time —
whichever comes first. Two occurrences is the tolerate-duplication threshold; a third is not.

**Reference:** `packages/dungeon/src/themes/maze.ts` (`MAZE_DRESSING_LAYERS`),
`packages/dungeon/src/world-build.ts` (`DRESSING_CRATE` / `DRESSING_RUBBLE` /
`HALL_DRESSING_LAYERS` / `SUBSTRATE_MATERIALS`), `packages/dungeon/src/scatter.ts`
(`instanceGroupsFromLayers`' stringify-based material dedupe). Filed 2026-07-12 from the W3
Task 4 review.

## `maze()` size + the stringly-typed carve-plan seam (and hall's missing door validation)

**Context:** Surfaced in the W3 Task 4 review. Two related shape problems in
`packages/dungeon/src/themes/maze.ts`, plus an asymmetry the shared stamp contract now makes
visible.

1. **`maze()` is ~87 lines spanning five concerns** — param validation, passage-block carve,
   wall-band carve, door build, stamp return — against `hall()`'s 28. It reads as one long
   procedure rather than a sequence of named steps (`.claude/rules/clean-code.md`: ~30–40 lines,
   one level of abstraction). Proposed fix: extract `validateMazeParams` / `carvePassages` /
   `carveOpenWalls` / `buildDoors` as private helpers in the same module.

2. **The carve plan crosses a stringly-typed seam inside one module.** `carvePlan` returns a
   `Set<string>` of `h:a,b` / `v:a,b` edge keys, which `maze()` then re-parses with a regex —
   including an unreachable `maze: bad edge key` throw for values that same module produced two
   frames earlier. Proposed fix: have `carvePlan` return structured edges (`{ axis, a, b }[]`)
   and keep the string ONLY as the `Set` membership key, so no parse (and no impossible throw)
   is needed on the consuming side.

3. **Door validation is asymmetric between the two grid vocabularies.** `maze()` validates door
   offsets (range + duplicate `{wall, offset}`, setup-loud); `hall()` does neither, relying on
   `doorAt`'s silent clamp (`Math.max(0, Math.min(offset, interiorLen - DOOR_W_CELLS))`) — an
   out-of-range hall door quietly slides to the nearest legal position instead of failing. Now
   that `doorAt` / `validateDoorApproach` are SHARED (`themes/grid-stamp.ts`, W3 Task 1), those
   checks arguably belong in `grid-stamp.ts` so both vocabularies inherit them and a third gets
   them for free.

**Trigger to revisit:** The next change to the maze carve internals (any edit inside
`carvePlan` / `braidPass` / the `maze()` carve loops), or when a third grid vocabulary lands —
which is also the point at which item 3's shared-validation question must be answered rather
than deferred.

**Reference:** `packages/dungeon/src/themes/maze.ts` (`maze`, `carvePlan`, `braidPass`),
`packages/dungeon/src/themes/hall.ts` (`hall` — the 28-line comparator, no door validation),
`packages/dungeon/src/themes/grid-stamp.ts` (`doorAt`'s clamp, `validateDoorApproach`).
Filed 2026-07-12 from the W3 Task 4 review.
