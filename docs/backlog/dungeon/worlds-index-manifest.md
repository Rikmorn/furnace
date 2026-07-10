# Worlds-index manifest — where named wings/worlds live (deferred from 3.2.1, D7)

**Context.** 3.2.1 made bakes nameable (`regions/<name>/`), but the game's
wing-loader still reads only the well-known default (`regions/generated-wing/`).
A dungeon-level manifest declaring which worlds/regions exist and where they load
from would let the game (and 3.2.5's curation UI) enumerate and select among named
bakes. Belongs with full packaging work — not needed while one wing ships.

Related gap: `packages/dungeon/.gitignore` and `biome.json` currently ignore only the
default `regions/generated-wing/`; a bake under any other name lands un-ignored (git +
biome). Generalizing the globs to all baked wing subdirs (e.g. `regions/*/`, which keeps
the committed `region-cavern.*` top-level fixtures tracked) belongs with this named-wing
wiring — not needed while only the default wing is loadable.

**Trigger to revisit:** packaging/distribution work for the dungeon, or 3.2.5
curation needing to list/switch named wings.

**Reference:** `packages/dungeon/src/bake.ts` (`wingDir`, `DEFAULT_WING_NAME`),
`packages/dungeon/src/wing-loader.ts`.
