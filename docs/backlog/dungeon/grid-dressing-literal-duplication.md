# Grid dressing material literals are copy-pasted between `maze.ts` and `world-build.ts`

**Context.** Surfaced in the W3 Task 4 review (the maze stamper). `MAZE_DRESSING_LAYERS`'
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

**Trigger to revisit.** The next time either dressing literal is edited (colour/spec/scale tuning
in a dressing pass), or when a third grid vocabulary lands and copies the literal a third time —
whichever comes first. Two occurrences is the tolerate-duplication threshold; a third is not.

**Reference.** `packages/dungeon/src/themes/maze.ts` (`MAZE_DRESSING_LAYERS`),
`packages/dungeon/src/world-build.ts` (`DRESSING_CRATE` / `DRESSING_RUBBLE` /
`HALL_DRESSING_LAYERS` / `SUBSTRATE_MATERIALS`), `packages/dungeon/src/scatter.ts`
(`instanceGroupsFromLayers`' stringify-based material dedupe). Filed 2026-07-12 from the W3
Task 4 review.
