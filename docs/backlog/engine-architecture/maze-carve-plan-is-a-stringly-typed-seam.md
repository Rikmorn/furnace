---
summary: the maze generator's carve plan crosses a stringly-typed seam inside one module — `carvePlan` builds `h:a,b` keys that the same module re-parses with a regex, behind an unreachable throw
---

# The maze carve plan crosses a stringly-typed seam inside one module

`carvePlan` in `packages/core/src/field/generators.ts` returns a `Set<EdgeKey>`, where
`EdgeKey` is a `string` spelled `h:a,b` (the wall between maze cells (a,b)-(a+1,b)) or
`v:a,b` ((a,b)-(a,b+1)). `edgesOf` builds those strings from structured `(a, b)` integers
it already has; `mazeGenerator`'s wall-opening loop then re-parses every one of them with
`/^([hv]):(\d+),(\d+)$/` and `Number(...)` to recover the same integers, guarded by

```ts
if (!m) throw new Error(`maze: bad edge key ${key}`);
```

— a throw for values this module produced three frames earlier, so it can never fire. The
structure is destroyed and reconstructed inside one file, and the impossible branch is the
cost of that.

**Proposed fix:** have `carvePlan` return structured edges (`{ axis, a, b }[]`) and keep
the string ONLY as the `Set` membership key, so the consuming side needs no parse and the
unreachable throw goes with it.

**Why this is not an inline fix.** The carve is a deliberately byte-frozen port. Its own
header says *"carvePlan and braidPass port VERBATIM: any change to the mixer changes every
maze in existence"* — the growing-tree walk, the braid pass and the RNG draw order are what
make a seed reproduce a maze, and set membership on the string key is load-bearing to that
(`braidPass` counts a cell's open edges via `open.has(e.edge)`). So the restructure has to
either keep the string as the key and change only the return shape, or prove bit-parity
against the committed fixtures. That is a decision, not a rename.

Filed 2026-08-18 at the `genre-contracts` un-merge as the ONE live residue of
`docs/backlog/dungeon/grid-vocabulary-consolidation.md` (gone), a W3-era dungeon tracker
closed in the same commit. Its three other sections were resolved by the move of the grid
vocabularies into `@furnace/core/field`: the five-edit-site union tax (one registry entry
now — `FIELD_GENERATORS`), the duplicated door-width constant (`PIECE_BOX` and the piece
box are gone), and the copy-pasted dressing literals (`themes/` and `scatter.ts` are gone).
Its fourth section's door-validation asymmetry is resolved too — `hallParams` now validates
door offsets through the shared `assertDoorOffsetFits`, and the centre-lane check lives in
the shared `openDoor`.

**Trigger to revisit:** the next change to the maze carve internals in
`packages/core/src/field/generators.ts` — any edit inside `edgesOf`, `carvePlan`,
`braidPass`, or `mazeGenerator`'s edge-opening loop. A maze param, footprint or door change
does not fire it; the seam is only in the way of someone editing the plan itself.

**Reference:** `packages/core/src/field/generators.ts` — `edgesOf`, `carvePlan`,
`braidPass`, and `mazeGenerator`'s `evaluate` (the `for (const key of carvePlan(...))`
loop). The determinism contract the fix must preserve is pinned by
`packages/core/src/field/generators.test.ts` — *"maze: same seed → identical ops; different
seed → different plan"* and *"braid opens loops: braid 1 differs from braid 0 at the same
seed"*.
