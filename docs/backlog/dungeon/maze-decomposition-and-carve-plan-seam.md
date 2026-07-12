# `maze()` size + the stringly-typed carve-plan seam (and hall's missing door validation)

**Context.** Surfaced in the W3 Task 4 review. Two related shape problems in
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

**Trigger to revisit.** The next change to the maze carve internals (any edit inside
`carvePlan` / `braidPass` / the `maze()` carve loops), or when a third grid vocabulary lands —
which is also the point at which item 3's shared-validation question must be answered rather
than deferred.

**Reference.** `packages/dungeon/src/themes/maze.ts` (`maze`, `carvePlan`, `braidPass`),
`packages/dungeon/src/themes/hall.ts` (`hall` — the 28-line comparator, no door validation),
`packages/dungeon/src/themes/grid-stamp.ts` (`doorAt`'s clamp, `validateDoorApproach`).
Filed 2026-07-12 from the W3 Task 4 review.
