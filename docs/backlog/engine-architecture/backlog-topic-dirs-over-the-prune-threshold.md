# `engine-architecture/` (74) and `dungeon/` (21) are over the AGENTS.md prune threshold

**Context.** AGENTS.md: *"When `docs/backlog/` exceeds ~100 files or one topic subdirectory
exceeds ~20, prune by promoting actionable items out and consolidating context-decayed items."*
The 2026-07-25 hygiene pass applied that rule to `editor-and-tooling/` (37 → 15). Counts
immediately after, across the register:

| topic dir | files | over threshold |
| --------- | ----: | -------------- |
| `engine-architecture/` | 74 | **yes — ~3.7×** |
| `dungeon/` | 21 | yes — marginally |
| `editor-and-tooling/` | 16 | no (just pruned) |
| `native-runtime/` | 10 | no |
| `testing-and-quality/` | 9 | no |
| `infrastructure/` | 3 | no |
| `ai-agents/` | 2 | no |

Register total is ~135 files, which is also past the ~100 whole-register trigger.

`engine-architecture/` is the real target: at 74 files it is the dir where an entry is most
likely to be re-derived from scratch because nobody found it. `dungeon/` at 21 is one file over
and can wait for a natural pause.

**Fix shape** (the pattern this pass validated): group by theme → one merged doc per theme with
one `##` section per absorbed entry → each section keeps its Context / Trigger / Reference
verbatim-or-tightened → delete the absorbed files → run the zero-dangling-refs gate. Two things
the `editor-and-tooling` round learned the hard way, worth carrying forward:
- **Scope the ref gate wider than `*.md`.** Source comments cite backlog filenames too; a
  `--include="*.md"` grep misses them (see the sibling entry in `editor-and-tooling/`).
- **Decide up front which entries are charter inputs and stay separate files.** In this round
  six gate-UX/interaction-model set files were protected from merging.

**Trigger to revisit:** before the next epic that will file into `engine-architecture/` in
volume (a prune is cheapest when it precedes the additions, not after), OR when the register
passes ~150 files.

**Reference:** AGENTS.md § "Deferred work — `docs/backlog/`" (the >20 / ~100 rule),
`docs/backlog/README.md`, prune precedent commit `a531088c` (37 → 15 with the merged-doc shape).
