---
summary: `world.list`'s `legacy` kind meant "a v1 world the game can still boot" and foundations T2 made that untrue — the classifier's mechanics are a live guard and should stay; what is stale is the vocabulary and the copy explaining it, in four sites
---

# `world.list`'s `legacy` kind now names a world that cannot boot

`listWorlds` (`packages/editor/src/daemon/worlds.ts`) classifies every directory under
`worlds/` as `kind: "field" | "legacy"`, on one test: does it have an `oplog.json` beside
its `manifest.json`? With one → `field`. Without → `legacy`.

`legacy` was accurate when it was written: it meant "a v1 world — real, loadable by the
game, just not editable, because `field.load` needs the oplog the editor writes". The
drawer says exactly that (`WorldDrawer.tsx`'s `LEGACY_REASON` — *"a v1 world: no oplog, so field.load
can't read it into the editor"*) and disables Open on those rows.

**Foundations T2 (2026-08-05) made that untrue.** The game's `loadWorld`
(`packages/dungeon/src/world/world-loader.ts`) now gates every manifest through
`isWorldManifest`, which admits `version: 2` + `kind: "field"` and nothing else, and
**throws** — `"...is not a world this runtime understands — re-bake"` — on anything that
fails. A `worlds/` directory with a manifest and no oplog is therefore not a v1 world the
game can still boot; it is a directory nothing in the repo can open. The word `legacy`
outlived the thing it named.

## This is a naming question, not a bug

The classifier's *mechanics* were deliberately left alone at T2 and should stay. It is a
live guard: it is what stops the drawer offering Open on a foreign or half-written
directory, and "manifest but no oplog" is still exactly the right test for that. Nothing
misbehaves today — a `legacy` row is correctly refused everywhere it appears.

What is stale is the vocabulary and the copy that explains it, in four places:

- `packages/editor/src/daemon/worlds.ts` — the `WorldRow["kind"]` union and the ternary in
  `listWorlds` that produces it.
- `packages/editor/src/frontend/lib/api.ts` — the client-side `WorldRow` type and its
  docblock ("`legacy` = a v1 world directory with a manifest but no oplog").
- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx` — `LEGACY_REASON`, the
  `reason` ternary that selects it, and the `legacy` badge on the same row.
- `packages/editor/src/frontend/lib/world-actions.ts` — the `lastWorld` docblock, which
  lists `legacy` among the reasons a boot-reopen silently answers `null`.

The design question is which of these it becomes:

1. **Rename to what it now means** — `unreadable`, `unrecognized`, `foreign`. The badge and
   the reason line change with it. Honest, and the smallest change, but it broadens the
   name to cover directories that were never worlds at all, which may want its own row
   treatment rather than sharing one.
2. **Split the kind.** Distinguish "a v1 world we could migrate" from "not a world this
   build understands", if a migration path is ever wanted. Only worth it if migration is on
   the table — and after T2's v1 cut, it probably is not.
3. **Stop listing them.** If nothing can open a manifest-without-oplog directory, the
   drawer arguably should not show a disabled row for it at all. Cheapest UI, but it hides
   a directory the user may be looking for and wondering about, which is worse.

## Trigger to revisit

The next task that touches the world drawer's row rendering or `WorldRow`'s shape — all
four sites are in that blast radius and doing them apart costs more than doing them
together. Or, sooner: the first time someone reads a `legacy` badge and expects the world
to still work in the game, which is what the word now promises and no longer delivers.

## Reference

- `packages/editor/src/daemon/worlds.ts` — `listWorlds` and the `oplog.json` test.
- `packages/dungeon/src/world/world-loader.ts` — `loadWorld` and `isWorldManifest`,
  the gate that made `legacy` mean "cannot boot".
- `docs/reference/editor-architecture.md` §4 and §16.4 — the daemon's world verbs and the
  drawer that renders their rows, as-built.
