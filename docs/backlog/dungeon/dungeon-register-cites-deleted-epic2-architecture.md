---
summary: eleven dungeon backlog entries cite Epic 2 modules that were deleted; each needs a live-or-not disposition, not a citation re-point
---

# `docs/backlog/dungeon/` was never pruned, and 11 of its 19 entries cite architecture Epic 2 deleted

Measured at the **T5 review** (2026-08-11), by the citation sweep the review ran after the
prune's own reference gate was found to match **filenames only** — never `file:line`, never
path validity, never a factual claim in moved text.

## Context

T5's prune (`9e12a3a1`) deliberately scoped itself to `engine-architecture/` (85 → 33) and
`editor-and-tooling/` (40 → 21). **`dungeon/` was never in scope** and stands at 19 files,
unpruned since the register began.

The review then swept every package path cited anywhere under `docs/backlog/`:

```sh
# the sweep's shape: extract cited package paths, test each for existence
grep -rhoE "packages/[A-Za-z0-9._/-]+\.(ts|tsx|wgsl|json|md)" docs/backlog --include="*.md" \
  | sort -u | while read -r p; do [ -e "$p" ] || echo "DEAD $p"; done
```

**251 cited package paths, 34 of them dead.** T5's fixer commit (`ef629dc7`) took the five
that were a mechanical `packages/core/tests/**` → `packages/core/src/**` re-point (the
tests-beside-modules migration), because fixing one of five identical cases would have been
arbitrary. It deliberately stopped there. **This entry is the remainder.**

## What is actually dead, and why a re-point is the wrong fix

Six Epic 2 substrate modules were deleted outright, verified at head:

```sh
for p in dungeon/src/substrate dungeon/src/themes dungeon/src/bake.ts \
         dungeon/src/built.ts dungeon/src/scatter.ts dungeon/src/world-build.ts; do
  printf "%-34s " "$p"; [ -e "packages/$p" ] && echo EXISTS || echo GONE
done      # → all six GONE
```

Eleven `dungeon/` entries cite them, plus one in `editor-and-tooling/`:

```sh
grep -rlE "dungeon/src/(substrate|themes|bake\.ts|built\.ts|scatter\.ts|world-build\.ts)" \
  docs/backlog --include="*.md"      # → 13 files (11 dungeon, dropped-fold-ins,
                                     #    and this charter's own recovery reference)
```

`backing-masonry-fallback` · `charmover-stepup-into-low-ceiling-guard` ·
`connector-geometry-stitching` · `disjoint-region-check-is-aabb-conservative` ·
`door-opening-standard-is-not-universal` · `grid-vocabulary-consolidation` ·
`maze-cells-upper-bound` · `scatter-spacing-max-dead-config` ·
`substrate-palette-rle-storage` · `visual-polish-pass` ·
`world-spec-no-portal-error-is-unactionable`.

**One of the eleven has since been dispositioned, and it is the worked example of what this
entry asks for.** `grid-vocabulary-consolidation` (gone) was closed at `genre-contracts`
Task 9 (2026-08-18) by reading each of its four sections against head rather than re-pointing
its paths: three were resolved outright by the move of the grid vocabularies into
`@furnace/core/field`, and the one live residue was re-filed against the code that now
carries it (`docs/backlog/engine-architecture/maze-carve-plan-is-a-stringly-typed-seam.md`).
The disposition cost one reading pass per section and took the entry's 19 dead-path
occurrences with it — the largest single concentration in the register. Re-run the command
above for the current list; it is a T5-dated snapshot, not a live count.

**Re-pointing these would be the wrong move, and that is the whole reason this is an entry
rather than a fix.** When an entry's *entire subject* was deleted, the live question is not
"where did that file go" — it is **whether the entry is still live at all**. That is a
close-with-disposition judgement under the keep-by-default ruling (user, 2026-08-11):
nothing is lost, and only entries DIRECTLY CONTRADICTING current direction are removed. Six
more dead paths are ordinary Class-A re-points and can ride the same pass.

A citation repaired to point at a plausible successor module is **worse than a dead one**:
the dead path announces itself, the plausible one reads as sourced.

## The trigger this entry is evidence for

T5's prune moved ~84 entries under a **verbatim** rule behind a **filename-only** gate. The
review found the cost: one register asserting a bug that does not exist (`catalog-collision-schema`
on `proxyScale` — true when written 2026-07-26 14:11, fixed nine hours later at 23:35, carried
forward unread three weeks on), a table failing its own regeneration command, a newly-written
citation to a module that never existed, and ~10 dead paths. **A "verbatim" move is a move of
claims, not just of text**, and nothing read them against source.

## Trigger to revisit

**The documentation-strategy session** (user, 2026-08-11: *"next session we can focus on the
documentation, approach and tools for both you and me"*). This sweep is one of its concrete
inputs — do it as part of that pass rather than as a fourth consolidation round, so the
disposition rule and the tooling that enforces it are decided once and then applied.

Sooner, if a dungeon slice opens and someone reads one of the eleven as current.

## Reference

- `docs/backlog/infrastructure/docs-registers-findability.md` — the design charter this
  feeds, including its *Citation integrity* section.
- `9e12a3a1` (the prune), `ef629dc7` (the review's fixes, and the five taken).
- `docs/reference/dungeon-architecture.md` — the as-built the eleven must be judged against.
