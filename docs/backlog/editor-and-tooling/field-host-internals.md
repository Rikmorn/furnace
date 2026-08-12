---
summary: how `field-host/` is built inside — `remeshOne` swallowing GPU setup failures, eight in-source deferrals, an analyzer re-analysis halo resting on an unstated precondition
---

# Field-host internals

Tracker for `packages/editor/src/field-host/`'s **own internals** — findings about how the
host is built rather than about what the editor offers. Each section is one previously
standalone entry, keeping its Context, *Trigger to revisit* and *Reference*.

They are merged because none of them is visible from outside the host and all three are
decided by whoever is next inside it: an error path that swallows GPU setup failures so a
broken render path fails silently, eight in-source deferrals that had no durable record
until they were collected, and an analyzer re-analysis halo whose correctness rests on a
precondition nothing states. The prune-tranche section is cited live from
`packages/editor/tests/field-host-boundaries.test.ts` and
`docs/reference/field-host-clusters.md`.

Distinct from `field-tool-follow-ons.md` (what the field TOOLS do or fail to do, which the
user sees) and from `editor-seams-and-preview-deferrals.md` (the host's boundaries with the
project bundle and the worker). This file is the inside.

## `remeshOne` swallows GPU setup failures, so a broken render path fails silently

`remeshOne` (`packages/editor/src/field-host/field-world.ts` since foundations T3d Task 6;
`field-host.ts` before that) wraps its whole body — the worker
round-trip AND the `applyMesh` call that follows it — in one `try`, whose `catch` reports a
`console.warn` and returns. That was written for the WORKER's failure modes, which are
transient and per-chunk: a job rejected because `dispose` tore the context down mid-flight is
expected and must not be loud. But `applyMesh` sits inside the same `try`, and `applyMesh`
calls into the material layer for every bucket it draws — so a total failure of the render
SETUP is caught by a handler built for a transient per-chunk one.

Measured at foundations T3d Task 3, as a sabotage probe rather than reasoned: making
`field-materials.ts`'s per-class cache write to a private map instead of the substrate's — so
`bucket()` finds neither the class key nor the `c0` fallback and throws on every call —
leaves the **entire editor suite green (1469 pass / 0 fail)**. `bucket()` is provably reached
(instrumented: three call sites fire). The observable result of a completely broken material
cache is an empty viewport plus one `console.warn` per chunk. No test fails, no tool-error
channel message reaches the chrome, and the user is shown a world with no geometry in it and
told nothing.

The coverage half of this is recorded in `field-materials.ts`'s header and in
`docs/reference/field-host-clusters.md` §2.8. What is filed HERE is the other half, which is
not a coverage gap but an **error-contract** question: which failures may a remesh swallow?
The two classes now sharing one handler are different in kind — a worker job that loses a
race with teardown is noise, while a material cache that cannot answer is a broken invariant
that should be loud (the repo's "setup loud, runtime quiet" stance, `docs/reference/engine-conventions.md`
§Failure policy). Plausible shapes: narrow the `try` to the worker call alone and let
`applyMesh` throw; keep one `try` but re-throw anything that is not the known
dispose-race; or route setup failures to `reportToolError` so the chrome says the viewport is
broken. Each has a different blast radius across the nine paths that dirty chunks, which is
why this needs a decision rather than an inline fix — it is above the inline-fix threshold in
`AGENTS.md` (it introduces a design decision, and it changes a failure contract other clusters
depend on).

Worth checking at the same time whether the sibling swallow in `ret.setMaterialTable`'s async
IIFE has the same shape — it catches around `materials.rebuildForTable(c)` for the same
dispose-race reason and would hide the same class of setup failure.

**THE TRIGGER FIRED AND THE ENTRY STAYS OPEN — 2026-08-08, T3d Task 6.** That task did
extract `world` and now owns `remeshOne`, `applyMesh` and `drainDirty`, exactly as this
entry predicted. It changed NOTHING here, and the reason is a constraint rather than an
oversight: T3d Task 6 is **behaviour-frozen** (zero behaviour changes, every existing pin
passing unmodified), and all three shapes proposed above change what a failing remesh DOES.
So the three functions crossed the boundary verbatim, the `try` still spans the worker call
and `applyMesh` together, and the decision is still owed. What the move DID change is where
to make it: the handler is now module-private inside `field-world.ts`, its `catch` guards on
`substrate.disposed()` rather than a closure `let`, and `reportToolError` is already a dep on
that module's record — so the third shape ("route setup failures to `reportToolError`") is now
a one-line reach rather than a new seam.

**Trigger to revisit:** the next time anyone touches `remeshOne`'s error handling or the
tool-error contract. The T3d hook is spent; this now wants a slice that is allowed to change
behaviour, and the prune tranche is the nearest candidate.

