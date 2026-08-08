# The `field-host/` prune tranche — eight in-source deferrals with no durable record

**Context.** Foundations T3d lifted nineteen clusters out of `createFieldHost` across six
tasks. Every task was **behaviour-frozen** (zero behaviour changes, every existing pin passing
unmodified), and every task therefore met deletion-shaped questions it was not allowed to
answer: removing a redundant alias, choosing an owner for a shared constant, collapsing a
tombstone comment. Each was declared **at source** with the words "prune tranche" — and none
of them was ever written down anywhere else. This entry is that record, written at the T3d
Task 6 review when the count was noticed.

**The eight in-source declarations**, so the two records cannot drift
(`grep -rn "prune tranche" packages/editor/src/field-host/` regenerates the list):

| Site | What is parked |
| --- | --- |
| `field-camera-rig.ts:151` | the local `Box` alias, one of several structural three-word aliases restated per module |
| `field-analyzer.ts:195` | an alias consolidation this module already names |
| `field-materials.ts:77` | a deletion candidate in the material seam |
| `field-materials.ts:156` | a second, beside the alias consolidation above |
| `field-render.ts:79` | a deletion-pass question raised by the 29-member deps record |
| `field-render.ts:115` | the `Vec3T` / `LineBatch` alias restatement across six modules |
| `field-host.ts:1430` | the three accent constants (`SELECTION_COLOR`, `SELECTED_COLOR`, `ANCHOR_CROSS_HALF_M`) — declared in the host with NO host reader since T3d Task 5, kept there because choosing an owner among peer modules is a naming decision whose only spelling makes two siblings value-import a third for a literal |
| `field-selection.ts:84` | the same three constants from the other end |

**Three more that this tranche treated as parked and that had no record at all** — they are
the reason this entry exists rather than a ninth `grep` hit:

- **`boxCorners` into `box-edges.ts`.** A pure geometry helper sitting in `field-ghost.ts`
  while its natural home is the pure module next door. Never declared at source; noticed and
  deferred in passing.
- **`field-host.ts`'s tombstone density.** The file is **2,899 comment lines against 915 of
  code — 76.0% prose**, and a large and growing share of that is *tombstones*: blocks that say
  where a binding WENT rather than what the file does. They were load-bearing while the
  tranche ran, because each one carries the argument for a move. Whether they are load-bearing
  afterwards is a real question with a real cost (a reader of the facade wades through six
  tranches of history), and nothing has asked it.
- **The `~N lines` distance hints.** ~15 of them across the directory, hand-written and
  invalidated by every subsequent move — T3d Task 6 alone falsified eleven and re-derived them
  by script. They are useful and they rot on contact. Either they get generated (the
  scratchpad tooling can already derive assembly distances) or they get dropped for named
  anchors ("below `createFieldMachine`") that cannot go stale.

**One shape the T3d Task 6 code-quality review surfaced, recorded rather than acted on.**
`field-world.ts` (865 lines, 23 deps) contains two things: a world-LIFETIME half (reset, load,
save, the dirty set, the remesh drain) and a chunk-GEOMETRY half. The seven pure-read verbs —
`chunkOrigin`, `chunkSetBox`, `worldBox`, `occupiedTopY`, `chunkCopy`, `snapshotChunks`,
`snapshotAllChunks` — need `{ substrate }` and **nothing else**, which is
`createHistoryFeed`'s one-member shape. Splitting would leave a 16-dep world-lifetime module
and a 1-dep chunk-geometry module. It was **not** done at Task 6 and should not have been: it
is ~150 lines and a 22nd file for a boundary the freeze could not test, and the tranche's own
rule is that a split needs a reason beyond width. It belongs here so the option is not lost.

**Trigger to revisit.** The next slice that is allowed to change behaviour in
`packages/editor/src/field-host/` and is not itself a threading task — i.e. after foundations
T3 closes. The three accent constants are the cheapest first item (two readers each, no
behaviour, one decision); the tombstone question is the one that needs a stance before any
edit, because it governs how much of the rest is even worth doing.

**Do NOT fold in:** `remesh-swallows-render-setup-failures.md` is a separate entry with a
separate trigger — it is an error-CONTRACT question, not a deletion one, and conflating them
would hide a failure-policy decision inside a tidy-up.

**Reference:** the eight sites above; `docs/reference/field-host-clusters.md` §2.10 (the
accent constants' argument) and §2.11 (T3d Task 6's measurement, including the 76.0% prose
figure and the eleven falsified distance hints);
`docs/reference/editor-architecture.md` §21.5 (the live module roster) and §24 (the T3d
as-built); `.claude/rules/working-standards.md` §Design ("deletion pass before addition
pass").
