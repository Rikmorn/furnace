---
summary: eight in-source "prune tranche" declarations across `field-host/` plus three that were never declared anywhere — alias consolidation, accent-constant ownership, `field-host.ts`'s tombstone density, and the `~N lines` distance hints that rot on contact
---

# The `field-host/` prune tranche — eight in-source deferrals with no durable record

**Context.** Foundations T3d lifted nineteen clusters out of `createFieldHost` across six
tasks. Every task was **behaviour-frozen** (zero behaviour changes, every existing pin passing
unmodified), and every task therefore met deletion-shaped questions it was not allowed to
answer: removing a redundant alias, choosing an owner for a shared constant, collapsing a
tombstone comment. Each was declared **at source** with the words "prune tranche" — and none
of them was ever written down anywhere else. This entry is that record, written at the T3d
Task 6 review when the count was noticed.

**The eight in-source declarations**, so the two records cannot drift. Regenerate with:

```
grep -rnE "parked for T5|prune[- ]tranche" packages/editor/src/field-host/
```

**The alternation is load-bearing, and the narrower grep this entry used to state was wrong.**
Eight sites park work here but they do not spell it one way: five say "prune tranche", two say
"prune-tranche" hyphenated, and one (`field-render.ts`) says "parked for T5" and nothing else.
The originally-stated `prune[- ]tranche`-only command therefore returned **seven** while the
table below claimed eight — the row it disowned was the eighth. Corrected at the T5 branch
review, 2026-08-11, along with four line numbers the command had already invalidated.

The command above is the authority, and each row carries an anchor phrase so it survives the
next drift. Line numbers are deliberately absent — they were the part that rotted twice.

| Site | Anchor phrase | What is parked |
| --- | --- | --- |
| `field-camera-rig.ts` | "consolidating the five across the directory" | the local `Box` alias, one of five spellings of `{ min: Vec3T; max: Vec3T }` restated per module |
| `field-analyzer.ts` | "Consolidating the four across the directory" | the `Vec3T` / `LineBatch` alias family, four spellings, this module's end |
| `field-materials.ts` | "choosing an accent-vocabulary owner" | the accent-constant owner question, from the material seam's end |
| `field-materials.ts` | "TWO PRUNE CANDIDATES ARE PARKED HERE" | `Materials.kitInstanced` / `kitMat`, two spellings of one handle; AND the `Vec3T` / `LineBatch` family, declared privately in FIFTEEN and SEVEN modules |
| `field-render.ts` | "choosing an owner among peer modules" | `selectionColor` / `anchorCrossHalfM`, the two accent constants this module takes as value deps |
| `field-render.ts` | "What is still parked for T5" | the `Vec3T` / `LineBatch` consolidation across the directory, and `field-materials.ts`'s `kitMat` / `kitInstanced` pair — **the site spelled "parked for T5", which is why the old grep never returned it** |
| `field-host.ts` | "belongs to the prune tranche and not to a threading one" | the three accent constants (`SELECTION_COLOR`, `SELECTED_COLOR`, `ANCHOR_CROSS_HALF_M`) — declared in the host with NO host reader since T3d Task 5, kept there because choosing an owner among peer modules is a naming decision whose only spelling makes two siblings value-import a third for a literal |
| `field-selection.ts` | "the choice of an accent-vocabulary owner is the prune tranche's" | the same three constants from the other end |

**Three more that this tranche treated as parked and that had no record at all** — they are
the reason this entry exists rather than a ninth `grep` hit:

- **`boxCorners` into `box-edges.ts`.** A pure geometry helper sitting in `field-ghost.ts`
  while its natural home is the pure module next door. Never declared at source; noticed and
  deferred in passing.
- **`field-host.ts`'s tombstone density.** The file is **2,996 comment lines against 915 of
  code — 76.6% prose**, and a large and growing share of that is *tombstones*: blocks that say
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
`field-world.ts` (902 lines, 23 deps) contains two things: a world-LIFETIME half (reset, load,
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

**Keep separate from `remeshone-swallows-gpu-setup-failures.md`**, which shared a file with
this entry between T5 (2026-08-11) and the un-merge that separated them again. The original
wording of this paragraph said "do NOT fold in", meaning: do not merge the two *questions*.
That still holds and is why they are two entries rather than one — the remesh entry is an
error-CONTRACT question with its own trigger, not a deletion one, and settling it inside a
tidy-up would hide a failure-policy decision. Sharing a file is filing, not conflation.

**Reference:** the eight sites above; `docs/reference/field-host-clusters.md` §2.10 (the
accent constants' argument), §2.11 (T3d Task 6's measurement) and **§1 "The shape of the
file"** (the 76.6% prose figure, in the code/comment/blank row — *not* §2.11, which is where
this line pointed until the T5 branch review, 2026-08-11). **The eleven falsified distance
hints are recorded NOWHERE but this entry** — `grep -c "distance" docs/reference/field-host-clusters.md`
returns 0, so the bullet above is the only record of that measurement and must not be deleted
on the assumption a reference doc carries it;
`docs/reference/editor-architecture.md` §21.5 (the live module roster) and §24 (the T3d
as-built); `.claude/rules/working-standards.md` §Design ("deletion pass before addition
pass").