Worth folding in when it is decided: T3d Task 6 measured a SECOND unpinned path of the same
family — `ret.setMaterialTable`'s post-swap `world.redirtyAll()` is asserted by no test at
all, while `ret.init`'s identical call is (`docs/reference/field-host-clusters.md` §2.11).
That is the same async IIFE this entry's last paragraph already says to check.

**Reference:** `packages/editor/src/field-host/field-world.ts`'s `remeshOne` (the code);
`packages/editor/src/field-host/field-materials.ts` header (the three sabotage
probes and their measured results); `docs/reference/field-host-clusters.md` §2.8 and §2.11;
`docs/reference/engine-conventions.md` §Failure policy.

## The `field-host/` prune tranche — eight in-source deferrals with no durable record

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

**Keep separate from the *`remeshOne` swallows GPU setup failures* section**, which now sits
in this same file (both were absorbed into it at T5, 2026-08-11). The original wording of this
paragraph said "do NOT fold in", meaning: do not merge the two *questions*. That still holds
and is why they remain two sections rather than one — the remesh section is an error-CONTRACT
question with its own trigger, not a deletion one, and settling it inside a tidy-up would hide
a failure-policy decision. Sharing a file is filing, not conflation.

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

## Analyzer re-analysis halo assumes every bounded probe reach stays under one chunk

**Context.** The editor's analyzer worker re-runs stage 1 over a set derived from the
edited chunks: the 26-neighbour halo, plus every allocated chunk BELOW the dirty one in
its own XZ column and the 4 cardinal ones (`reanalysisKeys` in
`packages/editor/src/field-host/analyzer-protocol.ts`). The column term exists because
two reads in `packages/core/src/field/analyze.ts` are unbounded in Y — `ceilingAbove`
(own column) and `scanRise`'s `isSolid` (the 4 cardinal columns, bounded only by that
ceiling). Everything else the column pass reads is BOUNDED, and the halo is what covers
those.

The halo's sufficiency for the bounded probes is **not intrinsic** — it holds only while
every bounded reach stays under `CHUNK_DIM` (16). Those reaches are derived from the
agent profile divided by `cellSize` (`metricsFor`), so they scale as `1/cellSize`. At
today's 0.25 m lattice with `catalog/agent.json` the maxima are comfortable:

| reach | expression | at 0.25 m |
| --- | --- | --- |
| Y, headroom (`airRun`) | `clearCells = ceil(clearance / c)` | 8 |
| Y, lip wall probe | `stepCells + wallProbeUp − 1` | 4 |
| XZ, pinch (`faceDistance`) | `pinchCells = ceil((2·radius + skin) / c)` | 3 |
| XZ, lip wall probe | `1 + wallCellsXZ = 1 + ceil(radius / c)` | 3 |

At `cellSize` 0.05 the same profile gives `clearCells` 36, and a lip-wall probe reaching
27 cells above the anchor (`stepCells` 8 + `wallProbeUp` 20, less one) — both past 16,
i.e. **two chunks** — and the halo would silently under-cover, with no test catching it. This is pre-existing: it is a property of D-F4-9's amendment (which
named the halo) rather than of the cardinal-column correction made in `265ff166`.

One refinement worth recording, derived while filing this and worth re-verifying before
acting on it: the *unbounded column term* already absorbs any reach along the anchor's
own or cardinal columns at ANY lattice, because it includes every allocated chunk below
without a depth limit. That narrows the true exposure to the two probes the column term
cannot help with — `wallBeyondLip` (the only probe that is both diagonal in XZ and
extended in Y, so it escapes both the halo and the cardinal columns) and `faceDistance`
(a same-level lateral read, which no below-column term covers). `wallBeyondLip` is the
binding one first; `faceDistance` only crosses 16 cells below ~0.04 m.

A cheap guard exists if this ever matters — assert the derived cell counts stay under
`CHUNK_DIM` in the analyzer's own validation path, so a too-fine lattice fails
setup-loud instead of quietly under-covering. **Deliberately not built now:** at the
shipping lattice the margin is 2× and the guard would be dead code with a maintenance
cost.

**Trigger to revisit:** any change to the field lattice below ~0.1 m, or any increase to
`clearance` / `stepHeight` / the wall probe (`WALL_PROBE_M`) that pushes a bounded reach
past 16 cells. Recompute the table above whenever `catalog/agent.json` or
`DEFAULT_CELL_SIZE` moves.

**Reference:** `packages/core/src/field/analyze.ts` (`metricsFor` — `clearCells`,
`pinchCells`, `wallCellsXZ`, `wallProbeUp`, `stepCells`; `airRun`, `wallBeyondLip`,
`faceDistance`, `scanRise`); `packages/core/src/field/solidity.ts` (`ceilingAbove`, the
uncapped scan the column term answers); `packages/editor/src/field-host/analyzer-protocol.ts`
(`READ_COLUMNS`, `reanalysisKeys` — the halo term is the 27-cube loop);
`packages/core/src/field/chunks.ts` (`CHUNK_DIM`, `DEFAULT_CELL_SIZE`).
