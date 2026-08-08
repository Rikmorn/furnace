# The `createFieldHost` closure, mapped

A factual map of the state held inside `createFieldHost` in
`packages/editor/src/field-host/field-host.ts`, as of 2026-08-03 — re-swept in full at the
T3c review, 2026-08-07, commit `7bb353a5` (§2.5 says exactly what that re-derived and what
it deliberately did not). Every binding in the closure is assigned to exactly one owning
cluster, and every read and write that crosses a cluster line is listed.

This is a **description, not a proposal**. §7 is the one forward-looking section and is
marked as such.

**Fourteen clusters have since left, a fifteenth left in half, and one has been examined
and DECLARED to stay.** `segment` was extracted to
`packages/editor/src/field-host/field-segment.ts` on 2026-08-03 — its six state bindings,
its six functions and its one boundary mutation (`tool.maskDropReported`) are no longer in
the closure. `voidcast` followed on 2026-08-06, to
`packages/editor/src/field-host/field-voidcast.ts`, taking two of its three state
bindings and all five of its functions (§6's `voidcast` row records what stayed and why).
`props` went the same day, to `packages/editor/src/field-host/field-props.ts`, taking one
of its two state bindings and all three of its functions. `stats` went the same day too, to
`packages/editor/src/field-host/field-stats.ts`, taking **all six** of its state bindings
and its one function — plus twenty lines of `tick` that the map attributes to `lifecycle`
(§6's `stats` row explains why that matters more than the count does). Then `history` went,
**but only as its FEED** — to `packages/editor/src/field-host/field-history-feed.ts`,
taking both of its state bindings and two of its three functions. `stepHistory` stayed, and
§6's `history` row explains why that is a finding rather than an omission (it also corrects
that row's function count, 2 → 3). Last of T3b1's five, `view` went to
`packages/editor/src/field-host/field-view.ts`, taking both of its state bindings and its
one function — and it is the one extraction sized by what it SUPPLIES rather than by what it
takes (§6's `view` row, and the module's own header). Then, on 2026-08-07, **three more went
at once** — `stamp`, `move` and `gesture`, to
`packages/editor/src/field-host/field-machine.ts`, as ONE module rather than three because
every boundary drawn between them cuts a state machine in half (§7.2, and §7.5, which
predicted this extraction's whole cost and is now annotated with what it got right). Between
them they took 13 of their 14 state bindings and all 28 of their functions; the one that
stayed is `stamp.ghostMeshes`, and §6's `stamp` row says why. **Later the same day the
POINTER CHAIN followed them** into the same module — the four pointer handlers' bodies, plus
`tool.digging` and `tool.lastStroke` — leaving the handlers themselves behind as delegates.
That is the first time a row was hollowed in PART while the cluster went on standing; §2.4
says what it cost this map, and `tool` and `input` are the two rows. **Then foundations T3d
took three more on 2026-08-07** — `targeting` to
`packages/editor/src/field-host/field-targeting.ts` (its one binding and all six functions),
`picking` to `packages/editor/src/field-host/field-picking.ts` (no state, all four
functions, and a seam of exactly ONE verb), and `drift` to
`packages/editor/src/field-host/field-drift.ts` (both bindings, all three functions) — and
in the same task **`catalogs` was probed and declared FACADE-RESIDENT**, the first row to
carry that marker. §2.6 says what each one found. **The same tranche's Task 2 then took
`analyzer`** to `packages/editor/src/field-host/field-analyzer.ts` — 18 of its 19 state
bindings and all 14 of its functions, the largest single cluster to leave; `flagStore` is
the nineteenth and it stays, as a FOURTH substrate leftover (§2.7 has the argument, and §6's
row records it at both ends). **Task 3 then took the two ends of the same fan on
2026-08-08** — `materials` to `packages/editor/src/field-host/field-materials.ts` (16 of its
17 bindings and all 7 functions; `litByClass` is the seventeenth and becomes a FIFTH
substrate leftover) and `render` to `packages/editor/src/field-host/field-render.ts` (all 5
bindings, all 5 functions, nothing left behind, and a seam of exactly ONE verb against a
29-member deps record). §2.8 says what each one found, including a §2.1 string-literal
phantom struck out of the `materials` row and the coverage measurement that says this map's
two zero-mutation "pure reader" rows are cheap to extract and nearly unverified.

Every count below still includes all fifteen. They are left as measured because they are
what the 8 clusters still standing at head were sized against (5 whole — `world`,
`lifecycle`, `entities`, `selection`, `camera` — plus `catalogs` declared resident, plus
`tool` and `input` part-hollowed — plus `history`'s stayed half, which is a verb and an edge rather than a
cluster; the counts through T3c are re-derived at §2.5's sweep, not inherited); subtract
those rows from §4 when reading them
as current — the rows themselves are now marked, so the subtraction is a matter of skipping
the ones whose heading says EXTRACTED rather than of remembering a list. **The two rows
marked PARTIALLY HOLLOWED are the exception to that instruction and must not be skipped:**
they are live clusters whose edge lists are part stale, and each stale line is annotated
where it stands rather than removed. **So is the one marked DECLARED FACADE-RESIDENT**,
which is live, complete and staying — an unmarked row means "not yet reached".

**And foundations T3a, T3b1, T3c and T3d each changed things the map names.** §2.2, §2.3,
§2.4, §2.6, §2.7 and §2.8 record exactly what, and which numbers below are consequently
stale.
Read them before trusting a site list — and note that §2.5's "every `@line` anchor is
valid" reset applies only to rows T3d did not touch.

## 1. The shape of the file

Re-measured in full 2026-08-07 at the T3c review, commit `7bb353a5` (§2.5). The one row
still marked *(2026-08-03)* — the read-edge total — is the original pass and has **not**
been re-derived: re-deriving the read side is a full attribution sweep this review did not
run, and a number that looks fresh but isn't is worse than one that admits its date.

| Fact | Value |
|---|---|
| File total | **6,337 lines** (re-measured 2026-08-07 at the T3c review, commit `7bb353a5`). Was 7,345 at T3c's start — T3b2's net on this file is the +157 between that figure and T3b1's close, measured only as the difference of the two endpoints — then 6,329 after the session machine and the pointer chain, 6,337 after §2.4's honesty pass. Was 7,188 at the close of T3b1 (after the docs pass corrected the `FieldHost` seam preamble: **+13, every one a COMMENT line**), 7,175 after the layering move, 7,181 after `view` left, 7,165 after the `history` feed, 7,216 after `stats`, 7,228 after `props`, 7,276 after `voidcast`, 7,347 at T3a, 7,410 at the original pass. The layering move's own net was **−6** and pure import geometry: no cluster left, no statement changed — seven of this file's imports were re-pointed from `../frontend/lib/…` to `./…` or `../shared/…`, and four became short enough for the formatter to collapse a multi-line specifier list onto one line. |
| Code / comment / blank | **2,854 / 3,273 / 210** (re-measured 2026-08-07 at the T3c review, by the method below). T3b2 + T3c together took **−540 code**, the first triple-digit code delta in this table's history. Was 3,394 / 3,558 / 236 at the close of T3b1 (the docs pass moved the COMMENT column by +13 and nothing else), 3,394 / 3,545 / 236 after the layering move, 3,400 / 3,545 / 236 after `view`, 3,400 / 3,529 / 236 after the `history` feed, 3,429 / 3,550 / 237 after `stats`, 3,454 / 3,537 / 237 after `props`, 3,496 / 3,541 / 239 after `voidcast`, 3,554 / 3,554 / 239 at T3a, 3,620 / 3,551 / 239 originally. The layering move itself was **−6** code, zero comment, zero blank — the whole delta being the collapsed import lines. |
| `export function createFieldHost` | **line 1673** → end of file (**4,665 lines**) *(re-measured 2026-08-07; the SPAN finally moved — every earlier change shifted only the start line, and T3c's 1,016-line hole sits entirely below it)* |
| `return { … }` object literal | **line 5673** *(re-measured 2026-08-07)* |
| Closure-level bindings | **232** (re-measured 2026-08-07 at the T3c review by §2's rule — the closure still holds no top-level `if`/`for`/`while`/`try` and no `function` declarations, re-verified, so indentation level 2 is still exactly the closure scope). The split: **69 `let` / 163 `const`**, and the function/data split IS re-derived this time — **125 function-valued / 107 data**, where the data side is 95 cluster-owned bindings + the 3 containers extractions left behind as substrate value members (`propMeshes`, `ghostMeshes`, `voidCastMeshes`) + 9 module/infrastructure records (`substrate`, `router`, `props`, `segment`, `historyFeed`, `voidcast`, `viewState`, `machine`, `stats`). §6's per-cluster counts at head sum to exactly 125 functions and 95 cluster-owned state, which is the cross-foot the mixed-epoch record never had. Was 270 after `view`, 272 after the `history` feed, 275 after `stats`, 281 after `props`, 284 after `voidcast`, 289 at T3a, 293 originally. |
| `FieldHost` public members | **65** (re-verified 2026-08-07: 62 defined in the return literal, 3 shorthand re-exports of closure functions: `frameSelection`, `frameWorld`, `snapView`. Was 66 until foundations T3c deleted `commitSession` — zero production callers) |
| Clusters below | 23 *(2026-08-03)* — **14 still live at head** (12 whole; `tool` and `input` part-hollowed), plus `history`'s stayed half; the other 8 rows are EXTRACTED *(re-derived 2026-08-07)* |
| Cross-cluster **read** edges | 244 *(2026-08-03 — stale, see §2.2; deliberately NOT re-attributed at the 2026-08-07 sweep, see §2.5)* |
| Cross-cluster **mutation** edges | **70 edges over 71 write sites** at birth *(the unit correction is §5's opening note)* — at head **59 stand** (53 cluster-to-cluster in this file, 6 across a module boundary) and **11 are structurally gone** *(re-attributed per write site 2026-08-07, §5.7)* |

The line-count method behind the second row: strip blank lines, count a line as a comment if
its first non-space characters are `//` or if it lies inside a `/* … */` block, and count
everything else as code. The blank count reproduced the original pass exactly when the
method was first re-run, which is the evidence that the two methods agree; the 2026-08-07
figures are the same script unchanged.

Comment lines still OUTNUMBER code lines — 3,273 to 2,854, i.e. **53.4%** of every non-blank
line in the file is prose (51.2% at T3b1's close, exactly level at T3a, code led at the
original pass — the ratio keeps climbing because every extraction takes more code than prose
with it). That density is why the file reads as documented rather than merely large — but
the code alone is 2,854 lines, still ~7× the ~400-line file guideline in
`.claude/rules/clean-code.md`, and `createFieldHost` alone is ~93× the ~50-line function
guideline.

**Six clusters out and those ratios had not visibly moved** — which was the honest scale of
the problem until T3c: between the close of T3b1 and this review the FILE went 7,188 →
6,337 (**−11.8%**) and the CODE 3,394 → 2,854 (**−15.9%**), nearly all of it the session
machine and the pointer chain (T3b2's net on this file was +157 lines). The session machine
is the first extraction big enough to register against this table's own ratios, and it took
three rows to do it. Two different reductions, worth keeping apart because they answer different
questions. Per cluster: `voidcast` took **0.97%** off the FILE (71 of 7,347 lines) but
**1.63%** off the CODE (58 of 3,554); `props` took **0.66%** off the FILE (48 of 7,276) and
**1.20%** off the CODE (42 of 3,496); `stats` took **0.17%** off the FILE (12 of 7,228) and
**0.72%** off the CODE (25 of 3,454); the `history` feed took **0.71%** off the FILE (51 of
7,216) and **0.85%** off the CODE (29 of 3,429); `view` **ADDED 0.22%** to the FILE (16 of
7,165) and moved the CODE by **0.00%** (0 of 3,400). Cumulatively T3b1 stands at **−2.3%** of
the file and **−4.3%** of the code. The gap between the two figures is the point — a cluster's
prose leaves with it, and then the wiring left behind earns prose of its own, so the FILE
shrinks more slowly than the logic in it does. The code figure is the one that speaks to the
~400-line guideline, and at ~0–1.6% per cluster that guideline is not reachable by
extraction of this kind. `stats` is the case that says so most plainly: it removed the most
BINDINGS of the five and the fewest lines, because a cluster's size in bindings and its size
in lines are not the same measurement. The `history` feed is the one case where the two
figures nearly agree (0.71 / 0.85), and the reason is instructive: it is the only extraction
whose comment column fell as well, because the prose it moved was dense and the wiring note
that replaced it did not have a new shape to explain.

**And `view` is the case that breaks the metric.** It is a real extraction — two `let`s and a
function left the closure, and 25 read sites that used to reach into a shared binding now go
through a seam — and it moved the code column by nothing whatsoever. A cluster's LINE size and
its COUPLING size are independent quantities, and this row is where they part company
completely: 44 lines of code in `field-view.ts`, and the most invasive diff in the tranche.
Anyone sizing the remaining clusters by these percentages should read the `view` row in §6
first; the number that predicted this move's cost was its INBOUND read count, which appears in
no total on this page.

The easy extractions are already done. These sibling modules in the same directory are
already pure and are **not** part of the closure: `field-ghost`, `field-stamp`,
`field-placements`, `field-pick`, `field-move`, `field-flags`, `field-history`,
`field-selection-cells`, `field-camera`, `viewport-cursor`, `input-map`, `gizmo`,
`camera-control`, `box-edges`, `reference-grid`, and now `field-segment`, `field-voidcast`,
`field-props`, `field-stats`, `field-history-feed`, `field-view` and `field-machine` — the
last seven lifted out STATEFUL rather than discovered to be pure. `field-history-feed` is the sharpest illustration
of the difference: `field-history` was already in the pure list, and the feed had to become a
SEPARATE file because that module's header rules state out. What remains inside the closure is
the stateful residue.

## 2. How this map was produced

- **Enumeration.** Every `const`/`let` at indentation level 2 between lines 1659 and 7410.
  The closure body contains **no top-level `if`/`for`/`while`/`try`/bare block** and **no
  `function` declarations** — verified — so indentation level 2 is exactly the closure
  scope and the enumeration is complete at 293. The 211 declarations at deeper indentation
  are all locals inside nested functions or inside the return-object methods.
- **What it does not cover.** The `deps` parameter (`spawnWorker`, `spawnAnalyzer`,
  `requestContext`) is closure-scoped but is a parameter, not a binding, and is read-only.
  Destructured declarations (`const { a } = …`) at closure level: none exist.
- **Regions.** Each occurrence of a binding is attributed to the nearest preceding
  closure-level declaration or return-object member, which for a function-valued binding is
  its body.
- **Comments stripped** before matching, so the 3,551 prose lines cannot inflate a count.
- **Local shadows.** Exactly two nested locals shadow a closure binding — `const keys` at
  4462 inside `postMirrorSync` and `const dirty` at 4550 inside `analyzerFire`. Both were
  found and excluded; without that exclusion the map would report two phantom mutation
  edges (`camera.keys ← analyzer` and `world.dirty ← analyzer`) that do not exist.
- **Write detection** counts assignment (`x =`), compound assignment, `++`/`--`, indexed
  assignment, and container mutation (`.set` `.add` `.delete` `.clear` `.push` `.pop`
  `.shift` `.unshift` `.splice` `.sort` `.fill` `.copyWithin`) on a `const` binding.

### 2.1 Four corrections, from extracting `segment`, `voidcast`, `props` and `stats` against this map

All four were found by doing the work; all four would mislead the next extraction if left
only in the map's original terms.

- **`let`-vs-`const` decides what may be passed by value — NOT the read/MUTATION split.**
  When a cluster moves into its own module, every dependency the map classifies as a plain
  READ is still unsafe to pass as a value if it names a `let` that another cluster
  reassigns: the module gets a snapshot the host's later writes never reach. Worked
  example: `tool.digRadius` is recorded as a read by `segment` (§6, 2 sites) and carries no
  mutation edge, but `tool.applyRadius` reassigns it — passed as a number, the preview
  capsule would have gone on drawing at the radius held when the module was built while the
  committed op used the live one. It has to be passed as `() => digRadius`. §5's 58-`let`
  /12-`const` count is the right lens for this question; the mutation register is not.
- **Cross-cluster function CALLS are not counted as edges.** The edge counts throughout are
  over DATA bindings only, so every cluster understates its inbound coupling by however many
  sibling functions it invokes. `segment` is recorded with a single inbound dependency
  (`tool.digRadius`); extracting it needed three more — `targeting.selectionPoint`,
  `tool.reportToolError` and `tool.commitToolOp` — which is half its `deps` record and two
  partner clusters the "Partners: 3" figure does not name. Size a cluster off its edge count
  and you will be reading half its coupling. (Calls are cheaper to satisfy than data —
  all three of `segment`'s are `const` arrows, so they pass safely by reference — but they
  are still boundary surface, and a cluster whose neighbours' functions are numerous is more
  entangled than its row suggests.) **`props` is the loudest instance and it runs the other
  way**: its single INBOUND edge (`render.renderScene` reading `propMeshes`) understates a
  cluster that nine functions across six other clusters call `rebuildProps` on, plus a tenth
  calling `destroyProps`. Read as data, it is something the host occasionally looks at; read
  as calls, it is something half the host asks to run. So the understatement is not confined
  to a cluster's own dependencies — it applies to what depends on IT, and the outbound column
  is the one a reader is most likely to trust as a size. **And an uncounted call can be an
  ORDERING constraint, not merely coupling** (found 2026-08-06 by extracting `view`): `view`'s
  outbound column here lists exactly one edge, `world.dirty`, but `ret.setLayers` has always
  called `discardVoidCast`/`requestVoidCast`, so `createView` cannot be assembled above
  `createVoidCast`. A cluster planned as independent off this row would meet that fact as a
  build error partway through its threading pass. Extracting `view` LAST is what made the
  discovery free.
- **STRING LITERALS were not stripped, so a few read edges are phantoms.** The method note
  above says comments were stripped before matching; nothing says the same of strings, and
  nothing did it. Worked example, found by extracting `voidcast`: the map recorded
  `voidcast → tool.tool`, 1 site, `requestVoidCast`. Sweeping that function for a `tool`
  binding read finds none — the only occurrence is the WORD inside its budget refusal
  ("the X-ray is a region-scale tool, not a world-scale one"). The edge is deleted at both
  ends below. The class matters more than the instance: any single-site edge whose binding
  name is also an ordinary English word (`tool`, `store`, `dirty`, `log`, `stamp`, `table`,
  `view`, `drift`, `gesture`, `selection`) may be one of these, so **verify a single-site
  edge by grepping the named function before sizing a cluster off it**. Multi-site edges and
  edges on non-word names (`voidCastJobGen`, `analyzerDirty`) are unaffected.
- **A cluster's reads are MISFILED whenever its work lives in another cluster's function.**
  §2's method attributes every occurrence to the enclosing function's owner, which is right
  for a map of the file and wrong as a map of a cluster — the two differ exactly when a
  cluster's job is performed somewhere else. Worked example, found by extracting `stats`: its
  row records **2** inbound read edges, both `log`. The module needs **7**. The missing five
  are all in the stats payload, which was assembled inside `tick`, and four of them are IN the
  map — under `lifecycle`, with `tick` as their site (`store`, `lastRemeshMs`, `remeshVersion`,
  `voidCastJobGen`). The fifth, `analyzerPendingCount()`, is a call and so falls to the
  correction above. This is the mirror of that one: there, a cluster's coupling is invisible
  because calls are not edges; here, it is visible but **filed under the wrong cluster**, so
  grepping the row cannot find it either. The tell is a cluster with few functions and a
  public seam — `stats` owned ONE function and one `subscribe*` member, and its actual work
  was twenty lines in someone else's loop. **Before sizing such a cluster, grep for its state
  in every other cluster's site list**, not just its own row.

### 2.2 Changed since the measurement pass — foundations T3a, 2026-08-05

Three changes land inside the closure the map describes. Each is recorded here rather than
smeared across §6, because the honest correction for most of the affected rows is "this
site no longer exists", not a re-count nobody has done.

- **`escapeLadder` is DELETED**, and its reads moved. The five-rung chain became a capture
  STACK (`packages/editor/src/field-host/input-router.ts`): a state acquires an entry
  when it goes live and releases it in the same canonical setter that clears it, so the Esc
  reads that used to sit inside one `input`-cluster function now sit inside each state's own
  setter — `setBoxAnchor`, `setPendingStamp`, `setSelection`, `setSelectedEntity` and
  `cancelStampSession`, plus the segment brush's own capture in `field-segment.ts`.
  `input.onKeyDown`'s Esc branch reads exactly one thing now, `router.escape()`.
  **Consequences for the map:** the `input` cluster owns **12** functions, not 13; every
  site list in §6 that names `escapeLadder` is marked `†` below and its count includes
  occurrences inside a function that is gone; and `input`'s 59-edge row in §4 is high by
  however many of those there were. The reads did not disappear from the closure — they
  moved to a different cluster's function — so this redistributes edges rather than
  removing them, which is exactly why re-deriving the totals is a real pass and not an
  arithmetic fix.
- **The thirteen `subscribe*` seams are `ViewChannel`s.** Each `let …Cb: ((…) => void) | null`
  slot became a `const …Channel = createViewChannel(…)`
  (`packages/editor/src/field-host/view-channel.ts`). The §6 state lists name the new
  bindings, with declaration lines re-measured at T3a. This matters to §2.1's rule and to
  §7.3's mechanism: a seam is now a `const` whose identity never moves, so it is safe to
  pass BY VALUE to an extracted module — thirteen bindings crossed from the `let` column to
  the `const` one, and an extracted cluster can hold its own channel directly instead of
  taking a `() => cb` thunk. No mutation edge in §5 targets a seam, so the 58-`let`/12-`const`
  split there is unaffected.
- **Line numbers have drifted.** The file grew from 7,248 (post-`segment`) to 7,347. Every
  `@line` in §6 is the 2026-08-03 measurement **except** the thirteen seam bindings, which
  were re-measured with their rename. Treat the rest as ±100 and grep by name.

### 2.3 Changed since T3a — foundations T3b1, 2026-08-06

Five clusters left the closure and one left in half; §1's opening paragraph names each and
its new module. Three notes for anyone reading §4–§6 as current:

- **Line numbers have drifted AGAIN, and further than T3a's ±100.** The file went 7,347 →
  7,175 across the five extractions, then → 7,188 at the docs pass. Sites below the first
  extraction point have moved by roughly **−130 to −160**; sites in the gesture/session
  region measured on 2026-08-05 have moved by about **−145**, then **+13** at the docs pass.
  Every `@line` in §6 is stale unless its row says otherwise. **Grep by name.**
- **Nothing in the chrome collapse (Task 7) or the rename (Task 8) touched the closure.**
  Task 7 is entirely inside `frontend/hooks/useFieldHostState.tsx`; Task 8 moved the
  directory and rewrote import specifiers. No binding, no edge, no cluster boundary moved
  for either — which is why neither appears in §1's history column except as the 6-line
  import collapse.
- **The bar the extractions actually settled** is recorded in
  `docs/reference/editor-architecture.md` §21.1, not here: the substrate's two-extracted-
  readers rule governs ADDING a member and never declining one already declared, and state
  that acquires an owner leaves the closure rather than joining the record (`view` is the
  first instance). §7.3's recommended shape should be read against that section now.

### 2.4 Changed since T3b1 — foundations T3c, 2026-08-07

T3c moved TWO things, on the same day and into the same module, and the second is the one a
reader of §4–§6 is most likely to be caught by.

**First, `stamp`, `move` and `gesture` left together**, into `field-machine.ts`; §1's opening
paragraph names the module and §6's three rows record what each took.

**Then the POINTER CHAIN followed** — the bodies of `onPointerDown`, `onPointerMove`,
`onPointerUp` and `onPointerCancel`, i.e. pointerdown's seven-way arbitration, pointermove's
six-way, and the pair that end a gesture. The listeners themselves stayed (`attachListeners`
owns the canvas element), so the four functions are still declared in `field-host.ts` as
one- and two-line delegates onto `machine.pointerDown/Move/Up/Cancel`. The rule that drew
that line is stated in the module: **most of what those branches TEST is the machine's own
state** (a live move, a pending stamp arm, the armed gesture, a stroke in progress), so the
chain follows the state; every branch's VERB stayed with its cluster and arrives as a dep
(`eyedropper`, `applyTool`, `selectionClick`, `pointerPress`, the segment brush's three).
Three branch tests are NOT the machine's — `camera.look`, `selection.boxAnchor`,
`segment.segmentAnchor` — and they travel the other way, as liveness thunks. `MachineDeps`
went 22 → 39 members, which is a measurement of what the chain was already reaching for.

Two more bindings went with it (`tool.digging`, `tool.lastStroke`), and the DOM's pointer
capture became one thunk pair in `field-host.ts` (`capturePointer` / `releasePointer`)
called from four sites — three in the chain, one in `pointerPress`.

**`tool` and `input` are consequently the first PARTIALLY HOLLOWED rows in §6**, and §1's
"skip the rows whose heading says EXTRACTED" instruction does not reach them: both clusters
are still live, so skipping them under-reports, while reading them as measured over-reports.
Both headings now say PARTIALLY HOLLOWED, and both rows carry a per-edge annotation saying
which edges are gone, which are re-homed inside the file, and which merely changed module.
§5.2's table has the same annotation as a `Status` column. **Per-site COUNTS are not
re-derived anywhere** — that is a full attribution sweep (§1's rule), not something this
change was in a position to do honestly; the annotations are per-BINDING and are exact at
that grain.

Four further notes for anyone reading §4–§6 as current:

- **Line numbers have drifted a THIRD time, and this one is not a uniform shift.** The file
  went 7,345 → 6,329 — a 1,016-line hole opened where the session machine was, so every
  `@line` in §6 below the state block is short by a different amount depending on which side
  of the extraction it sat. Do not interpolate. **Grep by name**, as §2.3 already said and
  this makes non-negotiable. The pointer chain's move a few hours later was net **+1** on
  this file (6,328 → 6,329, and **6,337** after this section's honesty pass) and drifted the
  lines a fourth time anyway: ~150 lines of chain left the input handlers near the bottom and
  a comparable number arrived ~3,000 lines higher up, as the look-drag and pointer-capture
  verbs the machine could not take and the prose that says why. A net-zero file is not an
  unchanged one.
- **The three rows are the first EXTRACTED rows whose cluster boundary was wrong as drawn.**
  Every earlier extraction took a row and moved it. These three could not be moved
  separately at all — §7.2 had already recorded why (`stamp` and `move` share one slot) and
  §7.5 had scored the merge table that says every pairing internalises fewer edges than it
  inherits. The as-built is that table's bottom row minus `history`: one module, three rows'
  worth of state. A reader sizing future work off §4 should treat "cluster" as a unit of
  MEASUREMENT here and not as a unit of extraction.
- **§7.3 step 3 was never built and is no longer needed.** The recommendation was "a small
  internal store for the interactive middle — `stamp`+`move`+`gesture`, `tool`, `camera`,
  `selection`", on the reasoning that passing those `let`s by value forks and passing them as
  sub-hosts means every sub-host needs a reference to every other. The first three went into
  ONE module instead, which internalises the forking problem rather than solving it in a
  shared substrate. `tool`, `camera` and `selection` are still in the closure and the
  recommendation still stands for them, if it is ever collected on.
- **The Esc rung mechanism moved out of the closure too**, to `createRung` in
  `input-router.ts`, and `field-segment.ts` dropped its hand-rolled handle slot for it in the
  same change. Seven rungs now stand across three modules on one implementation. That is not
  a cluster edge — no row here counts it — but it is the thing that made a cluster owning
  cancellable state extractable at all, and §7.5's last paragraph names the teardown edge it
  closes.

### 2.5 Re-derived in full at the T3c review, 2026-08-07 (commit `7bb353a5`)

The first full sweep since the map's birth, and the section that resets the reading order.
What it re-derived, and what it deliberately did not:

- **Every `@line` anchor below is valid at commit `7bb353a5`.** Every declaration line in
  §6's live rows and every site line in §5 was re-grepped by name against the code at head,
  not interpolated. The §2.2–§2.4 caveats — "treat as ±100", "grep by name", "every `@line`
  is stale unless its row says otherwise" — are **superseded by this sweep for everything
  below**: they described drift this section has now paid off. They remain the correct
  description of the mechanism, so they will become true again at the next edit; what this
  section resets is the clock, not the physics.
- **§1's measured rows, §4's state / function / public / mutation columns, and the WHOLE of
  §5 are re-derived from the code at head.** The §5 register was re-attributed **per write
  site, for the first time since birth** — which is what licenses the corrections §2.2 and
  §2.4 explicitly declined to make ("re-deriving the totals is a real pass", "per-site
  COUNTS are not re-derived anywhere"). The pass has now been run.
- **The read side was NOT re-attributed.** §1's 244 and §6's per-site READ lists keep their
  birth epoch and their per-edge annotations; re-deriving those is the remaining half of
  the "real pass" and nothing below pretends otherwise. The §6 site lists are still
  mixed-epoch on reads — that hazard (§6's `history` row states it) stands.
- **The register's 70-vs-71 was a UNIT collision, not a miscount** — the opening line
  counted target × writer-function PAIRS, §5.4's header counted SITES, and exactly one pair
  has two sites. §5's opening note carries the arithmetic; the correction is licensed by
  this re-audit and by nothing earlier.
- **A second phantom-edge CLASS instance surfaced**, in a row nobody had touched:
  `tool ← selection`, 5 sites in `toolMask` — every one a string literal or a property key,
  and verified phantom **at the production commit too** (`b507d3f6`), so the edge was born
  wrong rather than gone stale. `toolMask` reaches the selection through
  `currentSelectionSpec()`, a call, which the edge counts never see. Both ends are struck in
  §6, and §2.1's "verify a single-site edge" rule now demonstrably under-reaches:
  this one had FIVE sites and was still all phantom, because one sentence of user-facing
  prose can hold the word twice.

### 2.6 Changed since the T3c review — foundations T3d Task 1, 2026-08-07

Three clusters left and a fourth was DECLARED to stay. The declaration is the part a
reader of §4–§6 should notice first, because it is a new kind of row: `catalogs` is not
extracted, not partially hollowed, and not un-examined — it was probed and the verdict is
that it belongs where it is, recorded at source in `field-host.ts` at `table`'s
declaration. **An unmarked row from here on means "not yet reached", and a row marked
FACADE-RESIDENT means "reached, and it stays".**

- **`targeting` → `field-targeting.ts`, `picking` → `field-picking.ts`, `drift` →
  `field-drift.ts`.** All three rows are complete extractions: every binding and every
  function moved. §6's rows carry what each one's seam actually became.
- **Two rows shrank on the way out, and the shrinkage is the interesting measurement.**
  `targeting` is counted at 6 functions and exports 5 + 2 pointer members — `toNdc` has
  one caller inside the module and is private there. `picking` is counted at 4 functions
  and exports **ONE**: each of the first three had exactly one caller, the next one down,
  so the cluster was a pipeline the closure had no way to say was a pipeline. A row's
  function count is a measure of the cluster, never of the seam it will need.
- **`drift` was the row the map itself called un-cluster-like** (§3.3: a result slot whose
  every write comes from elsewhere) and it extracted cleanly anyway, because §3.3's own
  wording contains the rule: **the READERS decide.** Both of its readers went with it; the
  four writers share a two-verb seam (`set` then `notify`, in that order, because
  notifications go last).
- **A HALF-STRUCK edge surfaced, and the half is the finding.** `picking → input.canvasEl`,
  1 site in `pointerPress`, is GONE and has been since T3c: the DOM pointer capture became
  the host's `capturePointer` thunk, so the function reaches the canvas through a CALL and
  names the binding nowhere. The `input` row **already recorded the strike**; the `picking`
  row did not, and stood at 8 inbound reads until this task. Not a §2.1 phantom — the edge
  was real when measured. What it demonstrates is narrower and more useful: **a strike
  applied at one end of an edge does not reach the other**, because §6 lists every edge
  twice and nothing checks the pair. Both ends now say it, and the same hazard applies to
  every annotation this document has ever made per-row.
- **Line numbers have drifted a FIFTH time, and §2.5's clock is reset only for rows this
  task did not touch.** The file went 6,337 → **6,068** (code 2,854 → **2,621**);
  `createFieldHost` spans 4,402 lines from **1,667**, its `return {` is at **5,398**, and
  the closure holds **219** bindings (67 `let` / 152 `const`) against 232 — 16 left, 3
  module records arrived, and the record count is now **12**. Sites below ~2,600 have moved
  by roughly −280. **Grep by name**, as always.
- **The register's TALLY is unchanged and its DISPOSITIONS are not.** No edge became
  structurally gone; five changed which kind of boundary they cross. §5.7 carries the
  arithmetic.

### 2.7 Changed since Task 1 — foundations T3d Task 2, 2026-08-07

One cluster left, and it is the biggest single one this map has ever recorded moving:
**`analyzer` → `packages/editor/src/field-host/field-analyzer.ts`**, 18 of its 19 state
bindings and all 14 of its functions, plus the worker handle, the flags channel and four
module-scope constants. Five things a reader of §4–§6 should take from it.

- **A FOURTH SUBSTRATE LEFTOVER, and it is the row's whole judgement.** `flagStore` did not
  travel. It is a `HostSubstrate` VALUE member and the substrate is assembled at the top of
  the closure, ~1,800 lines above where the advisor is now constructed — a record whose
  value side is read eagerly cannot be built above one of its own members, which is exactly
  why T3b1 hoisted this declaration out of the advisor block in the first place. It also has
  TWO extracted readers now (`field-analyzer.ts` and `field-picking.ts`, both through
  `substrate.flagStore`), so it is shared state rather than one cluster's private store. It
  therefore stays a closure `const`, beside `propMeshes`, `ghostMeshes` and `voidCastMeshes`
  — which §1's accounting already classifies as substrate leftovers rather than as cluster
  state. **The force differs from theirs and the difference is worth keeping straight:** the
  three containers stay because `renderScene` DRAWS them; this one stays because the
  substrate has to HAND IT OUT before its owner exists. The verdict is recorded at source,
  at the declaration in `field-host.ts`, and at both ends of §6's rows.

  **That "different force" half EXPIRED at Task 3 (2026-08-08), exactly as tagged.**
  `render` left for `field-render.ts`, so the three containers are now read by an EXTRACTED
  module through the substrate — structurally what `field-analyzer.ts` and `field-picking.ts`
  already did with `flagStore`. The two forces converged and the distinction dissolved. What
  survives is the plain fact that they are substrate leftovers, and the list is now **FIVE**:
  Task 3 added `litByClass` by a THIRD route neither force describes — its owning cluster
  left and the record already named it, so it could not follow. Both `field-host.ts`
  declarations were rewritten in the same commit and the Task-3 migration tag is retired at
  both ends, so the marker grep no longer finds it anywhere.
- **EXTRACTION CONVERTS INBOUND READS INTO CALLS, not only mutations.** §5.7 has said since
  T3d Task 1 that a tranche converts cluster-to-cluster MUTATION edges into module
  boundaries rather than deleting them. The read side does something different, and this row
  is the first big enough to show it: of the ten edges in this cluster's *read by* list,
  **seven are now CALLS** — `analyzePump`'s four sites became `noteDensityWritten` /
  `requestPass`, `analyzerIdle`'s and `analyzer`'s three became `dispose()`, and
  `flagStore`'s `ret.init` read became `rebuildMarkers()` — **two survive as reads through
  the module record** (`renderScene` asks `advisor.markerMesh()` and `advisor.selectionBatch()`)
  and **one is unchanged** (`picking`, already on the substrate). A call is not an edge here
  (§2.1's second correction), so seven edges leave the read side of this map and reappear
  nowhere. Anyone re-deriving §1's 244 after this tranche should expect the total to fall
  much faster than the coupling does.
- **ONE READ EDGE WAS RE-HOMED RATHER THAN MOVED**, on the `camera.look ← input` precedent
  (§5.2): `analyzer → camera.orbitState`, 1 site in `selectFlagImpl`, is **struck**. The
  module does not name the binding at all. Its two lines were `aimCamera(frameBox(orbitState,
  box))` + `applyOrbit()`, which is the CAMERA's composition over the camera's own state, so
  they stayed on the host side behind one named dep (`frameCameraOn`) and the advisor now
  hands over a box. The same shape retired `aabbEdgeBatch` + `SELECTED_COLOR` on the
  selection side (`selectionOutline`), though neither of those was ever a counted edge. The
  rule this demonstrates: **a read whose only purpose is to be an ARGUMENT to a neighbouring
  cluster's own composition is that cluster's act, not this one's dependency.**
- **THE SEAM IS BIGGER THAN THE ROW.** `field-analyzer.ts` exports **18 verbs** against the
  row's 14 functions and 6 public members. The surplus is the 14 inbound MUTATION edges,
  every one of which is now a call named for the ACT it performs. §2.6 recorded `picking`
  going the other way (4 functions, ONE verb) and drew half the conclusion; this row is the
  other half. **A row's function count measures the cluster; what its neighbours WRITE into
  it measures the seam.** Sizing an extraction's interface off §4's `Fns` column will
  under-read every heavily-mutated row and over-read every pipeline.
- **Line numbers have drifted a SIXTH time, and this is the largest single hole yet.** The
  file went 6,068 → **5,688** (code 2,621 → **2,372**, comment 3,247 → **3,132**, blank 200
  → **184**); `createFieldHost` spans **4,055** lines from **1,634**, its `return {` is at
  **5,055**, and the closure holds **190** bindings (**54 `let` / 136 `const`**) against 219
  — 32 left, 1 module record arrived, and the record count is now **13**. The DATA side is
  93: 76 cluster-owned bindings + **4** substrate leftovers + the 13 records, unchanged by
  this task's two additions because both are functions. Those two are the arithmetic's only
  surprise and they are a deliberate handoff: `frameCameraOn` (the camera's frame-on-a-box,
  `camera`'s, Task 4's) and `selectedBoxOutline` (the `--primary` outline both the entity
  box and the flag cell wear, `selection`'s, Task 5's) were each written as an anonymous
  arrow in the advisor's deps literal at first, and a review made the point that an extraction
  which argues at length that a composition belongs to another cluster should not then leave
  it somewhere that cluster cannot grep for. Each is now a NAMED function with two callers,
  beside its twin. A ~380-line hole opened between the `createView` assembly and the pointer
  pick, so sites below it have moved by roughly −380 and sites above it not at all. **Do not
  interpolate; grep by name.**
- **The per-cluster reduction figures in §1 finally have an outlier at the top.** `analyzer`
  took **6.3%** off the FILE (380 of 6,068) and **9.5%** off the CODE (249 of 2,621) — an
  order of magnitude past the 0–1.6% band every T3b1 row sat in, and the first extraction
  where the FILE percentage and the CODE percentage are close together at a large value.
  `field-analyzer.ts` is **951 lines** (347 code / 578 comment / 26 blank), i.e. the cluster
  left with **1.7 lines of prose for every line of code**, which is why the host's comment
  column fell by only 115 against a code column that fell by 249: extraction moves code out
  faster than prose, and then both files write more prose about the new boundary.
- **§1's table is now two tasks stale and deliberately so** (three after Task 3), on Task 1's precedent: the
  measured rows there are the T3c review's epoch and the deltas live in §2.6 and here. Two
  of its cells are wrong if read as current — "14 still live at head" and "the other 8 rows
  are EXTRACTED" are T3c figures. **After Task 3 (2026-08-08) §4's twenty-three rows split
  exactly as follows, and the arithmetic is checkable against the table itself:** **14
  EXTRACTED**, **1 FACADE-RESIDENT** (`catalogs`), **2 PARTIALLY HOLLOWED** (`tool`,
  `input`), **1 half-stayed** (`history`), and **5 untouched and whole** — `world`,
  `lifecycle`, `entities`, `selection`, `camera`, which are precisely the clusters Tasks 4–6
  own. 14 + 1 + 2 + 1 + 5 = 23. T3d's closing task re-derives the table.
- **THE WHOLE OF §5'S LINE COLUMN WAS RE-DERIVED HERE**, §5.1 through §5.5, by grep and not
  by interpolation. It needed it: §5.1's entries were 5,680–5,821 against a file that is now
  5,688 lines, i.e. every anchor in the teardown table pointed past the end of the file it
  maps — which matters more than the usual drift because §5.1 is what a lifecycle extraction
  reads first and the T3 exit clause is judged partly off it. §5.2's column had been stale
  since T3d Task 1 (which said so and left it); §5.3's and §5.5's were a mixture. **§6's
  `@line` anchors were NOT re-derived** and are left on Task 1's precedent — every one below
  the ~3,820 mark is short by roughly 430, and the row that owns the biggest block of them
  (`analyzer`) now says at source that its anchors are the pre-extraction record. Grep by
  name. **Two §6 anchors ARE fixed** because this task moved the bindings rather than merely
  shifting them: `materials.flagMarkerMat`/`flagMarkerBind` (the state block above them
  grew) and `world.worldEpoch`, which was DECLARED inside the advisor block and had to be
  relocated above the assembly so its thunk reads a binding declared above it.
- **The tests that pin the density-mirror wire are all in the GPU lane**, measured at this
  extraction rather than assumed: deleting the host's `noteDensityWritten` call leaves
  `field-host-analyzer.test.ts`, `field-host-flag-select.test.ts` and `analyzer-verify.test.ts`
  fully green (29/29) and reddens five tests in `field-host-analyzer.gpu.test.ts` alone.
  Structural, not an oversight — reaching that path from a DIG needs a device. Recorded in
  `field-analyzer.ts`'s header so a green CPU run is not read as covering the mirror.
- **The register's TALLY is unchanged and 14 dispositions moved.** No edge became
  structurally gone. §5.7 carries the arithmetic.
### 2.8 Changed since Task 2 — foundations T3d Task 3, 2026-08-08

Two clusters left, at opposite ends of the same fan: **`materials` →
`packages/editor/src/field-host/field-materials.ts`** (16 of its 17 state bindings and all 7
of its functions) and **`render` → `packages/editor/src/field-host/field-render.ts`** (all 5
bindings and all 5 functions, nothing left behind). Seven things a reader of §4–§6 should
take from it.

- **A FIFTH SUBSTRATE LEFTOVER, and it arrived by a route neither earlier one describes.**
  `litByClass` did not travel. It is this cluster's PRIVATE cache — nothing outside its four
  functions has ever read it — so §2.3's rule ("state that acquires an owner leaves the
  closure rather than joining the record") points it straight into the module. It could not
  go, because it is ALREADY a `HostSubstrate` VALUE member: T3a declared it there ahead of
  any consumer. Removing a member is a different decision from declining to add one — the
  two-extracted-readers bar governs ADDITIONS (`field-props.ts` says so at `archetypeById`)
  — and paying for a tidier record by editing a behavioural fixture is not a trade this
  tranche's bar permits. So the leftover list is `propMeshes`, `ghostMeshes`,
  `voidCastMeshes`, `flagStore`, `litByClass`, and the three routes onto it are now: **the
  container an extracted module fills and another draws** (the first three), **the handle
  the substrate must hand out before its owner exists** (`flagStore`), and **the member the
  record already named when its owner left** (this one). §2.7's "different force" note is
  retired above; this is what replaced it.
- **AND THE COST OF THAT REMOVAL WAS MEASURED, WHICH TURNED A 4:1 OVERSTATEMENT INTO A
  BETTER FINDING.** The first write-up of the row said four test files name `litByClass` in
  their own `HostSubstrate` literals, so removing it would break four. Deleting the member
  and running `tsc --noEmit` says otherwise: **8 errors, exactly ONE in a test** —
  `tests/field-host/field-history-feed.test.ts:57`, the only one that passes its literal
  straight to `createHostSubstrate` and so gets excess-property checking. The other three
  (`field-view.test.ts:63`, `field-stats.test.ts:69`, `substrate.test.ts:42`) build it
  inside a spread helper (`otherSubstrateMembers()` / `frozen()`), which that check does not
  reach. **The conclusion is unchanged — one forced test edit is still one too many for this
  tranche's bar — but the reason is more interesting than the one first written: three of
  the four sites would go SILENTLY STALE rather than red**, carrying a member of a type that
  no longer has one. That is `substrate.ts`'s own failure class (a value that goes on
  describing a world which has moved) appearing in the TEST SCAFFOLDING rather than in
  production code, and it is the thing to know before a later tranche concludes a substrate
  member is safe to remove because the tests would catch it. Recorded at source in
  `field-materials.ts`'s header and at the declaration.
- **A §2.1 PHANTOM was predicted by the plan and refuted at source.** §6's `materials` row
  records a read of `stamp` in `stampGhostMaterial`, which would have forced
  `createMaterials` to depend on a machine assembled ~1,670 lines below it. Grepping the
  function finds no such read: its entire body is a null guard and a return, and the only
  occurrence of the word is inside its own throw message — `"field-host: stamp ghost
  material not initialized"`. `stamp` is on §2.1's own list of binding names that are also
  ordinary English words. **The edge is struck at both ends**, `materials` has THREE outbound
  reads and not four, and the assembly needed no forward reference at all. Worth noting how
  it was found: not by the rule, but by writing the deps record and asking what each entry
  was for.
- **BOTH SEAMS ARE THE OPPOSITE SHAPE FROM EACH OTHER, and between them they close §2.6's
  and §2.7's argument.** `field-materials.ts` exports **14 verbs** against a row of 7
  functions + 1 public member — and the surplus is neither mutations (§2.7's mechanism) nor
  pipeline collapse (§2.6's): FIVE of the extra verbs are inbound READS, the six bindings
  other clusters read off this cluster, collapsed onto accessors — `kitMat`, `flagMarker`,
  `selectionCell`, `ghostCube` and `shading`, FIVE bindings behind five verbs (a sixth
  accessor, `kitInstanced`, is a second spelling of `kitMat`'s handle rather than a sixth
  binding — which is why the module's own header counts eight accessors over seven handles).
  `field-render.ts` exports
  **ONE** verb against 5 functions, `picking`'s shape at four times the width — its four
  helpers each have exactly one caller (the fifth), and the fifth has exactly one (`tick`).
  So the third mechanism is now on the board: **a row's function count measures the cluster;
  its MUTATED-BY column, its READ-BY column, and its internal call graph each measure the
  seam, and they can disagree in both directions at once.**
- **`render`'s deps record is 29 members and every one is a READ.** That is the §5.6
  zero-mutation row doing work: a record this wide would be a coupling smell if any entry
  were a write-thunk. Eleven of the 29 name closure state that Tasks 4–6 will give owners
  (`digRadius`, `isKitFillTool`, `cameraEye`, four selection batches + `boxAnchor`,
  `entitySelectionBatch`, `gizmoBatch`, `gizmoVisible`); each is a NARROW named thunk, so
  those tasks cost one line each at the ASSEMBLY and nothing inside the module. The rule
  that buys: **a deps record that names what it reads survives its neighbours' extractions;
  one that names WHO it reads from is rewritten every time somebody else moves.**
- **THE TEARDOWN SPLIT IN TWO, and §5.1's fifteen-row block is now one call — plus a
  second.** `ret.dispose` frees GPU objects inside `if (c)` and nulls the slots OUTSIDE it,
  so a host disposed before `init` still forgets its handles. One verb could not cover both
  guard levels, so the seam is `materials.destroy(c)` (inside the block, beside
  `props.destroy(c)` and `advisor.destroyMarkers(c)`) and `materials.release()` (after it).
  `field-analyzer.ts` hit the identical shape one task earlier and split it the identical
  way. The register's biggest single fan-out is therefore **15 edges through 1 call**, not
  15 setters and not 1 verb.
- **THE COVERAGE MEASUREMENT IS THE UNCOMFORTABLE PART, and both module headers carry it.**
  Measured at this extraction against the editor suite (1469/0): deleting `setShading`'s
  re-material loop is **fully green**; making `buildLitMaterials` fill a private map instead
  of `substrate.litByClass` — the exact photograph `substrate.ts` describes — is **fully
  green**, because `bucket()`'s only production caller is `applyMesh` inside `remeshOne`'s
  `try`, which swallows the throw into a `console.warn`; and making `renderScene` draw
  NOTHING is **fully green** — while the function is provably reached (instrumented, 33
  calls). Two probes do redden: cutting the `voidCastMaterial` wire takes 3 tests in
  `field-host-void-cast.gpu.test.ts` + `field-host-reinit.gpu.test.ts`, and throwing
  mid-frame takes exactly one, `tests/bundle.gpu.test.ts`'s project-first gate. **So the
  suite pins that the frame RUNS, not what it DRAWS**, and it pins one of the material
  layer's fourteen verbs. Both files say so at the top; §5.6's "pure readers" rows are
  cheap to extract and expensive to verify, and the second half of that was not previously
  written down anywhere.
- **Line numbers have drifted a SEVENTH time.** The file went 5,688 → **5,237** (code 2,372
  → **1,979**, comment 3,132 → **3,092**, blank 184 → **166**); `createFieldHost` spans
  **3,653** lines from **1,585**, its `return {` is at **4,619**, and the closure holds
  **159** bindings (**38 `let` / 121 `const`**) against 190 — 33 left, 2 module records
  arrived, and the record count is now **15**. **The drift is in FOUR steps, measured at
  stable anchors rather than interpolated**, which is why no single offset works anywhere:
  −45 above the substrate assembly (the state-block and module-constant deletions), −198
  from `createProps` down (the material-function hole at ~2,200), −190 from `createAnalyzer`
  down (the same, plus prose added at the pivot), and **−436 from `createStatsMeter` down**
  (the render-function hole at ~4,070 on top of the rest). **Do not interpolate; grep by
  name.** `field-materials.ts` is **581** lines (253 code / 315 comment / 13 blank) and
  `field-render.ts` is **702** (298 / 390 / 14) — so 1,283 lines of module against 451 lines
  off the host, the widest such ratio in the tranche and the ordinary consequence of both
  files writing new prose about a boundary that did not previously need arguing.
- **THE MEASUREMENT INSTRUMENT IS DISCLOSED, because its data/function split differs from
  this document's by one.** All figures above were produced by ONE script run against BOTH
  `c4ef58a2` and this commit. At `c4ef58a2` it reproduces §2.7 exactly on span (4,055),
  `return {` (5,055), bindings (190 = 54 `let` / 136 `const`) and records (13) — but splits
  the non-record bindings 96 functions / 81 data where §2.7's arithmetic implies 97 / 80.
  The discrepancy is a CLASSIFIER definition, not a change in the file; the likely candidate
  is `unbindCamera`, a function-TYPED `let` slot that §5.1 treats as state. The deltas are
  instrument-independent and are what this section asserts: **−12 function bindings** (=
  `materials`' 7 + `render`'s 5), **−21 non-record data bindings** (= `materials`' 16 that
  moved + `render`'s 5), **+2 records**. On this instrument the data side is **75** = 55
  cluster-owned + 5 substrate leftovers + 15 records, against 94 = 76 + 5 + 13 before.

## 3. Where the public-surface hypothesis was wrong

The clusters were first hypothesised from the `FieldHost` type. Following the code changed
four things:

1. **The surface is 66 members, not 56** (65 at head — foundations T3c deleted
   `commitSession`; the figure here is the hypothesis-epoch one). The hypothesis omitted two whole families: the
   **walkability advisor** (`setAgentProfile`, `subscribeFlags`, `setFlagFilters`,
   `verifyFlag`, `selectFlag`, `flagMarkerCount`) and the **telemetry channels**
   (`subscribeStats`, `isLooking`, `subscribeCameraPose`, `subscribeSegmentHud`). It also
   omitted `selectionCellCount` and `exportArtifact`.
2. **"drift / analyzer" is not one cluster.** They share no state and no function. `drift`
   is the reconfigure-drift report produced by `applyReconfigureSession` and `stepHistory`;
   the analyzer is the walkability advisor with its own worker, store and 19 state
   bindings. They are split below into `drift` (2 bindings) and `analyzer` (19 bindings).
3. **`drift` is a result slot, not a cluster.** All three writes to `drift` come from
   *other* clusters (`stamp`, `history`, `world`); nothing in the `drift` cluster writes it.
4. **Ten clusters exist that the public surface does not name at all**, because they are
   internal: `materials`, `world`, `targeting`, `picking`, `render`, `input`, `props`,
   `view`, `voidcast`, `move`. Between them they hold 60 of the 132 data bindings. A map
   derived only from the public members would have missed nearly half the state.

## 4. Clusters at a glance

Ordered by distinct-cluster coupling degree (how many other clusters touch its state, or
whose state it touches).

Re-derived 2026-08-07 (§2.5) in the State, Fns, Public and mutation columns; the Partners
and Edges columns keep their birth epoch except where a row shows an arrow, because the
read side was not re-attributed. The mutation column's dispositions come from §5's per-site
sweep.

| Cluster | State | Fns | Public | Partners | Edges | of which mutations |
|---|---|---|---|---|---|---|
| `world` | 8 | 14 | 5 | 18 | 94 | 17 — **all 17 stand**; **10 now cross a module line** — `dirty ← view` since T3b1, `drift.drift` since T3d Task 1, and the **nine** into `analyzer` since T3d Task 2 |
| `stamp` | 7 → **1** (`ghostMeshes` stayed — substrate) | 19 → **0** | 11 (12 until `commitSession` died) | **13** | 45 | 6 — **EXTRACTED 2026-08-07** (`field-machine.ts`, with `move` + `gesture`); at head **2 stand as cross-module calls** (`setDrift`, `noteReconfigureMs` — §5.5) and **4 are gone**, internalised |
| `render` | 5 → **0** | 5 → **0** | 0 | 13 | 30 | 0 — **EXTRACTED 2026-08-08** (`field-render.ts`, T3d Task 3); nothing stayed. Its 30 read edges all became module reads: 4 through the substrate, 26 through a 29-member deps record. Its SEAM is **ONE** verb — `picking`'s shape at four times the width (§2.8) |
| `lifecycle` | 5 | 1 | 2 | 11 | 76 | 24 — **all 24 stand** (§5.1); **3 cross a module line since 2026-08-07** — the analyzer flags `ret.dispose` re-arms, now one `advisor.dispose()` call |
| `input` | 2 | 13 → **14** (12 of the original 13 — `escapeLadder` deleted — plus the capture pair) | 1 | 10 → **3 clusters** (`tool`, `camera`, `targeting`) **+ the machine module** | 59 → **23** (10 reads out, 1 read in, 12 writes out — re-derived; the 8 machine-accessor read sites and the four handler delegations are CALLS and counted nowhere, per the map's own rule) | 20 → **12** — **PARTIALLY HOLLOWED 2026-08-07**: all 12 in this file, keyboard/wheel/`lastPointer` (§5.2) |
| `catalogs` | 3 | 0 | 3 | 10 | 26 | 2 — both stand · **DECLARED FACADE-RESIDENT 2026-08-07** (T3d): probed and it stays — 0 functions, and all three setters are facade members. `table()` + `archetypeById()` already ride the substrate; `archetypes` is barred from it (one extracted reader) and rides as a function dep. Verdict at source, `field-host.ts` @1739 |
| `entities` | 8 | 9 → **10** (+its Esc-rung sync, `syncSelectedEntityCapture`) | 8 | 9 | 28 | 0 |
| `selection` | 9 | 17 → **19** (+2 rung syncs) | 4 | 9 | 21 → **19** (two phantoms struck: `view`'s at T3b1, `tool`'s at this review — §6) | 2 — both stand |
| `materials` | 17 → **1** (`litByClass` stayed — substrate) | 7 → **0** | 1 | 8 | 40 → **39** (the `stamp` phantom struck — §2.8, §6) | 15 — **EXTRACTED 2026-08-08** (`field-materials.ts`, T3d Task 3); **all 15 stand and all 15 now cross a module line**, arriving as ONE call (`materials.release()`). Its SEAM is **14** verbs, not 7: the surplus is inbound READS, the third mechanism (§2.8) |
| `analyzer` | 19 → **1** (`flagStore` stayed — substrate) | 14 → **0** | 6 | 8 | 39 | 14 — **EXTRACTED 2026-08-07** (`field-analyzer.ts`, T3d Task 2); **all 14 stand and all 14 now cross a module line** — 12 closure→MODULE, 2 MODULE→MODULE (the `props` pair, through the host's `markPlacementsStale` arrow). Its SEAM is 18 verbs, not 14: see §2.7 |
| `tool` | 10 → **8** | 12 → **14** (+`toolPush` at T3a, +`armMaskDropReport` named at T3c) | 4 | 8 → 7 → **6 clusters + 2 modules** (`field-segment.ts`, `field-machine.ts`) | 35 → 34 → 29 → **28** (the `toolMask` phantom — §2.5) | 11 → **8** — **PARTIALLY HOLLOWED 2026-08-07**: 6 stand in-file (the momentary pins), 2 stand cross-MODULE (`maskDropReported`) |
| `camera` | 8 | 10 → **13** (+the look-drag verbs, T3c) | 4 | 8 | 25 | 10 → **8** — the `look` pair re-homed in-file into this cluster's own verbs (§5.2) |
| `targeting` | 1 → **0** | 6 → **0** | 0 | 7 | 14 | 2 — **EXTRACTED 2026-08-07** (`field-targeting.ts`); both stand, now cross-MODULE — the delegates call `targeting.notePointer` |
| `picking` | 0 | 4 → **0** | 0 | 7 | 9 → **8** (the `canvasEl` edge struck — §2.6) | 1 — **EXTRACTED 2026-08-07** (`field-picking.ts`); stands, now MODULE→MODULE (`field-picking.ts` → `machine.setPendingMove`). Four functions out, **ONE** verb on the seam |
| `props` | 2 | 3 | 1 | 6 | 8 → **7** as `deps` (+**9** uncounted calls — §6) | 2 — both stand, **MODULE→MODULE since 2026-08-07**: the arrow is still in this file but both ends have left it |
| `view` | 2 | 1 | 2 | **5** on data edges (6 − the `selection` phantom) · **7** if calls count (+`voidcast` out, +`tool` in — §6) | 8 → **7** as data (+**6** uncounted `sliceOpts()` calls in and **2** into `voidcast` out — §6) | 1 — stands, cross-MODULE (`setSlice` fills the substrate's `dirty`) |
| `move` | 3 → **0** | 7 → **0** | 1 | 5 | 20 | 5 — **EXTRACTED 2026-08-07**, inseparably from `stamp` (§7.2); at head **1 stands cross-MODULE** (`pointerPress`'s pending press) and **4 are gone** |
| `gesture` | 4 → **0** | 2 → **0** | 2 | 5 | 17 | 2 — **EXTRACTED 2026-08-07**, inside the session machine; **both gone**, internalised |
| `voidcast` | 3 | 5 | 0 | 4 → **3** | 9 → **8** | **0** |
| `history` | 2 | 2 → **3** (§6) | 3 | 4 | 7 — the module takes **1** (`log`); `stepHistory` stays and keeps the other 6 | 1 — stands (`drift ← stepHistory`, in-file) |
| `segment` | 6 | 6 | 1 | 3 | 8 | 1 — **EXTRACTED 2026-08-03** (`field-segment.ts`; the marker is late — the row predates the convention); its one mutation stands, cross-MODULE through `armMaskDropReport` |
| `drift` | 2 → **0** | 3 → **0** | 2 | 3 | 5 | 3 — **EXTRACTED 2026-08-07** (`field-drift.ts`); all 3 stand, all 3 now cross a module line — the `stamp` one MODULE→MODULE, `history`'s and `world`'s closure→MODULE |
| `stats` | 6 | 1 | 1 | 3 → **5** | 5, of which 2 are inbound reads — the module needs **7** (§2.1's fourth correction) | 1 — **EXTRACTED 2026-08-06**; stands, MODULE→MODULE since T3c (`field-machine.ts` → `noteReconfigureMs`) |

## 5. The cross-cluster mutation register

**70 edges over 71 write sites at birth — and stating it as two numbers IS the correction.**
The opening line here said "70 edges" from the day the map was written while the five
subsection headers below summed to 71, and the T3c executor left the mismatch standing
because they had not re-audited; this review re-attributed every edge per write site
(§2.5), which is what licenses fixing it. Re-attribution finds both numbers were right
about different units. An **edge** is a distinct target × writer-function pair, which is
how §6's headers count; a **site** is an occurrence, which is how the tables below list.
Exactly one pair has two sites — `move.moveCommitPending`, written twice inside
`stamp.sendPreviewJob` (§5.4) — so the pair total is 70, the site total is 71, and the
"discrepancy" was the two units meeting in one section. Both §6 headers over that pair
(`stamp` MUTATES 5, `move` MUTATED BY 4) count the pair once while their own bullets list
both sites, which is exactly where the off-by-one lived.

This is the set that resists extraction: **58 of the 70 target a `let`** — a reassignment,
which forks silently if the binding is passed by value — and **12 target a `const`
container** (`store`-adjacent sets and maps), which are safe to pass by value because the
binding never moves and the mutation goes through the object. (The two-site pair is on the
`let` side either way, so the split holds in both units.)

**At head (2026-08-07, commit `7bb353a5`): 59 of the 70 stand and 11 are structurally
gone.** Every table below carries the disposition per edge; §5.7 is the tally the T3 exit
clause reads.

### 5.1 Teardown fan-out — `lifecycle.ret.dispose` (24 edges — **all 24 stand at head; 18 cross a module line**)

`ret.dispose` nulls all 15 `materials` bindings, both `camera` handles (`cam`,
`unbindCamera`), clears `world.chunkMeshes`, and re-arms three `analyzer` flags
(`analyzerResync`, `analyzerPlacementsStale`, `analyzerIdle`). `ret.init` writes `cam`,
`unbindCamera` and `world.dirty`. One function owns the whole lifetime of state that six
clusters read. T3c moved none of it — every edge in this table is exactly where the birth
pass found it, at new line numbers (**the whole column re-grepped at T3d Task 2**; it was
last derived at `7bb353a5` and every entry then exceeded the file's own length after this
task's 380-line hole, which is how a stale anchor column stops being a nit). **T3d Task 2
moved the three
analyzer TARGETS out of the closure** (2026-08-07): all three still stand, all three now
cross a module line, and all three arrive as ONE call — `advisor.dispose()`, which the
module owns because terminating the worker is what MAKES the re-arm owed.

| Target | Written by | Line | Status (2026-08-07) |
|---|---|---|---|
| `materials.normalsMat` … `materials.selectionCellBind` (15 bindings) | `ret.dispose` | `field-materials.ts` `release` (call at 4708) | **all 15 stand, all 15 cross-MODULE since 2026-08-08** — as ONE call, `materials.release()`. The register's biggest single fan-out is now one line. The GPU frees that used to sit beside them are the module's `destroy(c)`, a SECOND verb, because they run under the context guard and these do not (§2.8) |
| `camera.cam` | `ret.init` / `ret.dispose` | 4626 / 4734 | stands, in this file |
| `camera.unbindCamera` | `ret.init` / `ret.dispose` | 4633 / 4733 | stands, in this file |
| `world.chunkMeshes` | `ret.dispose` | 4682 | stands, in this file |
| `world.dirty` | `ret.init` | 4652 | stands, in this file |
| `analyzer.analyzerResync` | `ret.dispose` | `field-analyzer.ts` `dispose` | **stands, cross-MODULE since 2026-08-07** — through `advisor.dispose()` |
| `analyzer.analyzerPlacementsStale` | `ret.dispose` | `field-analyzer.ts` `dispose` | **stands, cross-MODULE since 2026-08-07** — same call |
| `analyzer.analyzerIdle` | `ret.dispose` | `field-analyzer.ts` `dispose` | **stands, cross-MODULE since 2026-08-07** — same call (the `clearTimeout` pair went with the slot) |

### 5.2 DOM handlers driving other clusters — `input` (20 edges at birth → **13 stand: 10 in this file + 3 cross-module; 7 gone**)

The `input` cluster owns almost no state of its own (`canvasEl`, `lastCursor`). It is a
driver: it reassigns state in five other clusters — **three of them since 2026-08-07**
(`tool`, `camera`, `targeting`; the `move` rows and three of the five `tool` rows left the
file with the pointer chain).

**Five of these ten rows changed at T3c, and the `Status` column says how.** The line
numbers ARE re-derived — every standing row's site was re-grepped at T3d Task 2, having
last been derived at `7bb353a5` (§2.5) and gone stale through two tranches since. The pattern is worth reading whole, because it is what "the machine arbitrates, the
tools act" cost this table: every row a POINTER handler drove either left the file with the
state it drove, or stayed and became a call.

| Target | Written by | Line (head) | Status (re-audited 2026-08-07) |
|---|---|---|---|
| `tool.momentaryShift` | `onKeyDown` / `onKeyUp` / `onBlur` | 4438 / 4452 / 4476 | **stands** — keyboard (3 edges) |
| `tool.momentaryCtrl` | `onKeyDown` / `onKeyUp` / `onBlur` | 4442 / 4456 / 4477 | **stands** — keyboard (3 edges) |
| `tool.digging` | `onPointerDown` / `onPointerUp` | — | **GONE** (2 edges) — state and writers both in `field-machine.ts` |
| `tool.lastStroke` | `onPointerMove` | — | **GONE** (1 edge) — same |
| `tool.maskDropReported` | `field-machine.ts`'s `pointerDown` | machine 1820 → thunk 1702 | **stands, cross-MODULE** (1 edge) — through `armMaskDropReport`; the binding stayed at 1695 |
| `targeting.lastPointer` | `onPointerDown` / `onPointerMove` | 4251 / 4256 | **stands, cross-MODULE since 2026-08-07** (2 edges) — the delegates still write it on the way past, now as `targeting.notePointer(e.clientX, e.clientY)`. The slot went with the five cursor-to-world functions it is the cached ARGUMENT of (`field-targeting.ts`); this table filed it under the DOM because the DOM writes it, which is exactly the misfiling §2.1's fourth correction describes |
| `camera.look` | ~~`onPointerDown` / `onPointerUp`~~ | 2117 / 2144 | **GONE as an edge** (2 edges) — re-homed in-file: the writers are `beginLook` / `endLook`, which are `camera`'s own, so `camera` writes its own state and no cluster line is crossed |
| `camera.dollyPixels` | `onWheel` | 4298 | **stands** (1 edge) — wheel |
| `camera.keys` (`const` Set) | `onKeyDown` / `onKeyUp` / `onBlur` | 4445 / 4450 / 4474 | **stands** — keyboard (3 edges) |
| `move.pendingMove` | `onPointerMove` / `onPointerUp` | — | **GONE** (2 edges) — state and writers both in `field-machine.ts` |

### 5.3 World reset / load fan-out — `world` (12 edges — **all 12 stand at head; 10 cross a module line**)

T3c moved nothing here either; `resetWorld` and `ret.loadWorld` are still `world`'s. **T3d
changed where the TARGETS live and nothing else** — Task 1 took `drift.drift`, Task 2 took
all nine analyzer rows — so ten of the twelve now cross a module line while the writers stay
exactly where the birth pass found them. The nine analyzer writes arrive as three named
verbs rather than nine assignments: `noteDensityWritten` (the density choke point),
`retireWorld` (the whole of what a world swap means to an advisor — stale keys, dirty set,
re-sync, seeds, findings, publish) and `noteWorldLoaded` (the agent's start plus the two
staleness flags). **The whole column was re-grepped at T3d Task 2**, and the analyzer rows'
lines now name the CALL site in this file rather than the assignment, since the assignment
is in another file.

| Target | Written by | Line (head) | Status (2026-08-07) |
|---|---|---|---|
| `analyzer.analyzerStale` (`const` Set) | `resetWorld`, through `advisor.retireWorld` | 4539 | **stands, cross-MODULE since 2026-08-07** |
| `analyzer.analyzerDirty` (`const` Set) | `resetWorld` (`retireWorld`), `markDirtyWithNeighbors` (`noteDensityWritten`) | 4539, 2223 | **stands, cross-MODULE since 2026-08-07** (2 edges) |
| `analyzer.analyzerResync` | `resetWorld` (`retireWorld`) / `ret.loadWorld` (`noteWorldLoaded`) | 4539 / 4777 | **stands, cross-MODULE since 2026-08-07** (2 edges) |
| `analyzer.analyzerSeeds` | `resetWorld` (`retireWorld`) / `ret.loadWorld` (`noteWorldLoaded`) | 4539 / 4777 | **stands, cross-MODULE since 2026-08-07** (2 edges) |
| `analyzer.analyzerWholeWorld` | `ret.loadWorld`, through `advisor.noteWorldLoaded` | 4777 | **stands, cross-MODULE since 2026-08-07** |
| `analyzer.flagStore` (`const`, `.clear()`) | `resetWorld`, through `advisor.retireWorld` | 4539 | **stands, cross-MODULE since 2026-08-07** — and it is the register's one edge where the TARGET stayed in the closure (a substrate value member) while the WRITE moved into a module: the identity the substrate hands out is what makes that legal, exactly as `world.dirty ← field-view.ts` does in §5.5 |
| `selection.selection` | `resetWorld` | 4568 | stands — a bare write, deliberately not `setSelection(null)` (the Reselect slot), with `syncSelectionCapture()` paying the Esc stack back at 4570 |
| `selection.lastSelection` | `resetWorld` | 4569 | stands |
| `drift.drift` | `resetWorld` | 4587 | **stands, cross-MODULE since 2026-08-07** — the slot is `field-drift.ts`'s; the two lines are `drift.set(null)` + `drift.notify()` |

### 5.4 The session cycle — `stamp` ↔ `move` (bidirectional, 2 edges over 3 sites — **all structurally GONE 2026-08-07**)

**This was the only bidirectional mutation pair in the closure**, and it is the single most
important entry in this register — the header's "2 edges over 3 sites" is the register's
one two-site pair and the whole of the old 70-vs-71 discrepancy (§5's opening note).

At head every site below is inside `field-machine.ts` and both bindings are that module's
own private state: the cycle was **internalised, not resolved** — the machine still runs
it, but no cluster line and no module boundary is crossed, which is what §7.2 predicted a
merge would do and §7.5's table priced. The line numbers are the birth measurement, kept
as the record of why the two clusters could only leave together.

| Target | Written by | Line (birth) | Status (2026-08-07) |
|---|---|---|---|
| `stamp.stamp` | `move.dropMove` | 5426 | **GONE** — machine-internal |
| `move.moveCommitPending` | `stamp.sendPreviewJob` | 4892, 4916 | **GONE** (1 edge, 2 sites) — machine-internal |

The mutation edges understate it. The two clusters are one state machine (every line
reference below is the birth measurement; the mechanism now lives whole in
`field-machine.ts`):

- `openEntitySession(entityId, moving)` at 5246 opens a **reconfigure** session and, at
  5289, stamps `moving: true` onto it. A move session *is* a stamp session — there is no
  separate slot. The comment at 1907–1909 says so: *"Its session is the `stamp` slot — this
  is only the cursor mapping over it."*
- `stamp.confirmActiveSession` (5533) reads `move.moveDrag` and delegates to
  `move.dropMove`.
- `stamp.applyReconfigureSession` (5487) and `stamp.cancelStampSession` both call
  `move.endMove`.
- `move.dropMove` (5400–5429) reads `stamp` five times and drives it through
  `commitActiveSession`, `cancelStampSession` and `demoteStalledMove`.

### 5.5 The remainder (12 edges at birth → **10 stand: 2 in this file, 8 cross-module; 2 gone**)

The subsection T3b1 and T3c reshaped most, because it is where the extracted clusters'
boundary writes live. Standing rows carry head lines; a site in another file says whose.

**The header's split was WRONG before this task and is corrected here rather than only
widened.** It read "5 in this file, 5 cross-module" from T3c through T3d Task 1, while the
table underneath it read 4 / 6 for the whole of that window: Task 1 moved
`drift.drift ← stepHistory` out of the closure and re-dispositioned the ROW without
re-summing the HEADER. Task 2 then moved the two `analyzer` rows out too, which would have
made it 5-vs-2. Both corrections are folded into the 2 / 8 above. This is §2.6's
half-struck-edge hazard in its other form — **a per-row annotation does not reach the
summary that counts the rows**, and nothing in this document checks the two against each
other.

| Target | Written by | Line (head) | Status (re-audited 2026-08-07) |
|---|---|---|---|
| `analyzer.analyzerPlacementsStale` | `props` — the `markPlacementsStale` arrow at the `createProps` call | arrow 2305–2306; `field-analyzer.ts` `markPlacementsStale` | **stands, MODULE→MODULE since 2026-08-07** — the arrow is still in this file and both of its ends have now left it. The verb kept the name the host gave the act when `props` went, which is why the two sites read identically across three epochs |
| `analyzer.analyzerWholeWorld` | same arrow | arrow 2300–2301; `field-analyzer.ts` `markPlacementsStale` | **stands, MODULE→MODULE since 2026-08-07** |
| `gesture.suspendReported` | `stamp.openStampSession` / `stamp.openEntitySession` | — | **GONE** (2 edges) — latch and writers all machine-internal (`field-machine.ts` 1092 / 1345) |
| `drift.drift` | `field-machine.ts`'s `applyReconfigureSession`, through `drift.set` | dep 3902; machine 1595 | **stands, MODULE→MODULE since 2026-08-07** — it was closure→module while the slot was a host `let`; T3d moved the slot to `field-drift.ts` and the write-thunk became that module's own verb, so both ends have now left |
| `drift.drift` | `history.stepHistory` | 3972 | **stands, cross-MODULE since 2026-08-07** — the guard is `drift.standing()`, and it is the ONLY conditional clear of the four (`ViewChannel.publish` has no change detection, so an unconditional clear would push `null` on every ⌘Z) |
| `stats.lastReconfigureMs` | `field-machine.ts`'s `applyReconfigureSession`, through the `noteReconfigureMs` arrow | arrow 3897; machine 1588; `field-stats.ts` 283 | **stands, MODULE→MODULE** — both ends have left the closure and the edge now joins two extracted files across the host's one arrow |
| `move.pendingMove` (the machine's, since T3c) | `picking.pointerPress`, through `machine.setPendingMove` | `field-picking.ts` 343 | **stands, MODULE→MODULE since 2026-08-07** — it was the register's only edge where the CLOSURE wrote INTO a module, and T3d retired that distinction by extracting the writer: `field-picking.ts` reaches `field-machine.ts` through the arrow pair in its deps record |
| `tool.maskDropReported` | `field-segment.ts`'s commit, through `armMaskDropReport` | `field-segment.ts` 350 → thunk 1702 | **stands, cross-MODULE** — the same thunk §5.2's machine row uses; two callers, one spelling |
| `world.chunkMeshes` | `catalogs.ret.setMaterialTable` | 4902 | **stands, in this file** |
| `world.dirty` | `catalogs.ret.setMaterialTable` | 4909 | **stands, in this file** |
| `world.dirty` | `field-view.ts`'s `setSlice` (`substrate.dirty.add`) | `field-view.ts` 217 | **stands, cross-MODULE** — the substrate's value side carrying a boundary write, as designed (§7.3) |

### 5.6 Clusters with zero mutation edges in either direction

`voidcast` (now `field-voidcast.ts`, and still zero from its module), `entities`, `render`
(now `field-render.ts`, and still zero in both directions), `picking` (as a target — now
`field-picking.ts`, and still zero into it). `voidcast` and `entities` neither mutate another
cluster's state nor have theirs mutated; `render` and `picking` are pure readers that own no
reassignable state crossing a line — though `picking` WRITES one edge (§5.5's pending press),
which is why the "as a target" qualifier has always been on its name. Owning no state at all
is what let `picking` leave the closure without adding a single member to the substrate.

**And zero mutations is what makes a 29-member deps record safe** — `render`'s, measured at
its extraction (§2.8). Every entry is a READ, so the width is a description of what a frame
IS rather than of what the cluster is entangled with; the same record with even one
write-thunk in it would be the coupling smell it superficially resembles. **The other half of
that bargain is that a pure reader is cheap to EXTRACT and expensive to VERIFY**, which this
section did not previously say: `render` moved with no seam negotiation at all and the suite
proved almost nothing about it afterwards (§2.8's coverage measurement — an empty viewport is
fully green). A cluster that writes nothing also leaves nothing behind for a test to
observe.

### 5.7 The tally

**Of the register's 70 birth edges (71 sites): 11 edges (12 sites) are structurally gone —
9 internalised by `field-machine.ts`, whose state and writers left together, and 2
(`camera.look`) re-homed into their own cluster's verbs inside this file — and 59 stand, of
which 6 cross a MODULE boundary and 53 remain cluster-to-cluster inside the closure.** This
line is what the T3 exit clause is judged against.

**Re-tallied at foundations T3d Task 1, 2026-08-07: 11 gone and 59 standing are UNCHANGED —
what moved is where the standing ones live. 10 now cross a module boundary (3 of them
MODULE→MODULE) and 49 remain cluster-to-cluster inside the closure.** Four edges crossed
the line in this task and one was reclassified twice over:

- `targeting.lastPointer` ← `input` (2 edges, §5.2) — the TARGET left, the writers stayed.
- `drift.drift` ← `history.stepHistory` and ← `world.resetWorld` (2 edges, §5.5 / §5.3) —
  same shape, same task.
- `drift.drift` ← the machine's apply and `move.pendingMove` ← the pick (§5.5) — both were
  already cross-MODULE with one end in the closure; T3d moved the OTHER end out, so both
  are MODULE→MODULE now and neither changes the count.

**Re-tallied at foundations T3d Task 2, 2026-08-07: 11 gone and 59 standing are UNCHANGED
again — `analyzer` left with every one of its 14 inbound edges intact. 24 now cross a module
boundary (5 of them MODULE→MODULE) and 35 remain cluster-to-cluster inside the closure.**
The arithmetic, from Task 1's 10 / 49 split:

- §5.1's three (`analyzerResync`, `analyzerPlacementsStale`, `analyzerIdle` ← `ret.dispose`)
  — the TARGETS left, the writer stayed: **+3 closure→MODULE**.
- §5.3's nine (`analyzerStale`, `analyzerDirty` ×2, `analyzerResync` ×2, `analyzerSeeds` ×2,
  `analyzerWholeWorld`, `flagStore` ← `world`) — same shape, eight of them: **+9
  closure→MODULE**. `flagStore` is the odd one and is counted here anyway: its target stayed
  in the closure and the WRITE moved out, which crosses the same line in the other direction.
- §5.5's two (`analyzerPlacementsStale`, `analyzerWholeWorld` ← `props`) — the target's end
  left to join a writer that had already gone at T3b1: **+2, and they move from
  closure-internal to MODULE→MODULE**.

So cross-module 10 + 3 + 9 + 2 = **24**, of which MODULE→MODULE 3 + 2 = **5**;
cluster-to-cluster 49 − 14 = **35**; 24 + 35 = **59**, and the gone count is untouched at
**11**.

**Re-tallied at foundations T3d Task 3, 2026-08-08: 11 gone and 59 standing are UNCHANGED
for the third tranche running — `materials` left with every one of its 15 inbound edges
intact and `render` had none in either direction. 39 now cross a module boundary (5 of them
MODULE→MODULE) and 20 remain cluster-to-cluster inside the closure.** The arithmetic, from
Task 2's 24 / 35 split, is one line because this task's whole contribution is one table:

- §5.1's fifteen (`materials.normalsMat` … `materials.selectionCellBind` ← `ret.dispose`) —
  the TARGETS left, the writer stayed: **+15 closure→MODULE**. They arrive as ONE call,
  `materials.release()`, which is the largest ratio of edges-to-calls the register has
  recorded: `advisor.retireWorld` carried 5, this carries 15.

So cross-module 24 + 15 = **39**, of which MODULE→MODULE is unchanged at **5**;
cluster-to-cluster 35 − 15 = **20**; 39 + 20 = **59**, and the gone count is untouched at
**11**. `render` contributes nothing to any of it, which is §5.6's row stated as arithmetic.

**Two thirds of the register now crosses a module line** (39 of 59), and the crossing point
is worth noting for the T3 exit clause: at T3c it was 6, at Task 1 ten, at Task 2 twenty-four.
The remaining 20 are §5.1's six (`lifecycle`→`camera` ×4, `lifecycle`→`world` ×2), §5.2's
ten (`input`'s keyboard and wheel pins into `tool` and `camera`), §5.3's two
(`world`→`selection`) and §5.5's two (`catalogs`→`world`) — i.e. exactly the clusters Tasks 4–6 own.

The direction of travel is worth naming because it is what an extraction tranche does to
this register: **it converts cluster-to-cluster edges into module boundaries rather than
deleting them.** Only a merge deletes an edge (T3c's nine), and only a re-homing retires
one (T3c's two, plus the READ-side re-homing §2.7 records for `camera.orbitState`).
Everything else is the same coupling, said out loud in a type. **The read side does not
behave this way** — §2.7's second bullet: seven of `analyzer`'s ten inbound reads became
CALLS on the way out and left the map entirely, because a call is not an edge here.

---

## 6. Cluster detail

Each section lists the bindings the cluster owns with their declaration line, what it reads
and mutates across cluster lines, what reads and mutates it, and its public members.
"Sites" counts occurrences, not distinct functions.

**`escapeLadder`** — every site marked with the dagger names a function DELETED on
2026-08-05 (§2.2). The read still happens; it happens in that state's own canonical setter
now, which is a different cluster's function. The count beside it is the 2026-08-03 figure
and includes the occurrences inside the deleted function; it has not been re-derived.

### Cluster: lifecycle

**Owns (state) — 5:** `requestContext`@1678 · `ctx`@1679 · `disposed`@2013 · `raf`@2011 · `lastFrameT`@2012 *(anchors re-grepped 2026-08-07 — §2.5; so for every live row below)*

**Owns (functions) — 1:** `tick`@5266

**Reads from other clusters** (31 edges → **26**, and the six bullets that changed are §2.1's
fourth correction in one place):

`tick`'s stats publish left with `stats` on 2026-08-06, and six of the reads below went with
it — `lastReconfigureMs` and `statsChannel` (into `field-stats.ts` as module state) plus
`lastRemeshMs`, `remeshVersion`, `voidCastJobGen` and the `tick` half of `store` (into that
module's `deps`). All six are marked `‡` below. **They were never `lifecycle`'s dependencies
in any sense but the syntactic one**: `tick` named them only to fill a `stats` payload, and
the map filed them here because the map attributes a read to whoever owns the enclosing
function. `tick` now calls `stats.publishIfWatched()` and names none of them.

The delta is **−5, not −6**: `store` is the one bullet with a second site (`ret.init`), which
is a real `lifecycle` read and survives. Caveat on the base figure, noted and deliberately not
chased: 31 is the 2026-08-03 pass's number and this list holds 29 bullets over 48 occurrences,
so the three counts do not reconcile and never did. That is pre-existing map slack (§2.2's
"re-deriving the totals is a real pass"), not this move's. Trust the bullets, not the header.

  - ~~`analyzerIdle` (owned by `analyzer`) — 2 sites: `ret.dispose`~~ — **GONE as a read
    2026-08-07**: folded into `advisor.dispose()` (`field-analyzer.ts`)
  - ~~`analyzer` (owned by `analyzer`) — 1 site: `ret.dispose`~~ — **GONE as a read
    2026-08-07**: same call; the worker client is module-private
  - `cam` (owned by `camera`) — 3 sites: `ret.init`, `tick`
  - `chunkMeshes` (owned by `world`) — 1 site: `ret.dispose`
  - `flagMarkerBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `flagMarkerMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - ~~`flagStore` (owned by `analyzer`) — 1 site: `ret.init`~~ — **GONE as a read
    2026-08-07**: the marker replay is `advisor.rebuildMarkers()`, which reads its own summary
  - `ghostBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `ghostCubeGeo` (owned by `materials`) — 2 sites: `ret.dispose`
  - `ghostCube` (owned by `materials`) — 2 sites: `ret.dispose`
  - `ghostMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `kitBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `kitMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `lastReconfigureMs` (owned by `stats`) — 1 site: `tick` ‡
  - `lastRemeshMs` (owned by `world`) — 1 site: `tick` ‡
  - `layers` (owned by `view`) — 1 site: `ret.init`
  - `normalsMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `remeshVersion` (owned by `world`) — 1 site: `tick` ‡
  - `selectionCellBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `selectionCellMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `stampGhostBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `stampGhostMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `statsChannel` (owned by `stats`) — 1 site: `tick` ‡
  - `store` (owned by `world`) — 2 sites: `ret.init`, ~~`tick`~~ ‡
  - `unbindCamera` (owned by `camera`) — 1 site: `ret.dispose`
  - `voidCastBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `voidCastJobGen` (owned by `voidcast`) — 1 site: `tick` ‡
  - `voidCastMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `worker` (owned by `world`) — 1 site: `ret.dispose`

**MUTATES other clusters** (24 edges):
  - `analyzerIdle` (owned by `analyzer`) — 1 site: `ret.dispose` — **cross-MODULE since
    2026-08-07**, through `advisor.dispose()`
  - `analyzerPlacementsStale` (owned by `analyzer`) — 1 site: `ret.dispose` — **cross-MODULE
    since 2026-08-07**, same call
  - `analyzerResync` (owned by `analyzer`) — 1 site: `ret.dispose` — **cross-MODULE since
    2026-08-07**, same call
  - `cam` (owned by `camera`) — 2 sites: `ret.dispose`, `ret.init`
  - `chunkMeshes` (owned by `world`) — 1 site: `ret.dispose`
  - `dirty` (owned by `world`) — 1 site: `ret.init`
  - `flagMarkerBind` (owned by `materials`) — 1 site: `ret.dispose`
  - `flagMarkerMat` (owned by `materials`) — 1 site: `ret.dispose`
  - `ghostBind` (owned by `materials`) — 1 site: `ret.dispose`
  - `ghostCubeGeo` (owned by `materials`) — 1 site: `ret.dispose`
  - `ghostCube` (owned by `materials`) — 1 site: `ret.dispose`
  - `ghostMat` (owned by `materials`) — 1 site: `ret.dispose`
  - `kitBind` (owned by `materials`) — 1 site: `ret.dispose`
  - `kitMat` (owned by `materials`) — 1 site: `ret.dispose`
  - `normalsMat` (owned by `materials`) — 1 site: `ret.dispose`
  - `selectionCellBind` (owned by `materials`) — 1 site: `ret.dispose`
  - `selectionCellMat` (owned by `materials`) — 1 site: `ret.dispose`
  - `stampGhostBind` (owned by `materials`) — 1 site: `ret.dispose`
  - `stampGhostMat` (owned by `materials`) — 1 site: `ret.dispose`
  - `unbindCamera` (owned by `camera`) — 2 sites: `ret.dispose`, `ret.init`
  - `voidCastBind` (owned by `materials`) — 1 site: `ret.dispose`
  - `voidCastMat` (owned by `materials`) — 1 site: `ret.dispose`

**Read by other clusters** (21 edges):
  - `ctx` (read in `analyzer`) — 1 site: `rebuildFlagMarkers` — **cross-MODULE since
    2026-08-07**, through `substrate.ctx()`
  - `ctx` (read in `catalogs`) — 1 site: `ret.setMaterialTable`
  - `ctx` (read in `materials`) — 1 site: `ret.setShading` — **cross-MODULE since
    2026-08-08**, through `substrate.ctx()`; the whole body left with the verb
  - `ctx` (read in `props`) — 1 site: `rebuildProps`
  - `ctx` (read in `selection`) — 1 site: `rebuildSelectionCells`
  - `ctx` (read in `stamp`) — 2 sites: `applyStampGhost`, `destroyStampGhosts`
  - `ctx` (read in `voidcast`) — 3 sites: `applyVoidCast`, `destroyVoidCast`, `requestVoidCast`
  - `ctx` (read in `world`) — 2 sites: `remeshOne`, `resetWorld`
  - `disposed` (read in `analyzer`) — 4 sites: `analyzePump`, `analyzerFire`, `reportAnalyzerFailure`, `verifyFlagImpl` — **cross-MODULE since 2026-08-07**, through `substrate.disposed()`
  - `disposed` (read in `catalogs`) — 2 sites: `ret.setMaterialTable`
  - `disposed` (read in `stamp`) — 3 sites: `previewCoalescer`, `sendPreviewJob`
  - `disposed` (read in `voidcast`) — 2 sites: `requestVoidCast`
  - `disposed` (read in `world`) — 2 sites: `remeshOne`

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (2):** `init`, `dispose`


### Cluster: materials — **EXTRACTED 2026-08-08** (`field-materials.ts`, foundations T3d Task 3)

Lives in `packages/editor/src/field-host/field-materials.ts` — every GPU material the
viewport draws with, the ghost cube and its geometry, and the `shading` mode. SIXTEEN of the
seventeen bindings and all seven functions travelled.

**The name is the row's one trap and the module's header opens by defusing it.** There is a
`field.MaterialTable` in this editor and it is NOT this cluster's — it is `catalogs`', it
rides the substrate as `table()`, and §6's `catalogs` row declared it FACADE-RESIDENT one
task earlier. There is a material SWATCH strip and that is the chrome's. This row is fifteen
`Material` / `Binding` / `Mesh` / `Geometry` handles plus one enum; the table is an INPUT to
two of the functions.

**The seam is 14 verbs against 7 functions + 1 public member, and the surplus is a THIRD
mechanism** — see §2.8. `analyzer`'s surplus was its inbound MUTATIONS, `picking`'s deficit
was a pipeline; this one's surplus is inbound READS — the FIVE bindings other clusters read
off this cluster, collapsed onto accessors (`kitMat`, `flagMarker`, `selectionCell`,
`ghostCube`, `shading`) — plus the teardown split. Counted the other way, by KIND rather than by
origin, the fourteen are 4 lifecycle + 2 shading + 8 accessors, and those eight accessors
cover SEVEN distinct handles (`kitInstanced` and `kitMat` are a throwing getter and a
nullable read of the same one). The module's own header carries both partitions.

**`litByClass` STAYED** — a `HostSubstrate` value member since T3a, so it could not follow
its owner. It is the FIFTH substrate leftover and the first whose owning cluster is also its
only reader; §2.8's first two bullets are the argument, including the MEASURED removal cost
(8 type errors, exactly one in a test — and three further test sites that would go silently
stale rather than red). The verdict is recorded at source.

**Owns (state) — 17 → 1:** `litByClass`@1619 (**STAYED** — substrate) · the other sixteen are
`field-materials.ts`'s private state: `normalsMat` · `kitMat` · `kitBind` · `ghostMat` ·
`ghostBind` · `ghostCube` · `ghostCubeGeo` · `stampGhostMat` · `stampGhostBind` ·
`voidCastMat` · `voidCastBind` · `flagMarkerMat` · `flagMarkerBind` · `selectionCellMat` ·
`selectionCellBind` · `shading` *(the `@line` anchors here were the pre-extraction record and
are deleted rather than re-pointed — the bindings are in another file)*

**Owns (functions) — 7 → 0:** `buildLitMaterials` and `destroyLitMaterials` are PRIVATE in
the module (folded into `rebuildForTable` and `destroy`); `initMaterials` → `init`,
`stampGhostMaterial` → `stampGhost`, `voidCastMaterial` → `voidCast`, `bucketMaterial` →
`bucket`, `kitInstancedMat` → `kitInstanced`

**Reads from other clusters** (4 edges → **3**, all now through the substrate):
  - `chunkMeshes` (owned by `world`) — 1 site: `ret.setShading` — **cross-MODULE since
    2026-08-08**, through `substrate.chunkMeshes`; the whole body of `setShading` is the
    module's verb now
  - `ctx` (owned by `lifecycle`) — 1 site: `ret.setShading` — **cross-MODULE**, through
    `substrate.ctx()`
  - ~~`stamp` (owned by `stamp`) — 1 site: `stampGhostMaterial`~~ — **STRUCK 2026-08-08, a
    §2.1 STRING-LITERAL PHANTOM.** The function's entire body is a null guard and a return;
    the only occurrence of the word is inside its own throw message, `"field-host: stamp
    ghost material not initialized"`. `stamp` is on §2.1's own list of binding names that are
    also ordinary English words. Had it been real, `createMaterials` would have had to
    forward-reference a machine assembled ~1,670 lines below it. Struck at both ends (see the
    `stamp` row's *read by* list)
  - `table` (owned by `catalogs`) — 1 site: `buildLitMaterials` — **cross-MODULE**, through
    `substrate.table()`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (21 edges — **every one is now a CALL onto this module's seam,
and 15 of the 21 vanish from the map entirely**, per §2.7's rule that a call is not an edge):
  - the FIFTEEN `ret.dispose` reads (`normalsMat`, `kitMat`, `kitBind`, `ghostCube`,
    `ghostCubeGeo`, `ghostMat`, `ghostBind`, `stampGhostMat`, `stampGhostBind`,
    `voidCastMat`, `voidCastBind`, `flagMarkerMat`, `flagMarkerBind`, `selectionCellMat`,
    `selectionCellBind`) — **all GONE as reads 2026-08-08**: they were the `if (X)
    material.destroy(c, X)` guards, and they are now inside `materials.destroy(c)`. The
    fifteen MUTATIONS below are a different set of sites and they STAND (§5.1)
  - `flagMarkerMat` (read in `analyzer`) — 2 sites: `rebuildFlagMarkers` — **now a plain ref
    onto this module's seam** (`materials.flagMarker`). It was a single-consumer FUNCTION DEP
    over a host `let` from 2026-08-07 to 2026-08-08; the substrate-bar framing expired with
    the `let`, and `field-analyzer.ts`'s header records the expiry
  - `kitMat` (read in `props`) — 1 site: `rebuildProps` — same shape, same day
    (`materials.kitMat`), and `field-props.ts`'s header records the identical expiry. Its
    twin `kitInstancedMat` was never a counted edge (a call) and is now
    `materials.kitInstanced`
  - `selectionCellMat` (read in `selection`) — 2 sites: `rebuildSelectionCells` — now
    `materials.selectionCell()`, bound to a local because narrowing does not survive a call
    boundary. **cross-MODULE**, and the first of this cluster's reads whose consumer is still
    in the closure
  - `ghostCube` (read in `render`) — 4 sites: `renderScene` — **MODULE→MODULE since
    2026-08-08** (`materials.ghostCube`), both ends having left on the same day. The four
    sites are one local now, asked immediately before its guard
  - `shading` (read in `render`) — 2 sites: `renderScene`, `sceneLights` — **MODULE→MODULE**,
    same day (`materials.shading`)

**MUTATED BY other clusters** (15 edges — **all 15 stand, all 15 cross-MODULE since
2026-08-08, and all 15 arrive as ONE call**: `materials.release()`. §5.1 carries the row.
The largest edges-per-call ratio in the register — `advisor.retireWorld` carried 5):
  - `flagMarkerBind` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `flagMarkerMat` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `ghostBind` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `ghostCubeGeo` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `ghostCube` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `ghostMat` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `kitBind` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `kitMat` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `normalsMat` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `selectionCellBind` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `selectionCellMat` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `stampGhostBind` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `stampGhostMat` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `voidCastBind` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `voidCastMat` (mutated by `lifecycle`) — 1 site: `ret.dispose`

**Public members (1):** `setShading`


### Cluster: world

**Owns (state) — 8:** `store`@1684 · `log`@1685 · `dirty`@1686 · `worker`@1687 · `chunkMeshes`@1688 · `lastRemeshMs`@2000 · `remeshVersion`@2004 · `worldEpoch`@3879 (**RELOCATED 2026-08-07** — it was declared inside the advisor block; T3d Task 2 moved it up to sit directly above the `createAnalyzer` assembly so the single-consumer thunk that hands it over reads a binding above it. It is `world`'s and it stays)

**Owns (functions) — 14:** `markDirtyWithNeighbors`@2390 · `chunkOrigin`@2428 · `buildKit`@2441 · `destroyChunkRender`@2497 · `applyMesh`@2510 · `remeshOne`@2552 · `drainDirty`@2576 · `chunkCopy`@4077 · `snapshotChunks`@4032 · `snapshotAllChunks`@4084 · `chunkSetBox`@3842 · `occupiedTopYOf`@3871 · `compactLoadedLog`@5661 · `resetWorld`@5582

**Reads from other clusters** (12 edges):
  - ~~`analyzePump` (owned by `analyzer`) — 3 sites: `markDirtyWithNeighbors`, `ret.loadWorld`, `ret.newWorld`~~ — **GONE as reads 2026-08-07**: `advisor.noteDensityWritten(changed)` at the choke point, `advisor.requestPass()` at the two world verbs
  - `ctx` (owned by `lifecycle`) — 2 sites: `remeshOne`, `resetWorld`
  - `disposed` (owned by `lifecycle`) — 2 sites: `remeshOne`
  - `orbitState` (owned by `camera`) — 1 site: `ret.exportArtifact`
  - `sliceY` (owned by `view`) — 1 site: `remeshOne`
  - `table` (owned by `catalogs`) — 4 sites: `buildKit`, `compactLoadedLog`, `remeshOne`, `ret.exportArtifact`

**MUTATES other clusters** (12 edges):
  - `analyzerDirty` (owned by `analyzer`) — 2 sites: `markDirtyWithNeighbors`, `resetWorld` — **cross-MODULE since 2026-08-07**, through `noteDensityWritten` / `retireWorld`
  - `analyzerResync` (owned by `analyzer`) — 2 sites: `resetWorld`, `ret.loadWorld` — **cross-MODULE since 2026-08-07**, through `retireWorld` / `noteWorldLoaded`
  - `analyzerSeeds` (owned by `analyzer`) — 2 sites: `resetWorld`, `ret.loadWorld` — **cross-MODULE since 2026-08-07**, same two verbs
  - `analyzerStale` (owned by `analyzer`) — 1 site: `resetWorld` — **cross-MODULE since 2026-08-07**, through `retireWorld`
  - `analyzerWholeWorld` (owned by `analyzer`) — 1 site: `ret.loadWorld` — **cross-MODULE since 2026-08-07**, through `noteWorldLoaded`
  - `drift` (**since 2026-08-07 owned by `field-drift.ts`**) — 1 site: `resetWorld` — now
    `drift.set(null)` + `drift.notify()`, cross-MODULE
  - `flagStore` (owned by `analyzer`) — 1 site: `resetWorld` — **cross-MODULE since
    2026-08-07**, through `advisor.retireWorld()`. The register's one edge whose TARGET
    stayed in the closure while the WRITE left it (§5.3)
  - `lastSelection` (owned by `selection`) — 1 site: `resetWorld`
  - `selection` (owned by `selection`) — 1 site: `resetWorld`

**Read by other clusters** (65 edges):
  - `chunkMeshes` (read in `catalogs`) — 1 site: `ret.setMaterialTable`
  - `chunkMeshes` (read in `lifecycle`) — 1 site: `ret.dispose`
  - `chunkMeshes` (read in `materials`) — 1 site: `ret.setShading` — **cross-MODULE since
    2026-08-08**, through `substrate.chunkMeshes`
  - `chunkMeshes` (read in `render`) — 1 site: `renderScene` — **cross-MODULE since
    2026-08-08**, through `substrate.chunkMeshes`
  - `dirty` (read in `entities`) — 2 sites: `ret.deleteEntity`, `ret.duplicateEntity`
  - `dirty` (read in `stamp`) — 1 site: `commitStampSession`
  - `lastRemeshMs` (read in `lifecycle`) — 1 site: `tick`
  - `log` (read in `analyzer`) — 1 site: `analyzerPlacementGroups` — **cross-MODULE since
    2026-08-07**, through `substrate.log`
  - `log` (read in `entities`) — 14 sites: `entityFootprints`, `entityRecord`, `ret.bakeEntity`, `ret.deleteEntity`, `ret.duplicateEntity`, `ret.listEntities`, `ret.setEntityFrozen`
  - `log` (read in `history`) — 8 sites: `notifyHistory`, `stepHistory`
  - `log` (read in `picking`) — 1 site: `pickCandidates` — **cross-MODULE since 2026-08-07**,
    through `substrate.log`
  - `log` (read in `props`) — 1 site: `rebuildProps`
  - `log` (read in `stamp`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `openEntitySession`
  - `log` (read in `stats`) — 8 sites: `cachedLogStats`, `currentLogStats`
  - `log` (read in `tool`) — 1 site: `commitToolOp`
  - `remeshVersion` (read in `lifecycle`) — 1 site: `tick`
  - `store` (read in `analyzer`) — 7 sites: `analyzerHasWork`, `postMirrorSync`, `rebuildFlagMarkers`, `rebuildFlagSelection`, `selectFlagImpl` — **cross-MODULE since 2026-08-07**, through `substrate.store`
  - `store` (read in `camera`) — 1 site: `frameWorld`
  - `store` (read in `catalogs`) — 1 site: `ret.setMaterialTable`
  - `store` (read in `drift`) — 1 site: `driftedEntities` — **cross-MODULE since 2026-08-07**,
    through `substrate.store`
  - `store` (read in `entities`) — 3 sites: `entityFootprints`, `ret.deleteEntity`, `ret.duplicateEntity`
  - `store` (read in `history`) — 2 sites: `stepHistory`
  - `store` (read in `lifecycle`) — 2 sites: `ret.init`, `tick`
  - `store` (read in `picking`) — 2 sites: `pickCandidates`, `pointerPick` — **cross-MODULE
    since 2026-08-07**, through `substrate.store`
  - `store` (read in `selection`) — 5 sites: `commitSelectionSpec`, `rebuildSelectionCells`, `selectionAabb`, `selectionClick`, `selectionInfo`
  - `store` (read in `stamp`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `sendPreviewJob`
  - `store` (read in `targeting`) — 8 sites: `computeTarget`, `cursorRay`, `materialSeedVoxel`, `selectionPoint`, `voidSeedVoxel` — **cross-MODULE since 2026-08-07**, through
    `substrate.store`. The densest single-cluster read of this binding after `render`'s, and
    all eight crossed the boundary on the record with nothing added to it
  - `store` (read in `tool`) — 4 sites: `commitToolOp`, `eyedropper`
  - `store` (read in `view`) — 1 site: `ret.setSlice`
  - `store` (read in `voidcast`) — 2 sites: `requestVoidCast`
  - `worker` (read in `lifecycle`) — 1 site: `ret.dispose`
  - `worker` (read in `stamp`) — 1 site: `sendPreviewJob`
  - `worker` (read in `voidcast`) — 1 site: `requestVoidCast`
  - `worldEpoch` (read in `analyzer`) — 2 sites: `verifyFlagImpl` — **cross-MODULE since
    2026-08-07**, as a single-consumer FUNCTION DEP. The binding was DECLARED inside the
    advisor block and moved up to sit directly above the assembly; it is `world`'s and stays
  - `worldEpoch` (read in `entities`) — 1 site: `entityFootprints`

**MUTATED BY other clusters** (5 edges):
  - `chunkMeshes` (mutated by `catalogs`) — 1 site: `ret.setMaterialTable`
  - `chunkMeshes` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `dirty` (mutated by `catalogs`) — 1 site: `ret.setMaterialTable`
  - `dirty` (mutated by `lifecycle`) — 1 site: `ret.init`
  - `dirty` (mutated by `view`) — 1 site: `ret.setSlice`

**Public members (5):** `newWorld`, `loadWorld`, `exportArtifact`, `occupiedTopY`, `getSmoothLimits`


### Cluster: catalogs — **DECLARED FACADE-RESIDENT 2026-08-07** (foundations T3d)

The first row to carry this marker, and the marker exists because "not extracted" and
"examined and staying" needed to stop looking the same. This cluster was probed under
T3d's premise *"3 state / 0 fns — it may belong in substrate or as a module record rather
than a module of its own; read the three bindings' readers"*, and the answer is that it
stays. The verdict lives at source too, at `table`'s declaration in `field-host.ts`
(@1739) with a back-pointer at `archetypes` — never by omission.

**The argument, from the three bindings' readers:**

- **Zero functions** means a `field-catalogs.ts` would not have contained the cluster's own
  work. What it would have contained is its three SETTERS' bodies, and all three are FACADE
  members (`setMaterialTable`, `setEntityCatalog`, `listGenerators`) doing other clusters'
  work: a table swap tears down every chunk render, rebuilds the per-class lit materials
  and re-dirties the world; a catalog swap rebuilds the prop layer. Lifting those drags
  `materials`, `world` and `props` across a line to carry three `let`s no cluster function
  reads. That is the whole of this row's 2 outbound mutations, and it is why both sit in
  §5.5 under `ret.setMaterialTable` rather than under a cluster function.
- **Two of the three have already left, in the only sense that matters.** `table()` and
  `archetypeById()` are `HostSubstrate` thunks (T3a), so every extracted module reads them
  live from the record. What remains in the closure is the ASSIGNMENT, which is the
  facade's.
- **`archetypes` does not join them, and the bar is why.** Adding a substrate member needs
  two extracted readers; it has exactly one (`field-machine.ts`, through the
  `archetypes: () => archetypes` dep). It rides as a single-consumer function dep instead —
  `field-props.ts`'s `kitMat` precedent, the bar in its active form. T3d's three extractions
  added no reader for it, so nothing about this changed.

**Owns (state) — 3:** `table`@1739 · `archetypes`@1869 · `archetypeById`@1870 — **all three
stay**

**Owns (functions) — 0:** none

**Reads from other clusters** (4 edges):
  - `chunkMeshes` (owned by `world`) — 1 site: `ret.setMaterialTable`
  - `ctx` (owned by `lifecycle`) — 1 site: `ret.setMaterialTable`
  - `disposed` (owned by `lifecycle`) — 2 sites: `ret.setMaterialTable`
  - `store` (owned by `world`) — 1 site: `ret.setMaterialTable`

**MUTATES other clusters** (2 edges):
  - `chunkMeshes` (owned by `world`) — 1 site: `ret.setMaterialTable`
  - `dirty` (owned by `world`) — 1 site: `ret.setMaterialTable`

**Read by other clusters** (20 edges):
  - `archetypeById` (read in `analyzer`) — 1 site: `analyzerPlacementGroups` — **cross-MODULE
    since 2026-08-07**, through `substrate.archetypeById()`
  - `archetypeById` (read in `picking`) — 1 site: `pickCandidates` — **cross-MODULE since
    2026-08-07**, and through the SUBSTRATE rather than as a binding read: `field-picking.ts`
    calls `substrate.archetypeById()`. The second extracted reader this thunk has had (after
    `field-props.ts`), which is what the two-reader bar is about
  - `archetypeById` (read in `props`) — 1 site: `rebuildProps`
  - `archetypeById` (read in `stamp`) — 1 site: `sendPreviewJob`
  - `archetypes` (read in `stamp`) — 2 sites: `openStampSession`, `reseedForArchetype`
  - `table` (read in `entities`) — 2 sites: `ret.deleteEntity`, `ret.duplicateEntity`
  - `table` (read in `history`) — 1 site: `stepHistory`
  - `table` (read in `materials`) — 1 site: `buildLitMaterials` — **cross-MODULE since
    2026-08-08**, through `substrate.table()`
  - `table` (read in `stamp`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `sendPreviewJob`
  - `table` (read in `tool`) — 3 sites: `commitToolOp`, `eyedropper`, `isKitFillTool`
  - `table` (read in `world`) — 4 sites: `buildKit`, `compactLoadedLog`, `remeshOne`, `ret.exportArtifact`

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (3):** `setMaterialTable`, `setEntityCatalog`, `listGenerators`


### Cluster: props — **EXTRACTED 2026-08-06**

Lives in `packages/editor/src/field-host/field-props.ts`. The row below is the measurement
it was sized against, annotated with what the move actually cost.

**Owns (state) — 2:** `propMeshes`@1798 · `propCounts`@1804

`propCounts` left as a module-private `let`. `propMeshes` **stayed in the closure** and is
already a `HostSubstrate` value member (it was one before this move — the substrate declared
it at T3a): `render.renderScene` draws from it, and an ARRAY rebuilt by `length = 0` and
re-push is exactly what the substrate's value side is for.

**Owns (functions) — 3:** `proxyGeometry`@2369 · `destroyProps`@2380 · `rebuildProps`@2399

All three moved verbatim and kept their names inside the module. The closure now holds one
`const props = createProps({…})`, at the line the three functions used to start on
(`createSegmentBrush`'s precedent), and calls `props.rebuild()`, `props.destroy(c)` and
`props.instanceCounts()`.

**Reads from other clusters** (5 edges → **4** in the module's `deps`):
  - ~~`analyzePump` (owned by `analyzer`) — 1 site: `rebuildProps`~~ — **RELOCATED, not
    deleted.** The pump request was the third line of one three-line act, so it travelled
    into `markPlacementsStale` with the two flag writes rather than becoming a fourth dep:
    `field-props.ts` never names the pump, but `field-host.ts`'s `markPlacementsStale` arrow
    — the host side of this cluster's seam — still does. The edge is gone from the MODULE
    and still present in the CLOSURE, which is why `analyzer`'s totals below do not move.
    **Re-sited a second time 2026-08-07** (T3d Task 2): the arrow now calls
    `advisor.markPlacementsStale()`, so the pump is not named in this file either and the
    edge is gone from the closure too — a CALL both ends, counted nowhere. The two flag
    writes it carries are still edges and are now MODULE→MODULE (§5.5).
  - `archetypeById` (owned by `catalogs`) — 1 site: `rebuildProps`
  - `ctx` (owned by `lifecycle`) — 1 site: `rebuildProps`
  - `kitMat` (owned by `materials`) — 1 site: `rebuildProps` — **MODULE→MODULE since
    2026-08-08**: a plain ref onto `field-materials.ts`'s seam. It was a single-consumer
    function dep over a host `let` for exactly one day
  - `log` (owned by `world`) — 1 site: `rebuildProps`

`archetypeById`, `ctx` and `log` are `HostSubstrate` members, each on the side the
substrate's doc header predicts: `log` by value, `archetypeById` and `ctx` as thunks.
`kitMat` is NOT in the record, and with exactly ONE extracted reader it rides as a
single-consumer function dep (`voidCastMaterial`'s shape) rather than widening the substrate
— the two-reader bar.

**But the bar governs ADDING a member, not declining one already declared**, and this row is
where the difference first shows: `archetypeById()` also has exactly one extracted reader —
this cluster — and rides in the substrate regardless, because T3a declared it there ahead of
any consumer. `ctx()` is the one with two (`voidcast` and `props`). Reading a declared member
costs nothing new; widening the record for a single consumer charges every future cluster's
assembly. Stated because a later extraction reading only the `kitMat` sentence would conclude
that one reader always means a private dep, and pull `archetypeById` back out.

**MUTATES other clusters** (2 edges, now **1 named call**):
  - `analyzerPlacementsStale` (owned by `analyzer`) — 1 site: ~~`rebuildProps`~~ →
    `field-host.ts`'s `markPlacementsStale`
  - `analyzerWholeWorld` (owned by `analyzer`) — 1 site: ~~`rebuildProps`~~ →
    `field-host.ts`'s `markPlacementsStale`

Both still happen and both still cross a cluster line; what changed is that they cross it as
ONE named write-thunk, `PropsDeps.markPlacementsStale` (`field-segment.ts`'s
`armMaskDropReport` precedent), whose body is an arrow at the `createProps` call site. It
covers the pump request too — the three lines were one statement of intent under one comment,
and a module that set two flags and left the scheduling to a separate dep could set them and
have nothing happen.

**Read by other clusters** (1 edge — and **nine calls the count does not name**):
  - `propMeshes` (read in `render`) — 1 site: `renderScene` — **MODULE→MODULE since
    2026-08-08**, both ends now extracted; the array is shared
    substrate, not a returned value.

**This is the map's loudest instance of §2.1's second correction.** `rebuildProps` has NINE
inbound call sites, in nine functions across six clusters: `commitStampSession` and
`applyReconfigureSession` (`stamp`), `stepHistory` (`history`), `resetWorld` and
`ret.loadWorld` (`world`), `ret.init` (`lifecycle`), `ret.setEntityCatalog` (`catalogs`), and
`ret.deleteEntity` and `ret.duplicateEntity` (`entities`). `destroyProps` adds a tenth caller,
`ret.dispose` (`lifecycle`). None of them is an edge, because edges are over DATA bindings —
so the row above reads as a layer something occasionally looks at, and the truth is a layer
half the host asks to run. Sizing this cluster by its single inbound edge would have been
wrong by 9×; sizing it by its `Partners: 6` figure in §4 happens to land on the right number
for the wrong reason (six clusters, but through calls, not the six data edges counted there).

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (1):** `propInstanceCounts` — unchanged in signature and in behaviour; the
facade now returns `props.instanceCounts()`, which makes the defensive copy the facade used
to make. `field-stamp.test.ts` pins it 19 times and ran unmodified.


### Cluster: tool — **PARTIALLY HOLLOWED 2026-08-07** (T3c: `digging` + `lastStroke` → `field-machine.ts`)

Two of the ten state bindings left with the POINTER CHAIN (T3c's second half, which moved
the four pointer handlers' bodies into `field-machine.ts`): `digging` and `lastStroke` are
the plain brush's stroke state, and those four handlers were their only readers anywhere in
the file — so they went with the chain rather than staying behind a pair of thunks. The
other eight bindings and all twelve functions are still in the closure. `maskDropReported`
is the interesting one that stayed: its BINDING did, while the site that re-arms it moved,
so the edge survives as a call through an `armMaskDropReport` thunk that `field-segment.ts`
was already taking.

**This is the first row here hollowed in PART with the cluster still standing**, and §1's
"subtract the marked rows" instruction does not cover it: skipping this row under-reports,
because eight of its ten bindings and all twelve of its functions are still in the closure.
Read the row, and read the struck edges below as the correction.

**Owns (state) — 10 → 8:** `tool`@1720 · `momentarySaved`@1726 · `momentaryShift`@1727 · `momentaryCtrl`@1728 · `toolChannel`@1744 · `toolErrorChannel`@1750 · `maskDropReported`@1757 · `digRadius`@1986 · ~~`digging`~~ — **moved to `field-machine.ts` 2026-08-07** (module-private at its line 585) · ~~`lastStroke`~~ — **moved 2026-08-07** (586)

**Owns (functions) — 12 → 14:** `reportToolError`@2609 · `sphereShape`@2597 · `toolMask`@2627 · `toolOp`@2657 · `strokeShape`@2690 · `commitToolOp`@2718 · `isKitFillTool`@2736 · `eyedropper`@2831 · `applyTool`@2879 · `applyRadius`@3275 · `notifyTool`@4825 · `deriveMomentary`@4837 — plus two that post-date the measurement: `toolPush`@1740 (the channel's one payload builder, from T3a's seam rework) and `armMaskDropReport`@1764 (the re-arm, an inline arrow until T3c gave it a name because its second caller left the file)

**Reads from other clusters** (7 edges → **6** — a phantom struck at the T3c review):
  - `log` (owned by `world`) — 1 site: `commitToolOp`
  - ~~`selection` (owned by `selection`) — 5 sites: `toolMask`~~ — **PHANTOM, struck
    2026-08-07 (§2.5).** `toolMask` has never read the `selection` binding — verified at the
    production commit `b507d3f6` as well as at head — it asks `currentSelectionSpec()`, a
    CALL, which the edge counts never see. The five "sites" are the five other places the
    word appears in that function: two `m.kind === "selection"`-family string compares, the
    word twice inside one refusal message, and the `selection:` property key of the returned
    mask literal. Both §2.1 phantom classes in one row, and the first multi-site phantom —
    the single-site heuristic there would never have flagged it. The COUPLING is real and
    one function deep; it is call-shaped, exactly like the nine `rebuildProps` callers the
    `props` row names.
  - `store` (owned by `world`) — 4 sites: `commitToolOp`, `eyedropper`
  - `table` (owned by `catalogs`) — 3 sites: `commitToolOp`, `eyedropper`, `isKitFillTool`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (17 → **16** → **14** edges):
  - `digRadius` (read in `input`) — 2 sites: `onKeyDown`, `onWheel`
  - `digRadius` (read in `render`) — 3 sites: `ghostState`, `renderCursorAffordance`,
    `renderGhostLines` — **cross-MODULE since 2026-08-08** (`field-render.ts`) as a thunk (`() => digRadius`). Becomes `tool.digRadius` at Task 4 with no change inside the module
  - `digRadius` (read in `segment`) — 2 sites: `rebuildSegmentPreview`, `segmentClick`
  - `digRadius` (read in `targeting`) — 1 site: `computeTarget` — **cross-MODULE since
    2026-08-07**, as a `digRadius()` thunk dep. The SECOND extracted reader of this `let`
    after `field-segment.ts`'s, and it is still not a substrate member: the bar governs
    ADDING one, and two named function deps spelled the same way is the cheaper answer while
    nothing else asks
  - ~~`digging` (read in `input`) — 1 site: `onPointerMove`~~ — **NOT AN EDGE since 2026-08-07:**
    binding and reader are now both inside `field-machine.ts`, which is what made the move
    free. Same for `lastStroke` below and for both mutations further down.
  - ~~`lastStroke` (read in `input`) — 1 site: `onPointerMove`~~ — **internalised 2026-08-07**
  - `momentaryCtrl` (read in `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `momentaryShift` (read in `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - ~~`tool` (read in `voidcast`) — 1 site: `requestVoidCast`~~ — **PHANTOM, deleted
    2026-08-06.** `requestVoidCast` never read the `tool` binding; the match was the word
    inside a refusal string. See §2.1's third correction for the class of error.

**MUTATED BY other clusters** (11 → **8** edges):
  - ~~`digging` (mutated by `input`) — 2 sites: `onPointerDown`, `onPointerUp`~~ — **internalised 2026-08-07**
  - ~~`lastStroke` (mutated by `input`) — 1 site: `onPointerMove`~~ — **internalised 2026-08-07**
  - `maskDropReported` (mutated by `input`) — 1 site: **`field-machine.ts`'s `pointerDown`**
    since 2026-08-07 (was `onPointerDown` in this file), through the `armMaskDropReport`
    thunk. The binding stayed and the mutator left — still one edge, now a cross-MODULE one.
  - `maskDropReported` (mutated by `segment`) — 1 site: `segmentClick`, through the same
    thunk (a named `const` since 2026-08-07; it was an inline arrow when only one caller
    needed it)
  - `momentaryCtrl` (mutated by `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `momentaryShift` (mutated by `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`

**Public members (4):** `setDigRadius`, `setTool`, `subscribeTool`, `subscribeToolError`


### Cluster: view — **EXTRACTED 2026-08-06**

Lives in `packages/editor/src/field-host/field-view.ts` (214 lines: **44 code**, 166
comment). The row below is the measurement it was sized against, annotated with what the move
actually cost. **This is the row §2.1's second correction gained its ordering clause on** —
and the row that shows the whole page's line-count metric failing, because this cluster is the
smallest of the six in code and the largest in diff.

**Owns (state) — 2:** `layers`@1830 · `sliceY`@1842

Both left. Nothing stayed, and nothing was added to `HostSubstrate` either — despite five
reader clusters between them, which on a reader-count rule would have made both obvious
substrate members. The rule is not reader count: the substrate carries state the HOST still
owns and shares, and state that acquires an OWNER rides on that owner's seam instead. So the
17 `layers` reads spell `viewState.layers()` and not `substrate.layers()`. Same CALL either
way; different answer to "who owns this".

**Owns (functions) — 1:** `sliceOpts`@2732

It moved verbatim onto the module's seam. Its own comment carried a stale count with it —
"the four gesture sites below" against six real call sites (`computeTarget`, `eyedropper`,
`selectionPoint`, `materialSeedVoxel`, `voidSeedVoxel`, `pointerPick`), corrected in the
module.

**Reads from other clusters** (2 edges → **2** in the module's `deps`, but not these two):
  - ~~`selection` (owned by `selection`) — 1 site: `layers`~~ — a PHANTOM. Same family as
    §2.1's third correction but a different mechanism: not a string literal, an object
    PROPERTY KEY. The only `selection` in the `layers` declaration is the flag name
    `selection: true`. It was the only key in that literal that collided with a closure binding
    AT THE MEASUREMENT EPOCH — `propMeshes`, `flagStore` and `gridMinor` are spelled
    differently from the `props`, `flags` and `grid` keys, and `field`/`kit`/`ghost`/`voidCast`
    had no bare closure binding either — which is why the row carries one phantom and not six.
    (T3b1 has since introduced a closure-level `props`, so a re-run of the pass would find a
    second.) Deleted at both ends. **The
    class to carry forward: any single-site edge whose binding name could be a property key of
    a literal in the named site is suspect, exactly as one that could be an English word is.**
  - `store` (owned by `world`) — 1 site: `ret.setSlice`. A `HostSubstrate` value member; needed
    no addition.
  - **+ `dirty`** (owned by `world`) — the mutation edge below, which is a substrate value
    member on the read side of the record too.

**MUTATES other clusters** (1 edge → **1 edge + 2 uncounted CALLS**):
  - `dirty` (owned by `world`) — 1 site: `ret.setSlice`. Unchanged: the module adds every
    allocated chunk key to the host's own set, by identity.
  - **+ `discardVoidCast()` / `requestVoidCast()`** (owned by `voidcast`) — 1 site,
    `ret.setLayers`, the X-ray's on/off edge. **The map never showed this**, because a
    cross-cluster call is not a data edge (§2.1's second correction). It is the load-bearing
    omission of the whole row: it is an ORDERING constraint, so `createView` sits BELOW
    `createVoidCast` in the closure and the compiler now enforces what was previously an
    unwritten agreement.

**Read by other clusters** (5 edges → **26 threaded read sites**):
  - `layers` (read in `lifecycle`) — 1 site: `ret.init` → `viewState.layers().voidCast`
  - `layers` (read in `picking`) — 2 sites: `pickCandidates` — **cross-MODULE since
    2026-08-07**, and a PLAIN ref (`layers: viewState.layers`) rather than an arrow, because
    `createPicking` is deliberately assembled below `createView`
  - `layers` (read in `render`) — 14 sites: `renderScene` — **cross-MODULE since 2026-08-08** (`field-render.ts`) as `layers: viewState.layers`, a plain ref (the count is right, and it is the
    single densest read site in the closure)
  - `sliceY` (read in `targeting`) — 2 sites: `cursorRay`. **The one place the compiler forced
    a local**: the two reads are a null check and a compare in one expression, and narrowing
    does not survive a call boundary, so that site binds the value first and keeps the
    expression verbatim. **MODULE→MODULE since 2026-08-07** — the local is now
    `const sliceY = deps.sliceY()` inside `field-targeting.ts`, and the dep is an ARROW
    because `createView` is assembled ~900 lines BELOW `createTargeting`. The narrowing
    argument survived the move unchanged, which is the useful part: it was never about the
    binding being a closure `let`, only about the read being a call.
  - `sliceY` (read in `world`) — 1 site: `remeshOne`
  - **+ `sliceOpts()`** — 6 sites, counted NOWHERE. It is a call on a function-valued binding,
    and §2.1's second correction is exactly this: the edge counts are over data bindings, so a
    cluster's own exported helper carries no inbound edges however many callers it has. A
    quarter of this move's threading is invisible on this row for that reason.

**Twenty-six READS at twenty-five SITES**, over SIX clusters — `render` 14, `targeting` 6,
`picking` 3, and one each in `lifecycle`, `world` and `tool`. The two counts differ by one
because `cursorRay` reads the plane twice in a single expression: **24 sites changed only the
READ EXPRESSION** (`layers.x` → `viewState.layers().x`, one call for one read), and the 25th
collapsed its two reads into the one forced local above, which keeps its expression verbatim.
Twenty-five calls now stand where twenty-six reads did. No reorder, no hoist, no simplified
conditional, and no
`const l = viewState.layers()` at the top of `renderScene` even though 14 calls in one frame
invite it: the per-read call is the tranche's settled spelling (`field-props.ts`,
`field-stats.ts`), and `renderScene` is render code under the invisible-overlay learning
(2026-07-21), where a visual gate is the only thing that can prove a refactor.

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (2):** `setLayers`, `setSlice` — plain delegates after the move, signatures
and behaviour unchanged.

**THREE decisions this move found unpinned**, by sabotage against the full 1,364-test editor
suite: deleting `setSlice`'s `y === sliceY` guard, replacing `setLayers`' `else if
(!wasVoidCast)` with a bare `else`, and never discarding on the off transition all left the
suite fully green. The thirteen `setLayers` calls in `field-host-void-cast.gpu.test.ts` miss
them because every one of those toggles — so the edge and the level always agree — and because
what they assert is what the worker was SENT, which `requestVoidCast` decides behind its own
four refusals. `packages/editor/tests/field-host/field-view.test.ts` closes all three plus
the copy rule, at the seam the extraction created.


### Cluster: targeting — **EXTRACTED 2026-08-07** (`field-targeting.ts`)

Lives in `packages/editor/src/field-host/field-targeting.ts`. The row below is the
measurement it was sized against, annotated with what the move actually cost. Everything
moved: one binding, six functions, nothing left behind and nothing added to the substrate.

**What the row does not show is that the cluster is a CHAIN.** Six functions in a line —
client pixels → NDC → a world ray with its eye-in-rock probe → four world answers built on
that ray — where each of the four differs from its neighbours by one deliberate rule (the
brush centre is offset off the wall; the selection point is the raw hit for exactly that
reason; the two flood seeds are the solid voxel and the last air voxel before it). All four
are slice-coherent through one seam, which is the property that would have rotted first if
they had ever lived apart.

**`lastPointer` is filed under the DOM by this map and that is a misfiling** of §2.1's
fourth kind — a cluster's state attributed to where it is WRITTEN. It is the ARGUMENT every
one of those functions takes, cached; nothing in the chain reads it, and its three readers
outside are all "where was the cursor". So it went with the functions it is an argument to,
the two delegates became one verb (`notePointer`), and the read side became `pointer()`.

**The seam is 5 of the 6 functions + the 2 pointer members.** `toNdc` did not survive: one
caller, one line down, so it is module-private now — `field-props.ts` giving `proxyGeometry`
back at T3b2 is the precedent.

**Owns (state) — 1:** `lastPointer`@1999 — **moved**

**Owns (functions) — 6:** `toNdc`@2589 · `cursorRay`@2758 · `computeTarget`@2800 · `selectionPoint`@3103 · `materialSeedVoxel`@3155 · `voidSeedVoxel`@3191 — **all six moved**

**Reads from other clusters** (9 edges) — **all nine became `TargetingDeps` members, and
the split across the substrate is the whole of what T3a bought**:
  - `cam` (owned by `camera`) — 2 sites: `cursorRay` — a host `let` NOT in the record, and
    this is its ONLY extracted reader, so it rides as a single-consumer function dep
    (`field-props.ts`'s `kitMat` precedent). The substrate bar refuses it
  - `canvasEl` (owned by `input`) — 2 sites: `toNdc` — SUBSTRATE thunk
  - `digRadius` (owned by `tool`) — 1 site: `computeTarget` — a host `let`, one extracted
    reader beside `field-segment.ts`'s, so a named function dep like that module's
  - `sliceY` (owned by `view`) — 2 sites: `cursorRay` — `field-view.ts`'s, as an ARROW
    because `createView` is assembled ~900 lines BELOW the `createTargeting` call and the
    deps literal is eager. `sliceOpts()` rides beside it, uncounted here for §2.1's second
    reason (it is a call, and it was a call before the move too)
  - `store` (owned by `world`) — 8 sites: `computeTarget`, `cursorRay`, `materialSeedVoxel`, `selectionPoint`, `voidSeedVoxel` — SUBSTRATE, value side

**MUTATES other clusters** (0 edges):
  - none — and it is the only one of T3d Task 1's four with a clean zero here, which is why
    its deps record carries no callback at all

**Read by other clusters** (3 edges — **both readers now cross a MODULE line**):
  - `lastPointer` (read in `move`) — 3 sites: `ret.beginMove` — the facade delegate (@5810)
    reads `targeting.pointer()` to anchor a `G` grab and COPIES before handing the machine a
    plain `{x, y}`. The copy moved to this side deliberately: `pointer()` returns the stored
    object, because the per-frame ghost is the other reader and a defensive copy there would
    allocate every frame
  - `lastPointer` (read in `render`) — 6 sites: `ghostState`, `renderCursorAffordance` —
    **MODULE→MODULE since 2026-08-08**, both ends extracted; both
    now bind `const last = targeting.pointer()` first, for the narrowing reason `cursorRay`'s
    own `sliceY` local states

**MUTATED BY other clusters** (2 edges — both stand, cross-MODULE since 2026-08-07, §5.2):
  - `lastPointer` (mutated by `input`) — 2 sites: `onPointerDown`@5037, `onPointerMove`@5042
    — the assignment became `targeting.notePointer(e.clientX, e.clientY)`; the handlers did
    not move

**Public members (0):** none — internal only


### Cluster: selection

**Owns (state) — 9:** `selection`@1811 · `lastSelection`@1813 · `selectionChannel`@1818 · `selectionBatch`@1825 · `anchorBatch`@1826 · `boxPreviewBatch`@1830 · `boxAnchor`@1810 · `selectionCells`@1878 · `selectionCellsCount`@1882

**Owns (functions) — 17 → 19:** `currentSelectionSpec`@2621 · `selectionAabb`@2890 · `cloneSelectionSpec`@2906 · `selectionInfo`@2919 · `notifySelection`@2946 · `aabbEdgeBatch`@2954 · `rebuildSelectionBatch`@2967 · `destroySelectionCells`@2973 · `rebuildSelectionCells`@2989 · `setBoxAnchor`@3044 · `refreshSelectionDisplay`@3070 · `setSelection`@3091 · `boxRegionSpec`@3123 · `updateBoxPreview`@3136 · `commitSelectionSpec`@3226 · `boxCorner`@3314 · `selectionClick`@3329 — plus the two Esc-rung syncs that post-date the measurement: `syncBoxAnchorCapture`@3037 and `syncSelectionCapture`@3084 (T3a's capture stack, re-based onto `createRung` at T3c)

**Reads from other clusters** (7 edges):
  - `ctx` (owned by `lifecycle`) — 1 site: `rebuildSelectionCells`
  - `selectionCellMat` (owned by `materials`) — 2 sites: `rebuildSelectionCells` —
    **cross-MODULE since 2026-08-08**, `materials.selectionCell()` bound to a local
  - `store` (owned by `world`) — 5 sites: `commitSelectionSpec`, `rebuildSelectionCells`, `selectionAabb`, `selectionClick`, `selectionInfo`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (12 edges → **10** — two phantoms struck, one per review):
  - `anchorBatch` (read in `render`) — 3 sites: `renderScene` — **cross-MODULE since 2026-08-08** (`field-render.ts`)
  - `boxAnchor` (read in `input`) — 2 sites: `escapeLadder`†, `onPointerMove` — since T3c the
    surviving reader is the MACHINE, through the `boxAnchor` liveness thunk on its deps
    record (@4770); no `input` function reads it any more
  - `boxAnchor` (read in `render`) — 1 site: `renderCursorAffordance` — **cross-MODULE since 2026-08-08** (`field-render.ts`)
  - `boxPreviewBatch` (read in `render`) — 3 sites: `renderScene` — **cross-MODULE since 2026-08-08** (`field-render.ts`)
  - `selectionBatch` (read in `render`) — 3 sites: `renderScene` — **cross-MODULE since 2026-08-08** (`field-render.ts`)
  - `selectionCells` (read in `render`) — 2 sites: `renderScene` — **cross-MODULE since 2026-08-08** (`field-render.ts`) — and NARROWED on the way: the seam hands over the instanced MESH, not the `{ im, g }` pair, on `advisor.markerMesh`'s precedent
  - `selection` (read in `camera`) — 2 sites: `frameTargetBox`
  - `selection` (read in `input`) — 1 site: `escapeLadder`†
  - `selection` (read in `stamp`) — 1 site: `ret.startStamp` — since T3c the read lives in
    the `selectionRegion` thunk on the machine's deps record (@4708–4718)
  - ~~`selection` (read in `tool`) — 5 sites: `toolMask`~~ — **PHANTOM, struck 2026-08-07
    (§2.5)**: strings and a property key, never a binding read — and phantom at the
    production commit too. §6's `tool` row carries the anatomy.
  - ~~`selection` (read in `view`) — 1 site: `layers`~~ — **PHANTOM, deleted 2026-08-06**: the
    occurrence is the object KEY `selection: true` in the `layers` literal, not a read of this
    binding. See §6's `view` row for the class.

**MUTATED BY other clusters** (2 edges):
  - `lastSelection` (mutated by `world`) — 1 site: `resetWorld`
  - `selection` (mutated by `world`) — 1 site: `resetWorld`

**Public members (4):** `clearSelection`, `reselect`, `subscribeSelection`, `selectionCellCount`


### Cluster: segment — **EXTRACTED 2026-08-03** (`field-segment.ts` — the first cluster out, before the EXTRACTED heading convention existed; marker added at the 2026-08-07 sweep)

The closure keeps one assembly, `const segment = createSegmentBrush({…})`@3259, whose deps
carry the cluster's whole boundary: `digRadius` as a thunk, `armMaskDropReport` for its one
mutation (§5.5), and — since T3c — the machine reaching `segment.click` / `segment.anchor` /
`segment.updatePreview` as deps of its own. The row below is the birth measurement.

**Owns (state) — 6:** `segmentAnchor`@1747 · `segmentAnchorBatch`@1766 · `segmentPreviewBatch`@1767 · `segmentPreviewEnd`@1773 · `segmentHudChannel` (extracted: `field-segment.ts`@170) · `lastSegmentHud`@1990

**Owns (functions) — 6:** `publishSegmentHud`@3181 · `publishSegmentHudThrottled`@3203 · `setSegmentAnchor`@3219 · `rebuildSegmentPreview`@3255 · `updateSegmentPreview`@3263 · `segmentClick`@3309

**Reads from other clusters** (2 edges):
  - `digRadius` (owned by `tool`) — 2 sites: `rebuildSegmentPreview`, `segmentClick`

**MUTATES other clusters** (1 edge):
  - `maskDropReported` (owned by `tool`) — 1 site: `segmentClick`

**Read by other clusters** (5 edges):
  - `segmentAnchorBatch` (read in `render`) — 3 sites: `renderScene` — **MODULE→MODULE since 2026-08-08**
  - `segmentAnchor` (read in `input`) — 2 sites: `escapeLadder`†, `onPointerMove`
  - `segmentAnchor` (read in `render`) — 1 site: `renderCursorAffordance` — **MODULE→MODULE since 2026-08-08**
  - `segmentPreviewBatch` (read in `render`) — 3 sites: `renderScene` — **MODULE→MODULE since 2026-08-08**

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (1):** `subscribeSegmentHud`


### Cluster: gesture — **EXTRACTED 2026-08-07** (`field-machine.ts`, with `stamp` + `move`)

All four bindings and both functions left, and they left INSIDE the session machine rather
than as a module of their own — `setGesture` cancels a move in flight and drops the pending
arm, and `suspendedByStamp` reads the session, so a `gesture` module would have been a
third of one state machine. The row below is the measurement it was sized against.

The facade's `setGesture` BODY moved with them (it was never listed here as a function —
the row counts closure functions, and this one lived in the `return {}` literal). What
stayed on the host side is the box anchor it clears, which belongs to `selection`: the
machine takes `setBoxAnchor` and `segment.setAnchor` as deps.

**Owns (state) — 4:** `gesture`@1740 · `pendingStamp`@1780 · `pendingStampChannel`@1813 · `suspendReported`@1786 — **all four moved**

**Owns (functions) — 2:** `setPendingStamp`@2992 · `suspendedByStamp`@6045 — **both moved**

**Reads from other clusters** (1 edge):
  - `stamp` (owned by `stamp`) — 1 site: `suspendedByStamp`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (14 edges):
  - `gesture` (read in `camera`) — 1 site: `orbitPivot`
  - `gesture` (read in `entities`) — 1 site: `gizmoVisible`
  - `gesture` (read in `input`) — 8 sites: `onPointerDown`, `onPointerMove`, `onWheel`, `syncCursor`
  - `gesture` (read in `render`) — 2 sites: `renderCursorAffordance`, `renderScene` — **MODULE→MODULE since 2026-08-08**
  - `pendingStamp` (read in `input`) — 5 sites: `escapeLadder`†, `onPointerDown`, `onPointerMove`, `syncCursor`
  - `pendingStamp` (read in `render`) — 2 sites: `renderCursorAffordance` — **MODULE→MODULE since 2026-08-08**
  - `pendingStamp` (read in `stamp`) — 1 site: `stampRegionClick`

**MUTATED BY other clusters** (2 edges):
  - `suspendReported` (mutated by `stamp`) — 2 sites: `openEntitySession`, `openStampSession`

**Public members (2):** `setGesture`, `subscribePendingStamp`


### Cluster: stamp — **EXTRACTED 2026-08-07** (`field-machine.ts`, with `gesture` + `move`)

**§7.5 below is the honest prediction this row's extraction was measured against, and it
held on every count that mattered.** It cannot go without `move` (it didn't — they left
together), and `cancelStampSession`'s 14 call sites across 7 clusters had to be inverted
into a callback (they were — every one is `machine.cancelSession()` now). What §7.5 named
as the precondition is what changed between the measurement and the move: the substrate
(§7.3 step 1) exists, so the 22 inbound reads collapse to one record plus a handful of
named thunks, and the Esc LADDER became a capture STACK, so the cluster owns its own
cancellable state without the host holding a list of rungs.

Two things the row could not predict, both worth recording:

- **`ghostMeshes` stayed**, and it is the only one of the seven state bindings that did.
  It is a `HostSubstrate` VALUE member because `renderScene` draws from it, so the module
  fills the host's own Map by identity rather than owning a second one — the
  `voidCastMeshes` precedent exactly. Its partner `placementGhost` DID move: it is a
  CPU-only line batch with no GPU handle for `dispose` to free.
- **Three verbs that are not on this row moved with it**, because a row measures closure
  functions and these lived in the `return {}` literal: the bodies of `startStamp`,
  `updateStamp` and `rerollStamp`. The first is why the machine takes a `selectionRegion`
  thunk; the other two are why `setStamp` and `stampTouched` never had to become public
  surface. All three facade members are one-line delegates now.

**Owns (state) — 7:** `stamp`@1845 · `stampGen`@1850 · `stampTouched`@1855 · `stampChannel`@1893 · `ghostMeshes`@1877 (**STAYED** — substrate value member, see above) · `placementGhost`@1886 · `previewCoalescer`@4951 — **six of seven moved**

**Owns (functions) — 19:** `randomStampSeed`@3576 · `notifyStamp`@3584 · `destroyStampGhosts`@4088 · `applyStampGhost`@4156 · `sendPreviewJob`@4851 · `previewStamp`@4970 · `nudgeStampRegion`@4982 · `rotationOptions`@4994 · `rotateStampSession`@5017 · `cancelStampSession`@5038 · `reseedForArchetype`@5066 · `openStampSession`@5088 · `stampRegionClick`@5135 · `reportEmptyPreview`@5176 · `commitStampSession`@5196 · `openEntitySession`@5246 · `applyReconfigureSession`@5436 · `commitActiveSession`@5512 · `confirmActiveSession`@5532 — **all nineteen moved**

**Reads from other clusters** (22 edges):
  - `archetypeById` (owned by `catalogs`) — 1 site: `sendPreviewJob`
  - `archetypes` (owned by `catalogs`) — 2 sites: `openStampSession`, `reseedForArchetype`
  - `ctx` (owned by `lifecycle`) — 2 sites: `applyStampGhost`, `destroyStampGhosts`
  - `dirty` (owned by `world`) — 1 site: `commitStampSession`
  - `disposed` (owned by `lifecycle`) — 3 sites: `previewCoalescer`, `sendPreviewJob`
  - `log` (owned by `world`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `openEntitySession`
  - `moveCommitPending` (owned by `move`) — 1 site: `sendPreviewJob`
  - `moveDrag` (owned by `move`) — 1 site: `confirmActiveSession`
  - `pendingStamp` (owned by `gesture`) — 1 site: `stampRegionClick`
  - `selection` (owned by `selection`) — 1 site: `ret.startStamp`
  - `store` (owned by `world`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `sendPreviewJob`
  - `table` (owned by `catalogs`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `sendPreviewJob`
  - `worker` (owned by `world`) — 1 site: `sendPreviewJob`

**MUTATES other clusters** (5 edges):
  - `drift` (**since 2026-08-07 owned by `field-drift.ts`**) — 1 site: `applyReconfigureSession`
    — MODULE→MODULE now, through the `setDrift: drift.set` dep
  - `lastReconfigureMs` (owned by `stats`) — 1 site: `applyReconfigureSession`. Still one
    site, now a named CALL: `stats.noteReconfigureMs(…)` (`field-stats.ts`, extracted
    2026-08-06).
  - `moveCommitPending` (owned by `move`) — 2 sites: `sendPreviewJob`
  - `suspendReported` (owned by `gesture`) — 2 sites: `openEntitySession`, `openStampSession`

**Read by other clusters** (17 edges):
  - `ghostMeshes` (read in `render`) — 1 site: `renderScene` — **MODULE→MODULE since 2026-08-08**, through the substrate
  - `placementGhost` (read in `render`) — 3 sites: `renderScene` — **MODULE→MODULE since 2026-08-08**
  - `stamp` (read in `entities`) — 4 sites: `gizmoVisible`, `ret.bakeEntity`, `ret.deleteEntity`, `ret.setEntityFrozen`
  - `stamp` (read in `gesture`) — 1 site: `suspendedByStamp`
  - `stamp` (read in `history`) — 1 site: `stepHistory`
  - `stamp` (read in `input`) — 5 sites: `escapeLadder`†, `onKeyDown`, `syncCursor`
  - ~~`stamp` (read in `materials`) — 1 site: `stampGhostMaterial`~~ — **STRUCK 2026-08-08,
    a §2.1 STRING-LITERAL PHANTOM**: the only occurrence is the word inside the function's
    own throw message. See the `materials` row for the other end and for what the phantom
    would have cost the assembly order
  - `stamp` (read in `move`) — 8 sites: `beginMoveSession`, `cancelMoveInFlight`, `dropMove`, `updateMove`
  - `stamp` (read in `render`) — 1 site: `renderScene` — **MODULE→MODULE since 2026-08-08** (`machine.session()`)

**MUTATED BY other clusters** (1 edge):
  - `stamp` (mutated by `move`) — 1 site: `dropMove`

**Public members (11):** `startStamp`, `updateStamp`, `nudgeStamp`, `rotateStamp`, `rerollStamp`, `commitStamp`, `confirmSession`, `cancelStamp`, `subscribeStamp`, `openEntity`, `applyReconfigure` — `commitSession` was the 12th until foundations T3c deleted it (zero production callers)


### Cluster: drift — **EXTRACTED 2026-08-07** (`field-drift.ts`)

Lives in `packages/editor/src/field-host/field-drift.ts`. The row below is the measurement
it was sized against; both bindings and all three functions moved.

**THIS IS THE ROW THE MAP ITSELF SAID WAS NOT A CLUSTER**, and reading why it extracted
anyway is worth more than the move. §3.3: *"`drift` is a result slot, not a cluster. All
three writes to `drift` come from other clusters; nothing in the `drift` cluster writes
it."* That is true and it is exactly what made the row look unextractable — state written
only by its neighbours has no obvious owner, and the instinct is to leave the `let` where
all of them can reach it.

**The instinct is wrong, and §3.3's own wording says why: the READERS decide.** There are
two and both are this module's — the panel seam and the payload builder that shapes what
the seam pushes. Nothing outside reads the findings at all; every writer writes and then
asks for a push. So the state travelled with what reads it and the four writers got a
two-verb seam. **The general rule, which the next result-slot row should be read against:
a write-only-from-outside binding is owned by its readers, not by its writers.**

**The seam is 4 members and the third of them earns its place from ONE caller.** `set` and
`notify` are separate because host state settles first and notifications go last (the
field-host ordering rule — `MachineDeps.setDrift` already said so and this move kept the
shape). `standing()` exists because `stepHistory`'s clear is the only CONDITIONAL one of the
four, and that condition is behaviour: `ViewChannel.publish` has no change detection by
design, so an unconditional clear would push `null` to the panel on every keystroke of a ⌘Z
run. Folding the guard into `set` would have silently changed the other three sites.
`subscribe` takes the channel with it, as `field-history-feed.ts` and `field-stats.ts` did.

**Owns (state) — 2:** `drift`@1906 · `driftChannel`@1907 — **both moved**

**Owns (functions) — 3:** `driftedEntities`@3595 · `driftPayload`@3626 · `notifyDrift`@3631 — **all three moved; the first two are module-private**

**Reads from other clusters** (1 edge):
  - `store` (owned by `world`) — 1 site: `driftedEntities` — SUBSTRATE, value side. The
    module's ONE named dep beside it is `entityFootprints`, a call, counted nowhere
    (§2.1) — and it is what forces the assembly's position: the payload derives its badge
    ids from the footprints, so `const drift = createDrift(…)` sits just past that memo
    (@3379) rather than where the cluster's functions were ~100 lines up

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (1 edge):
  - `drift` (read in `history`) — 1 site: `stepHistory` — now `drift.standing()`, and the
    only reason that member exists

**MUTATED BY other clusters** (3 edges — **all three stand**, §5.5; all three now cross a
module line):
  - `drift` (mutated by `history`) — 1 site: `stepHistory`@4523 — closure → MODULE
  - `drift` (mutated by `stamp`) — 1 site: `applyReconfigureSession` — **MODULE→MODULE since
    2026-08-07**: the writer is `field-machine.ts`@1595 and the slot is now
    `field-drift.ts`'s, so the T3c-era write-thunk at the machine assembly became that
    module's own verb (`setDrift: drift.set`, dep @4452). Both ends have left
  - `drift` (mutated by `world`) — 1 site: `resetWorld`@5366 — closure → MODULE

**Public members (2):** `subscribeDrift`, `dismissDrift` — both one-line delegates now


### Cluster: entities

**Owns (state) — 8:** `selectedEntityId`@1937 · `entitySelectionBatch`@1938 · `entitySelectionChannel`@1942 · `gizmo`@1951 · `gizmoBatch`@1952 · `footprintCache`@3687 · `footprintSig`@3688 · `entitiesChannel`@1914

**Owns (functions) — 9 → 10:** `entityRecord`@3638 · `entityFootprints`@3689 · `rebuildEntitySelectionBatch`@3718 · `gizmoVisible`@3752 · `activeGizmoAxis`@3762 · `gizmoAxisAt`@3767 · `setSelectedEntity`@4001 · `revalidateEntitySelection`@4011 · `notifyEntities`@3577 — plus its Esc-rung sync, `syncSelectedEntityCapture`@3975 (post-dates the measurement)

**Reads from other clusters** (22 edges):
  - `dirty` (owned by `world`) — 2 sites: `ret.deleteEntity`, `ret.duplicateEntity`
  - `gesture` (owned by `gesture`) — 1 site: `gizmoVisible`
  - `log` (owned by `world`) — 14 sites: `entityFootprints`, `entityRecord`, `ret.bakeEntity`, `ret.deleteEntity`, `ret.duplicateEntity`, `ret.listEntities`, `ret.setEntityFrozen`
  - `moveDrag` (owned by `move`) — 2 sites: `activeGizmoAxis`, `gizmoVisible`
  - `stamp` (owned by `stamp`) — 4 sites: `gizmoVisible`, `ret.bakeEntity`, `ret.deleteEntity`, `ret.setEntityFrozen`
  - `store` (owned by `world`) — 3 sites: `entityFootprints`, `ret.deleteEntity`, `ret.duplicateEntity`
  - `table` (owned by `catalogs`) — 2 sites: `ret.deleteEntity`, `ret.duplicateEntity`
  - `worldEpoch` (owned by `world`) — 1 site: `entityFootprints`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (6 edges):
  - `entitySelectionBatch` (read in `render`) — 3 sites: `renderScene` — **cross-MODULE since 2026-08-08** (`field-render.ts`)
  - `gizmoBatch` (read in `render`) — 3 sites: `renderScene` — **cross-MODULE since 2026-08-08** (`field-render.ts`)
  - `gizmo` (read in `camera`) — 2 sites: `orbitPivot`
  - `selectedEntityId` (read in `camera`) — 2 sites: `frameTargetBox`
  - `selectedEntityId` (read in `input`) — 1 site: `escapeLadder`†
  - `selectedEntityId` (read in `picking`) — 3 sites: `pointerPress` — **cross-MODULE since
    2026-08-07**, as a `selectedEntityId()` thunk dep (one extracted reader, so the substrate
    bar refuses it). Two of the three sites collapse to one local for the narrowing reason;
    the third is deliberately re-read after `pointerPick` runs

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (8):** `setEntityFrozen`, `bakeEntity`, `deleteEntity`, `duplicateEntity`, `listEntities`, `selectEntity`, `subscribeEntitySelection`, `subscribeEntities`


### Cluster: move — **EXTRACTED 2026-08-07** (`field-machine.ts`, with `stamp` + `gesture`)

It left WITH `stamp` and could not have left without it: the move's session IS the `stamp`
slot (§7.2), so the two share `setStamp`, `demoteStalledMove` and the one Esc rung that
stands while either is live. All three bindings and all seven functions moved, plus two
that post-date this measurement — `setPendingMove` and its rung `syncPendingMoveCapture`
(T3c Task 2's canonical setter) and `moveChangedNothing` (the drop's zero-step test, which
reads the REGION rather than the cursor since T3c Task 1).

**Owns (state) — 3:** `moveDrag`@1910 · `moveCommitPending`@1916 · `pendingMove`@1921 — **all three moved**

**Owns (functions) — 7:** `endMove`@5297 · `beginMoveSession`@5306 · `updateMove`@5339 · `reaimMove`@5383 · `demoteStalledMove`@5396 · `dropMove`@5400 · `cancelMoveInFlight`@6180 — **all seven moved**

**Reads from other clusters** (5 edges):
  - `lastPointer` (**since 2026-08-07 owned by `field-targeting.ts`**) — 3 sites: `ret.beginMove`
  - `stamp` (owned by `stamp`) — 8 sites: `beginMoveSession`, `cancelMoveInFlight`, `dropMove`, `updateMove`

**MUTATES other clusters** (1 edge):
  - `stamp` (owned by `stamp`) — 1 site: `dropMove`

**Read by other clusters** (10 edges):
  - `moveCommitPending` (read in `stamp`) — 1 site: `sendPreviewJob`
  - `moveDrag` (read in `entities`) — 2 sites: `activeGizmoAxis`, `gizmoVisible`
  - `moveDrag` (read in `input`) — 7 sites: `escapeLadder`†, `onPointerDown`, `onPointerMove`, `onPointerUp`, `syncCursor`
  - `moveDrag` (read in `stamp`) — 1 site: `confirmActiveSession`
  - `pendingMove` (read in `input`) — 2 sites: `onPointerMove`

**MUTATED BY other clusters** (4 edges):
  - `moveCommitPending` (mutated by `stamp`) — 2 sites: `sendPreviewJob`
  - `pendingMove` (mutated by `input`) — 2 sites: `onPointerMove`, `onPointerUp`
  - `pendingMove` (mutated by `picking`) — 1 site: `pointerPress`

**Public members (1):** `beginMove`


### Cluster: history — **the FEED EXTRACTED 2026-08-06; `stepHistory` stayed**

The feed lives in `packages/editor/src/field-host/field-history-feed.ts` — **not** in
`field-history.ts`, which is the pure label-derivation module next door and whose header
rules state out as a contract. The row below is the measurement it was sized against,
annotated with what the move actually cost. It is the only row here that a cluster **half**
left, and the only one whose original function count was wrong.

**Owns (state) — 2:** `historyChannel`@1910 · `historySig`@1868

Both left; nothing stayed. This row's own "Read by other clusters: none" is why there was
nothing for the substrate to hold — the second extraction after `stats` that added no
member and left no container behind.

**Owns (functions) — 2 at the original pass, 3 as built:** `historySignature` and
`notifyHistory` live in `field-history-feed.ts` now; `stepHistory` is at **4784** in this
file (re-anchored 2026-08-07), directly below the machine assembly, and the feed's own
assembly `const historyFeed = createHistoryFeed({ substrate })` sits at **3564**, where the
two departed functions were. (The row used to carry `historySignature`@3555 — a T3b1-BASE
line — beside `notifyHistory`@3617 and `stepHistory`@5550 — original-pass lines:
**mixed-epoch numbers**, which was the shape of the correction below rather than an
untidiness in it; §2.5's sweep retires the mixture.)

`historySignature` is absent from the original list because **it did not exist at the original
pass.** At the map's production commit `b507d3f6`, `notifyHistory` built the signature INLINE
(`const sig = { undoLen: …, redoLen: …, undoTop: …, redoTop: … }`, `b507d3f6:field-host.ts`
:3617–3636) against a single-slot `historyCb`. The named `const historySignature` arrived later,
in `83097df2` ("the thirteen subscribe seams go multicast"), when the seam became a channel and
the facade needed to compute a signature of its own. Two callers from that day on —
`notifyHistory` and `subscribeHistory` — **which is exactly why that seam was not a delegate.**
The row is updated to the as-built count of 3.

**No inference about the map's completeness follows, and the arithmetic that looks like it does
is a trap.** §6's function counts summed to **160** at this row's writing against the **161**
arrow-valued bindings §1 then carried (the 2026-08-07 re-derivation replaced that figure with
head truth — 125 — so the numbers in this paragraph are all its own epoch's), but that gap is
not an omission: the `input` row was decremented **13 → 12** post-hoc
for `escapeLadder`'s deletion (§2.2), and summing §6 at the ORIGINAL epoch — `input` 13,
`history` 2 — gives **161 exactly**, matching §1. The state columns sum to 132 at both epochs,
so they are not a control for the function side: state rows survived their renames, the function
side carries a real deletion. **The map's function lists were complete and self-consistent when
measured.**

What this row actually exposes is more useful than a miscount: **§6 is a MIXED-EPOCH record.**
Some rows have been updated for later changes (`input`'s 13 → 12, the seam bindings' re-measured
lines, the four EXTRACTED annotations) and some have not, and nothing marks which is which. A
reader re-deriving from this document — §7's follow-on work does exactly that — must date each
row before trusting it, and must not reconcile a §6 total against a §1 figure without checking
that the two were measured at the same epoch. That is the standing hazard; this row is one
instance of it, not the discovery of a gap.

Two of the three left — `historySignature` (still module-private, now typed by a named
`HistorySignature` because `NonNullable<typeof historySig>` cannot cross a file boundary) and
`notifyHistory` (as `HistoryFeed.notify`).

**`stepHistory` STAYED, and that is a finding rather than an omission.** It wears the
cluster's name and belongs to none of it: its body calls into FIVE other clusters —
`markDirtyWithNeighbors` (`world`), `cancelStampSession` (`stamp`),
`revalidateEntitySelection` AND `notifyEntities` (`entities`), `props.rebuild()` (the
extracted prop layer) and `notifyDrift` (`drift`) — and it does not name the history seam at
all. Its push arrives through `notifyEntities`, which carries it by that seam's own contract,
so `stepHistory` needed **no edit whatsoever** in this move. It is a lifecycle verb wearing a
history name: what it owns is "everything one undo/redo step can move", of which the history
push is the smallest part. §2.1's second correction (calls are not edges) is what hid this —
five of its six outbound couplings are calls, so the row's 7 edges size the wrong thing.

**Reads from other clusters** (6 edges → the module's `deps` takes **1**):
  - `drift` (**since 2026-08-07 owned by `field-drift.ts`**) — 1 site: `stepHistory` — the
    slot LEFT and `stepHistory` did not follow it: the read is `drift.standing()`, the only
    conditional clear of the four, and the only reason that seam member exists
  - `log` (owned by `world`) — 8 sites: `notifyHistory`, `stepHistory` — **SPLIT**: the
    `notifyHistory` sites left with the feed (as `deps.substrate.log`, a value member that
    needed no addition to the record); the `stepHistory` sites stayed. The only binding in
    this document an extraction has read from both sides of the boundary.
  - `stamp` (owned by `stamp`) — 1 site: `stepHistory` — **stays**
  - `store` (owned by `world`) — 2 sites: `stepHistory` — **stays**
  - `table` (owned by `catalogs`) — 1 site: `stepHistory` — **stays**

So the module's whole dependency record is `{ substrate }` — the shortest in the tranche, and
the first with nothing beside the substrate in it. Nothing rides as a private thunk because
nothing this half reads is a `let`.

**MUTATES other clusters** (1 edge — **stands; cross-MODULE since 2026-08-07**):
  - `drift` (**owned by `field-drift.ts`**) — 1 site: `stepHistory` — `drift.set(null)` +
    `drift.notify()`, inside the `drift.standing()` guard

**Read by other clusters** (0 edges):
  - none

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (3):** `undo`, `redo`, `subscribeHistory`. The first two call `stepHistory`
and are untouched. **`subscribeHistory` is the point of the extraction**: it was the LAST of
the host's thirteen `subscribe*` members that did work before delegating — it wrote the
change signature ahead of the channel's snapshot — and that line now lives inside
`HistoryFeed.subscribe`, so the facade seam is a one-line delegate like the other twelve.
Same signature, same observable behaviour; `tests/field-host-history.test.ts` (9 tests) and
`tests/chrome/history-palette.test.tsx` (14) both ran with their ASSERTIONS unmodified (three
comment lines in the former were later re-pointed at the feed's new name).

**A coverage hole was found and closed at the seam.** The record-before-subscribe ORDERING was
pinned by nothing in the PRE-EXISTING suite: reversing the two statements left it entirely green
(1,363/0 either way, verified by sabotage), because no test there subscribes a callback that
calls back into the host from inside its own first push. The record-rather-than-CLEAR half *is*
pinned (clearing reddens two tests in `field-host-history.test.ts`). One unit,
`tests/field-host/field-history-feed.test.ts`, now covers the ordering alone — with it in
place the same reversal reddens exactly that one test.


### Cluster: voidcast — **EXTRACTED 2026-08-06**

Lives in `packages/editor/src/field-host/field-voidcast.ts`. The row below is the
measurement it was sized against, annotated with what the move actually cost.

**Owns (state) — 3:** `voidCastMeshes`@1939 · `voidCastGen`@1948 · `voidCastJobGen`@1955

Two of the three left as module-private `let`s. `voidCastMeshes` **stayed in the closure**
and became a `HostSubstrate` value member: `render.renderScene` draws from it, and a `const`
Map whose identity is the contract is exactly what the substrate's value side is for — the
module fills and empties the host's own object rather than a copy of it.

**Owns (functions) — 5:** `destroyVoidCast`@4188 · `discardVoidCast`@4204 · `invalidateVoidCast`@4214 · `applyVoidCast`@4246 · `requestVoidCast`@4302

All five moved verbatim, and all five kept their names inside the new module (the closure
now holds one `const voidcast = createVoidCast({…})` and calls `voidcast.invalidate()`,
`.discard()`, `.request()`). `VOID_CAST_CHUNK_BUDGET` moved with them — `requestVoidCast` is
its only reader. `chunkCopy` and `snapshotAllChunks`, which sat inside the same region,
**stayed**: the analyzer mirror copies chunks through them too, so they are `world`'s, and
`snapshotAllChunks` arrives back as a dep. (`chunkCopy` acquired a second extracted reader on
2026-08-07 — `field-analyzer.ts` takes it as a dep for the mirror sync — which is what the
"the analyzer mirrors chunks through them too" sentence was predicting.)

**Reads from other clusters** (7 → **6** edges):
  - `ctx` (owned by `lifecycle`) — 3 sites: `applyVoidCast`, `destroyVoidCast`, `requestVoidCast`
  - `disposed` (owned by `lifecycle`) — 2 sites: `requestVoidCast`
  - `store` (owned by `world`) — 2 sites: `requestVoidCast`
  - ~~`tool` (owned by `tool`) — 1 site: `requestVoidCast`~~ — **PHANTOM, deleted
    2026-08-06** (§2.1's third correction: the match was a word in a refusal string).
  - `worker` (owned by `world`) — 1 site: `requestVoidCast`

All four survivors are `HostSubstrate` members and every one of them is on the side the
substrate's own doc header predicts: `store` and `worker` by value, `ctx` and `disposed` as
thunks. Nothing in this cluster's `deps` record is a raw `let`.

**Plus four function calls the edge count does not name** (§2.1's second correction, and the
half of the coupling this row understates): `tool.reportToolError`, `world.snapshotAllChunks`,
`world.chunkOrigin` and `materials.voidCastMaterial`. All four are `const` arrows, so they
pass by reference.

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (2 edges):
  - `voidCastJobGen` (read in `lifecycle`) — 1 site: `tick` — now `voidcast.jobGen()`, which
    returns `number | null` exactly as the binding did; `tick` still publishes
    `FieldStats.voidCastPending` as `!== null`.
  - `voidCastMeshes` (read in `render`) — 1 site: `renderScene` — **MODULE→MODULE since
    2026-08-08**, both ends extracted and still one identity; the map is
    shared substrate, not a returned value.

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (0):** none — internal only. Confirmed by the move: no `FieldHost`
signature changed, and every existing pin ran unmodified.


### Cluster: analyzer — **EXTRACTED 2026-08-07** (`field-analyzer.ts`, foundations T3d Task 2)

**The largest single cluster this map has recorded moving**, and the only one to leave a
binding behind for a reason that is neither "`renderScene` draws it" nor "it stayed with its
readers": `flagStore` is a substrate value member and the substrate outranks every module.
§2.7 carries the four findings; the lists below are re-homed per edge.

**Owns (state) — 19 → 1:** `analyzer`@4176 · **`flagStore`@1864 — STAYED** (a
`HostSubstrate` value member; hoisted here at T3b1 because the record's value side is read
eagerly, and now a FOURTH substrate leftover beside `propMeshes` / `ghostMeshes` /
`voidCastMeshes` — §2.7) · `flagsChannel`@4182 · `agentProfile`@4188 ·
`agentProfileAnswered`@4199 · `profileMissingReported`@4204 · `analyzerDirty`@4210 ·
`analyzerStale`@4214 · `analyzerResync`@4217 · `analyzerPlacementsStale`@4220 ·
`analyzerWholeWorld`@4222 · `analyzerSeeds`@4228 · `analyzerBusy`@4231 · `analyzerIdle`@4232
· `verifyInFlight`@4449 · `flagMarkers`@1866 · `markerCount`@1870 ·
`flagSelectionBatch`@1967 · `analyzePump`@4417 *(every `@line` except `flagStore`'s is the
pre-extraction anchor, kept as the record of where the cluster was)*

**Owns (functions) — 14 → 0:** `reportAnalyzerFailure` · `analyzerPlacementGroups` ·
`analyzerHasWork` · `postMirrorSync` · `analyzerFire` · `publishFlags` · `setSelectedFlag` ·
`selectFlagImpl` · `scheduleWholeWorldPass` · `verifyFlagImpl` · `analyzerPendingCount` ·
`destroyFlagMarkers` · `rebuildFlagMarkers` · `rebuildFlagSelection` — all fourteen in
`field-analyzer.ts`. Four module-scope constants went with them (`ANALYZER_ENGINE_URL`,
`VERIFY_BUDGET_MS`, `FLAG_MARKER_SIZE_M`, `ANALYZER_IDLE_MS`); each had exactly one reader.

**Reads from other clusters** (15 edges → **13 as the module's `deps`, 1 struck, 1 unmoved**):
  - `archetypeById` (owned by `catalogs`) — 1 site: `analyzerPlacementGroups` — **cross-MODULE**,
    through `substrate.archetypeById()`
  - `ctx` (owned by `lifecycle`) — 1 site: `rebuildFlagMarkers` — **cross-MODULE**, through
    `substrate.ctx()`
  - `disposed` (owned by `lifecycle`) — 4 sites: `analyzePump`, `analyzerFire`,
    `reportAnalyzerFailure`, `verifyFlagImpl` — **cross-MODULE**, through
    `substrate.disposed()`. The loudest thunk in the module: four async settlements guard on
    it, and a snapshot would read `false` forever
  - `flagMarkerMat` (owned by `materials`) — 2 sites: `rebuildFlagMarkers` —
    **MODULE→MODULE since 2026-08-08**, a plain ref onto `field-materials.ts`'s seam,
    as a SINGLE-CONSUMER FUNCTION DEP rather than a substrate widening (`field-props.ts`'s
    `kitMat` precedent; one extracted reader, and the bar is two)
  - `log` (owned by `world`) — 1 site: `analyzerPlacementGroups` — **cross-MODULE**, through
    `substrate.log`
  - ~~`orbitState` (owned by `camera`) — 1 site: `selectFlagImpl`~~ — **STRUCK 2026-08-07,
    re-homed rather than moved** (the `camera.look ← input` precedent, §5.2). The two lines
    were `aimCamera(frameBox(orbitState, …))` + `applyOrbit()` — the camera's own composition
    over the camera's own state — so they stayed in the closure behind one named dep
    (`frameCameraOn`) and the module hands over a box. §2.7's third bullet states the rule
  - `store` (owned by `world`) — 7 sites: `analyzerHasWork`, `postMirrorSync`,
    `rebuildFlagMarkers`, `rebuildFlagSelection`, `selectFlagImpl` — **cross-MODULE**,
    through `substrate.store`
  - `worldEpoch` (owned by `world`) — 2 sites: `verifyFlagImpl` — **cross-MODULE**, as a
    SINGLE-CONSUMER FUNCTION DEP. It is the one `world` binding that used to be DECLARED
    inside the advisor block; it moved up to sit directly above the assembly so the thunk
    reads a binding above it

  Two further deps the map never counted, both CALLS (§2.1's second correction):
  `reportToolError` (the host's error funnel) and `chunkCopy` (the host's, shared with the
  void cast's snapshot). And one that is neither a read nor a call but a construction
  parameter: `deps.spawnAnalyzer`.

**MUTATES other clusters** (0 edges):
  - none — unchanged by the move, and the reason it could leave in one piece. An advisory
    layer writes nothing anyone else's correctness depends on

**Read by other clusters** (10 edges → **7 became CALLS, 2 stand as reads, 1 unchanged**):
  - ~~`analyzePump` (read in `props`)~~ — 1 site: the host's `markPlacementsStale` arrow —
    **GONE as a read 2026-08-07**: the arrow calls `advisor.markPlacementsStale()`, which
    owns the pump request. The coupling is the same and the map cannot see it
  - ~~`analyzePump` (read in `world`)~~ — 3 sites: `markDirtyWithNeighbors`, `ret.loadWorld`,
    `ret.newWorld` — **GONE as reads 2026-08-07**: `advisor.noteDensityWritten(changed)` at
    the choke point, `advisor.requestPass()` at the two world verbs
  - ~~`analyzerIdle` (read in `lifecycle`)~~ — 2 sites: `ret.dispose` — **GONE as reads**:
    the `clearTimeout` pair went inside `advisor.dispose()`
  - ~~`analyzer` (read in `lifecycle`)~~ — 1 site: `ret.dispose` — **GONE as a read**: same
    call. The worker client is module-private now
  - `flagMarkers` (read in `render`) — 2 sites: `renderScene` — **stands, MODULE→MODULE
    since 2026-08-08**,
    through `advisor.markerMesh()` bound to a local (narrowing does not survive a call
    boundary). The seam publishes the instanced MESH, not the `{ im, g }` pair — the geometry
    is the module's to free and `renderScene` never wanted it
  - `flagSelectionBatch` (read in `render`) — 3 sites: `renderScene` — **stands,
    MODULE→MODULE since 2026-08-08;
    cross-MODULE**, through `advisor.selectionBatch()`, same shape
  - ~~`flagStore` (read in `lifecycle`)~~ — 1 site: `ret.init` — **GONE as a read**: the
    replay is `advisor.rebuildMarkers()`, which reads its own summary
  - `flagStore` (read in `picking`) — 1 site: `pickCandidates` — **unchanged**, cross-MODULE
    through `substrate.flagStore` since 2026-08-07. The one inbound edge this move did not
    touch, because it was already on the substrate

  **And TWO uncounted inbound CALLS, which the seam makes visible for the first time**
  (§2.1's second correction, from the other side): `field-picking.ts` takes
  `setSelectedFlag` as a plain ref — the viewport's marker click, straight past the public
  verb — and `field-stats.ts` takes `analyzerPendingCount`. Neither appears in any edge
  count on this page, and the first is what pins `createPicking`'s assembly below
  `createAnalyzer`'s.

**MUTATED BY other clusters** (14 edges — **all 14 stand, all 14 now cross a module line**):
  - `analyzerDirty` (mutated by `world`) — 2 sites: `markDirtyWithNeighbors`, `resetWorld` →
    `noteDensityWritten`, `retireWorld`
  - `analyzerIdle` (mutated by `lifecycle`) — 1 site: `ret.dispose` → `dispose`
  - `analyzerPlacementsStale` (mutated by `lifecycle`) — 1 site: `ret.dispose` → `dispose`
  - `analyzerPlacementsStale` (mutated by `props`) — 1 site: the host's `markPlacementsStale`
    arrow → `markPlacementsStale` — **MODULE→MODULE**
  - `analyzerResync` (mutated by `lifecycle`) — 1 site: `ret.dispose` → `dispose`
  - `analyzerResync` (mutated by `world`) — 2 sites: `resetWorld`, `ret.loadWorld` →
    `retireWorld`, `noteWorldLoaded`
  - `analyzerSeeds` (mutated by `world`) — 2 sites: `resetWorld`, `ret.loadWorld` →
    `retireWorld`, `noteWorldLoaded`
  - `analyzerStale` (mutated by `world`) — 1 site: `resetWorld` → `retireWorld`
  - `analyzerWholeWorld` (mutated by `props`) — 1 site: the same arrow →
    `markPlacementsStale` — **MODULE→MODULE**
  - `analyzerWholeWorld` (mutated by `world`) — 1 site: `ret.loadWorld` → `noteWorldLoaded`
  - `flagStore` (mutated by `world`) — 1 site: `resetWorld` → `retireWorld`. The target
    STAYED and the write moved out; §5.3's row says why that is legal

  **Fourteen edges, four verbs.** `retireWorld` alone carries six of them, because the six
  lines it replaced were one act — and a caller that performed five of them would leave the
  mirror describing a world that is gone.

**Why `analyzer`'s `Edges: 39` in §4 does NOT move**, though the `props` row above re-counts
itself `5 → 4`: the two counts answer different questions. The props row counts what
`field-props.ts`'s `deps` record carries — four, because the pump and the two flags all
arrive behind one `markPlacementsStale()`. This row counts what crosses a cluster line
inside the closure, and all three still do; they simply do it from a named arrow at the
`createProps` call site instead of from inside `rebuildProps`. **Nothing about the analyzer's
coupling improved** — the extraction gave that coupling a name, and a name is not a
reduction. The `voidcast` phantom (§2.1) was struck at both ends because it never existed;
these three are struck at neither, because they still do. **This paragraph survives its own
extraction unchanged, which is the point of it**: T3d Task 2 moved the flags into a module
and the three edges still stand — they now cross a module line instead of a cluster line,
and §5.7's arithmetic is the only thing that had to move.

**Public members (6):** `setAgentProfile`, `subscribeFlags`, `setFlagFilters`, `verifyFlag`,
`selectFlag`, `flagMarkerCount` — all six are one-line delegates onto the module since
2026-08-07, and **the `FieldHost` type is byte-identical across the move**. The seam that
backs them is 18 verbs: the 6 above plus `setSelectedFlag`, `markerMesh`, `selectionBatch`,
`pendingCount`, `noteDensityWritten`, `markPlacementsStale`, `retireWorld`,
`noteWorldLoaded`, `requestPass`, `rebuildMarkers`, `destroyMarkers` and `dispose`. §2.7's
fourth bullet says why that is bigger than the row and what it means for sizing the next one.


### Cluster: camera

**Owns (state) — 8:** `cam`@1680 · `orbitState`@2054 · `cameraAimed`@2062 · `cameraPoseChannel`@2008 · `keys`@2088 · `look`@2095 · `dollyPixels`@2099 · `unbindCamera`@1682

**Owns (functions) — 10 → 13:** `aimCamera`@2078 · `placeCamera`@2085 · `cameraEye`@2118 · `applyOrbit`@2131 · `orbitPivot`@3804 · `frameTargetBox`@3813 · `frameSelection`@3822 · `frameWorld`@3937 · `snapView`@3969 · `applyFlyMove`@4868 — plus the three look-drag verbs T3c carved out of the pointer handlers and re-homed HERE (`beginLook`@2158 · `lookDrag`@2167 · `endLook`@2185): the machine calls them as deps, and their arrival is what deleted the `look ← input` mutation pair (§5.2)

**Reads from other clusters** (5 edges):
  - `gesture` (owned by `gesture`) — 1 site: `orbitPivot`
  - `gizmo` (owned by `entities`) — 2 sites: `orbitPivot`
  - `selectedEntityId` (owned by `entities`) — 2 sites: `frameTargetBox`
  - `selection` (owned by `selection`) — 2 sites: `frameTargetBox`
  - `store` (owned by `world`) — 1 site: `frameWorld`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (10 edges):
  - `cam` (read in `lifecycle`) — 3 sites: `ret.init`, `tick`
  - `cam` (read in `targeting`) — 2 sites: `cursorRay` — **cross-MODULE since 2026-08-07**,
    as a `cam()` thunk dep. This is `cam`'s ONLY extracted reader, so it stays out of the
    substrate on T3a's bar — `field-props.ts`'s `kitMat` precedent
  - `dollyPixels` (read in `input`) — 1 site: `onWheel`
  - `look` (read in `input`) — 7 sites: `onPointerMove` — **gone since T3c**: the reads are
    inside `lookDrag`, which is this cluster's own; the machine asks liveness through the
    `looking` thunk (@4758) instead of reading the binding
  - ~~`orbitState` (read in `analyzer`) — 1 site: `selectFlagImpl`~~ — **STRUCK 2026-08-07,
    RE-HOMED into this cluster's own verbs** (the `look` precedent in §5.2, read on the
    other side of the ledger): the two lines were `aimCamera(frameBox(orbitState, …))` +
    `applyOrbit()`, so the composition stayed here behind one named dep (`frameCameraOn`)
    and `field-analyzer.ts` hands over a box. §2.7's third bullet states the rule
  - `orbitState` (read in `input`) — 3 sites: `onPointerMove`, `onWheel` — the
    `onPointerMove` sites went with the look drag; `onWheel`@5364 survives
  - `orbitState` (read in `world`) — 1 site: `ret.exportArtifact`
  - `unbindCamera` (read in `lifecycle`) — 1 site: `ret.dispose`

**MUTATED BY other clusters** (10 edges → **8**, §5.2):
  - `cam` (mutated by `lifecycle`) — 2 sites: `ret.dispose`@5821, `ret.init`@5680
  - `dollyPixels` (mutated by `input`) — 1 site: `onWheel`@5359
  - `keys` (mutated by `input`) — 3 sites: `onBlur`@5535, `onKeyDown`@5506, `onKeyUp`@5511
  - ~~`look` (mutated by `input`) — 2 sites: `onPointerDown`, `onPointerUp`~~ — **GONE as an
    edge 2026-08-07**: the writes are `beginLook`/`endLook` now, this cluster's own verbs
  - `unbindCamera` (mutated by `lifecycle`) — 2 sites: `ret.dispose`@5820, `ret.init`@5687

**Public members (4):** `frameChunks`, `cameraAimedByHand`, `subscribeCameraPose`, `isLooking`


### Cluster: render — **EXTRACTED 2026-08-08** (`field-render.ts`, foundations T3d Task 3)

Lives in `packages/editor/src/field-host/field-render.ts` — the whole frame. ALL five
bindings and ALL five functions travelled; **nothing stayed**, which puts it with
`field-stats.ts` and against the seven extractions that left a container behind.

**ONE VERB OUT OF FIVE FUNCTIONS AND A 29-MEMBER DEPS RECORD.** `sceneLights`, `ghostState`,
`renderGhostLines` and `renderCursorAffordance` are called by `renderScene` and by nothing
else in the host, and `renderScene` is called once, by `tick` — so the seam is
`render.scene(c, view)` and the cost is entirely in what the frame is handed. §2.6 recorded
`picking` at 4 functions and ONE verb; this is the same shape at four times the width, and
§2.8 draws the pair together.

**The 30 read edges are what the deps record measures, and it is the row's honest size.**
Four arrive through the substrate (`chunkMeshes`, `propMeshes`, `ghostMeshes`,
`voidCastMeshes` — this cluster is why three of them stayed in the closure when their own
clusters left, and it is now the extracted module that reads them). The other 26 became
narrow named thunks and plain refs. **ELEVEN of those name state Tasks 4–6 will give owners**
(`digRadius`, `isKitFillTool`, `cameraEye`, `selectionCells`, `selectionBatch`, `anchorBatch`,
`boxPreviewBatch`, `boxAnchor`, `entitySelectionBatch`, `gizmoBatch`, `gizmoVisible`) — each
costs those tasks ONE line at the assembly and nothing inside the module, which is the point
of naming what you read rather than who you read it from.

**Zero mutations in either direction (§5.6), and that is what makes the width safe** rather
than alarming. It is also what made the extraction cheap and the verification worthless: see
§2.8's coverage measurement, where a frame that draws NOTHING is fully green.

**Owns (state) — 5 → 0:** `gridSegments` · `gridMinor` · `gridMajor` · `ghostPos` ·
`ghostScale` — all `field-render.ts`'s private state now *(the `@line` anchors were the
pre-extraction record and are deleted rather than re-pointed)*

**Owns (functions) — 5 → 0:** `sceneLights` · `ghostState` · `renderGhostLines` ·
`renderCursorAffordance` — all four PRIVATE in the module; `renderScene` → the seam's one
verb, `scene`

**Reads from other clusters** (30 edges — **every one is now a module read**; the bullets naming machine-owned state
(`gesture`, `pendingStamp`, `stamp`, `placementGhost`) are `machine.*()` accessor CALLS
since T3c, and `ghostMeshes` joined `voidCastMeshes` on the substrate's value side — the
per-site counts below are the birth epoch, per §2.5's read-side caveat):
  - `anchorBatch` (owned by `selection`) — 3 sites: `renderScene`
  - `boxAnchor` (owned by `selection`) — 1 site: `renderCursorAffordance`
  - `boxPreviewBatch` (owned by `selection`) — 3 sites: `renderScene`
  - `chunkMeshes` (owned by `world`) — 1 site: `renderScene`
  - `digRadius` (owned by `tool`) — 3 sites: `ghostState`, `renderCursorAffordance`, `renderGhostLines`
  - `entitySelectionBatch` (owned by `entities`) — 3 sites: `renderScene`
  - `flagMarkers` (owned by `analyzer`) — 2 sites: `renderScene` — **cross-MODULE since
    2026-08-07**, through `advisor.markerMesh()` bound to a local
  - `flagSelectionBatch` (owned by `analyzer`) — 3 sites: `renderScene` — **cross-MODULE
    since 2026-08-07**, through `advisor.selectionBatch()`, same shape
  - `gesture` (owned by `gesture`) — 2 sites: `renderCursorAffordance`, `renderScene`
  - `ghostCube` (owned by `materials`) — 4 sites: `renderScene` — **MODULE→MODULE since
    2026-08-08** (`materials.ghostCube`), both ends extracted on the same day; the four
    sites are one local, asked immediately before its guard
  - `ghostMeshes` (owned by `stamp`) — 1 site: `renderScene`
  - `gizmoBatch` (owned by `entities`) — 3 sites: `renderScene`
  - `lastPointer` (**since 2026-08-07 owned by `field-targeting.ts`; a `targeting.pointer()`
    CALL, not a binding read**) — 6 sites: `ghostState`, `renderCursorAffordance`. Both
    functions now bind `const last = targeting.pointer()` once at the top, for the narrowing
    reason — six sites, two calls
  - `layers` (**since 2026-08-06 owned by `field-view.ts`; a CALL, not a binding read**) — 14
    sites: `renderScene`. The densest read site in the closure, and the reason `view`'s
    extraction is a threading pass rather than a relocation: all fourteen became
    `viewState.layers().x`, expression-for-expression, with no hoisted snapshot at the top of
    the frame (see §6's `view` row, and `field-view.ts`'s header for why the hoist was
    declined). Fourteen SITES, but **12 + 2 × chunkCount** crossings per frame — the `field`
    and `kit` reads sit inside `for (const cm of chunkMeshes.values())`, exactly as they did
    before the move, so the per-chunk term is the price of the call and not of the extraction.
  - `pendingStamp` (owned by `gesture`) — 2 sites: `renderCursorAffordance`
  - `placementGhost` (owned by `stamp`) — 3 sites: `renderScene`
  - `propMeshes` (owned by `props`) — 1 site: `renderScene`
  - `segmentAnchorBatch` (owned by `segment`) — 3 sites: `renderScene`
  - `segmentAnchor` (owned by `segment`) — 1 site: `renderCursorAffordance`
  - `segmentPreviewBatch` (owned by `segment`) — 3 sites: `renderScene`
  - `selectionBatch` (owned by `selection`) — 3 sites: `renderScene`
  - `selectionCells` (owned by `selection`) — 2 sites: `renderScene`
  - `shading` (owned by `materials`) — 2 sites: `renderScene`, `sceneLights` —
    **MODULE→MODULE since 2026-08-08** (`materials.shading`), same day
  - `stamp` (owned by `stamp`) — 1 site: `renderScene`
  - `voidCastMeshes` (**since 2026-08-06 owned by the SUBSTRATE, not by `voidcast`**) — 1
    site: `renderScene`. The extraction left the Map in the closure precisely because this
    edge exists: it is a `HostSubstrate` value member that `field-voidcast.ts` fills and
    `renderScene` drains, one identity rather than two copies. The edge did not go away — it
    stopped crossing a cluster line and started crossing a MODULE one, which is what
    extracting against a substrate is supposed to do to a read edge.

**MUTATES other clusters** (0 edges):
  - none — and this is the row's load-bearing zero (§5.6)

**Read by other clusters** (0 edges):
  - none. Nothing reads `render`, which is why nothing is pinned BELOW its assembly and why
    it could be placed directly above `tick`

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (0):** none — internal only. The seam is one verb the host calls, not a
facade member; `FieldHost` is 65 members before and after


### Cluster: picking — **EXTRACTED 2026-08-07** (`field-picking.ts`)

Lives in `packages/editor/src/field-host/field-picking.ts` — the HOST half of the pick,
whose pure half is `field-pick.ts` next door. The two names are deliberately a pair and the
line between them is the one `field-pick.ts`'s own header already drew: *"the host builds
the candidates (it owns the op log, the catalog and the flag store) and raycasts the field
for the occluder; this module does the geometry and decides the winner."* That sentence
described a boundary the closure could not enforce while the host half sat 170 lines deep
in a 6,000-line file.

**THE SEAM IS ONE VERB, and that is this row's finding.** Four functions are counted here;
each of the first three has exactly one caller — the next one down — so the cluster is a
pipeline the closure had no way to say was a pipeline (four sibling `const`s any of the
host's other 120 functions could have called). Only `press` leaves. A row's function count
sizes the CLUSTER; it does not predict the seam, and this is the sharpest instance yet: 4
functions, 1 member, and the deletion pass paid for the extraction on its own.

**It owns zero state, which is what let it leave without touching the substrate.** Four
substrate members are read and none is new; the one host `let` it needs
(`selectedEntityId`) rides as a single-consumer function dep, refused entry to the record
by T3a's two-reader bar.

**Owns (state) — 0:** none (behaviour only)

**Owns (functions) — 4:** `pickCandidates`@3369 · `pointerPick`@3424 · `applyPointerPick`@3465 · `pointerPress`@3509 — **all four moved; ONE is on the seam**

**Reads from other clusters** (8 edges → **7**; one is struck below):
  - `archetypeById` (owned by `catalogs`) — 1 site: `pickCandidates` — SUBSTRATE thunk
  - ~~`canvasEl` (owned by `input`) — 1 site: `pointerPress`~~ — **STRUCK 2026-08-07, and
    it went at T3c rather than here.** The DOM pointer capture became the host's
    `capturePointer` thunk in that tranche, so `pointerPress` reaches the canvas through a
    CALL and names the binding nowhere. Not a §2.1 phantom — the edge was real when
    measured; it is the class §2.4 warned about when it said per-site counts were not
    re-derived. Verified at head by grepping the function. `capturePointer` rides as a dep
    instead, and is a call, so it is counted nowhere
  - `flagStore` (owned by `analyzer`) — 1 site: `pickCandidates` — SUBSTRATE, value side
  - `layers` (owned by `view`) — 2 sites: `pickCandidates` — `field-view.ts`'s, as a PLAIN
    ref: this module is assembled BELOW `createView`, which is half of why it is assembled
    where it is
  - `log` (owned by `world`) — 1 site: `pickCandidates` — SUBSTRATE, value side
  - `selectedEntityId` (owned by `entities`) — 3 sites: `pointerPress` — a host `let` with
    one extracted reader, so a single-consumer function dep. TWO of the three sites collapse
    to one local (the guard and the argument, for the narrowing reason `cursorRay`'s `sliceY`
    states); the THIRD is deliberately re-read, because `pointerPick` runs between them and
    the substrate's rule is that a `let` is read where it is used
  - `store` (owned by `world`) — 2 sites: `pickCandidates`, `pointerPick` — SUBSTRATE

Four more inbound dependencies are CALLS and so appear in none of the counts above
(§2.1's second correction): `cursorRay` (`field-targeting.ts`, extracted in the same task),
`entityFootprints`, `gizmoAxisAt`, and the two selection setters. Sized off this row the
cluster reads as seven reads; its deps record is eleven members plus the substrate.

**MUTATES other clusters** (1 edge — **stands, MODULE→MODULE since 2026-08-07**):
  - `pendingMove` (owned by `move` at birth; the machine's own since T3c) — 1 site:
    `pointerPress`, now `field-picking.ts`@342, through `machine.setPendingMove`. It was the
    register's only edge where the CLOSURE wrote INTO a module (§5.5); extracting the writer
    retired that distinction. `pointerPress` is dispatched FROM the machine's pointerdown
    chain and did not go with it at T3c because all three of its TESTS are the closure's —
    the chain follows the state it ARBITRATES on, this verb follows the state it
    INTERROGATES. The two directions meet as an arrow pair in this module's deps, pointing
    down into a machine assembled below it.

**Read by other clusters** (0 edges):
  - none

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (0):** none — internal only


### Cluster: input — **PARTIALLY HOLLOWED 2026-08-07** (T3c: the four pointer handlers' BODIES → `field-machine.ts`)

The four `onPointer*` functions are still declared here and still what `attachListeners`
attaches — but since T3c they are one-line delegates onto `machine.pointerDown/Move/Up/Cancel`
(two lines for the first two, which still record the pointer position on the way past —
`targeting.notePointer` since T3d, when the slot they were writing left with the cursor
chain it is the cached argument of). The ARBITRATION they used to hold — pointerdown's seven-way chain, pointermove's six-way, the
pair that end a gesture — is in `field-machine.ts`, because most of what those branches test
is that module's state. The three tests that are NOT its (`camera.look`, `selection.boxAnchor`,
`segment.segmentAnchor`) travel back the other way as liveness thunks on the machine's deps
record, and the verbs the chain dispatches to (`eyedropper`, `applyTool`, `selectionClick`,
`pointerPress`, the segment brush's three) all stayed in their own clusters — two of which
have since left the file themselves, so `pointerPress` is `picking.press` and
`selectionClick` reaches `field-targeting.ts` for its two seed voxels.

Two more of this row's functions were re-homed WITHOUT leaving the file: the look drag's
three verbs (`beginLook`, `lookDrag`, `endLook`) were carved out of `onPointerDown`/`Move`/`Up`
and belong to `camera`, and `capturePointer`/`releasePointer` were carved out of the same
three and belong here (they are the only two places `canvasEl`'s DOM capture is spelled).

**HOW STALE THE EDGE LISTS BELOW ARE, honestly.** Every edge whose only sites were the four
pointer handlers moved, and they went to two different places, which is the distinction to
carry into the lists:

- **Left the file** (now inside `field-machine.ts`, either as its own state or through a
  dep): `moveDrag`, `pendingMove`, `pendingStamp`, `digging`, `lastStroke`, `boxAnchor`,
  `segmentAnchor`, and `gesture`'s two pointer sites — reads; `pendingMove`, `digging`,
  `lastStroke` and `maskDropReported` — mutates. Six of those nine bindings are the machine's
  OWN now (`moveDrag`, `pendingMove`, `pendingStamp`, `gesture`, `digging`, `lastStroke`), so
  those edges are gone rather than moved. The other three are still owned elsewhere and are
  now touched across a module boundary: `boxAnchor` and `maskDropReported` here,
  `segmentAnchor` in `field-segment.ts`.
- **Re-homed inside the file**, out of `input` and into `camera`: every `look` read and
  mutate, and `orbitState`'s pointermove reads. They are now `beginLook`/`lookDrag`/`endLook`,
  which is `camera` touching its own state — so `input` loses the edge and no one gains one.
- **Survives in `input`**: the keyboard (`momentaryShift`, `momentaryCtrl`, `keys`,
  `digRadius`), the wheel (`digRadius`, `dollyPixels`, `orbitState`, `gesture`), every
  `syncCursor` read, and `targeting.lastPointer`, which the two surviving delegates still
  write on the way past.

The header sums and the MUTATES table below ARE re-derived now (§2.5's sweep, which is the
"full attribution sweep" §1's rule demanded); the per-binding read bullets keep their birth
site counts, with the disposition each carries from the block above.

**Owns (state) — 2:** `canvasEl`@1681 · `lastCursor`@5240 — **both stayed**

**Owns (functions) — 12 → 14** (was 13; `escapeLadder` was deleted 2026-08-05, §2.2)**:** `syncCursor`@5241 · `onPointerDown`@5312 · `onPointerMove`@5317 · `onPointerUp`@5326 · `onPointerCancel`@5330 · `onWheel`@5353 · `onContextMenu`@5373 · `onKeyDown`@5377 · `onKeyUp`@5509 · `onBlur`@5533 · `attachListeners`@5543 · `detachListeners`@5559 — **all twelve still declared here; four are now delegates (see above) — plus the capture pair T3c carved out of them, `capturePointer`@2197 · `releasePointer`@2200** (the only two places `canvasEl`'s DOM capture is spelled; the machine and `pointerPress` call them)

**Reads from other clusters** (37 edges → **10 stand**: `digRadius` 2 + `dollyPixels` 1 +
`orbitState` 1 + `momentaryShift` 3 + `momentaryCtrl` 3 — everything else below is gone as
a DATA edge, per its own annotation; what replaced part of it is 8 `machine.*()` accessor
read SITES — `syncCursor` 4, `onKeyDown` 3, `onWheel` 1 — which are calls and counted
nowhere, per the map's rule):
  - `boxAnchor` (owned by `selection`) — 2 sites: `escapeLadder`†, `onPointerMove`
  - `digRadius` (owned by `tool`) — 2 sites: `onKeyDown`, `onWheel`
  - `digging` (owned by `tool`) — 1 site: `onPointerMove`
  - `dollyPixels` (owned by `camera`) — 1 site: `onWheel`
  - `gesture` (owned by `gesture`) — 8 sites: `onPointerDown`, `onPointerMove`, `onWheel`, `syncCursor`
  - `lastStroke` (owned by `tool`) — 1 site: `onPointerMove`
  - `look` (owned by `camera`) — 7 sites: `onPointerMove`
  - `momentaryCtrl` (owned by `tool`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `momentaryShift` (owned by `tool`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `moveDrag` (owned by `move`) — 7 sites: `escapeLadder`†, `onPointerDown`, `onPointerMove`, `onPointerUp`, `syncCursor`
  - `orbitState` (owned by `camera`) — 3 sites: `onPointerMove`, `onWheel`
  - `pendingMove` (owned by `move`) — 2 sites: `onPointerMove`
  - `pendingStamp` (owned by `gesture`) — 5 sites: `escapeLadder`†, `onPointerDown`, `onPointerMove`, `syncCursor`
  - `segmentAnchor` (owned by `segment`) — 2 sites: `escapeLadder`†, `onPointerMove`
  - `selectedEntityId` (owned by `entities`) — 1 site: `escapeLadder`†
  - `selection` (owned by `selection`) — 1 site: `escapeLadder`†
  - `stamp` (owned by `stamp`) — 5 sites: `escapeLadder`†, `onKeyDown`, `syncCursor`

**MUTATES other clusters** (20 edges → **12 stand, all in this file** — this is the list
T3c changed most; §5.2 carries the same ten rows with head lines, re-audited 2026-08-07):
  - `digging` (owned by `tool`) — 2 sites: `onPointerDown`, `onPointerUp` — **GONE:** binding
    and writer both left, together
  - `dollyPixels` (owned by `camera`) — 1 site: `onWheel`@5359 — stands
  - `keys` (owned by `camera`) — 3 sites: `onBlur`@5535, `onKeyDown`@5506, `onKeyUp`@5511 — stand
  - `lastPointer` (**since 2026-08-07 owned by `field-targeting.ts`**) — 2 sites:
    `onPointerDown`@5037, `onPointerMove`@5042 — **stand, cross-MODULE**. They still write it
    before handing over, now as `targeting.notePointer(e.clientX, e.clientY)`. The reasoning
    that kept the write here at T3c is unchanged and was never about where the SLOT lives:
    the chain never reads it, so handing the machine a write-thunk for it would have grown
    `MachineDeps` for someone else's benefit. T3d moved the slot to the five functions it is
    the cached argument of; the handlers did not move a line
  - `lastStroke` (owned by `tool`) — 1 site: `onPointerMove` — **GONE**, with `digging`
  - `look` (owned by `camera`) — 2 sites: `onPointerDown`, `onPointerUp` — **re-homed inside
    this file:** the writes are `beginLook`@2159/`endLook`@2186 now, which are `camera`'s, so
    the edge is `camera` writing its own state and `input` no longer has it
  - `maskDropReported` (owned by `tool`) — 1 site: `onPointerDown` — **left the file:** now
    `field-machine.ts`'s `pointerDown` (its line 1806) through the `armMaskDropReport`
    thunk@1764 — the edge stands, cross-MODULE, and is counted on `tool`'s side
  - `momentaryCtrl` (owned by `tool`) — 3 sites: `onBlur`@5538, `onKeyDown`@5503, `onKeyUp`@5517 — stand
  - `momentaryShift` (owned by `tool`) — 3 sites: `onBlur`@5537, `onKeyDown`@5499, `onKeyUp`@5513 — stand
  - `pendingMove` (owned by `move`) — 2 sites: `onPointerMove`, `onPointerUp` — **GONE:**
    both the binding (2026-08-07, with `move`) and both writers (T3c's chain move) are in
    `field-machine.ts`

**Read by other clusters** (2 edges → **1**):
  - `canvasEl` (read in `picking`) — 1 site: `pointerPress` — through `capturePointer`
    since T3c, not the raw element: a call now, so no longer a data edge. **This row was
    current and `picking`'s own was not** — the edge stood there until T3d struck it at both
    ends, which is what a per-row strike costs when only one end is swept
  - `canvasEl` (read in `targeting`) — 2 sites: `toNdc` — **stands, cross-MODULE since
    2026-08-07**, through `substrate.canvasEl()`
  - (`field-machine.ts` reads it too, at three capture sites and one release — through the
    same two thunks, and never as the element. Not counted: the machine is a module, not a
    cluster in this map.)

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (1):** `escape`


### Cluster: stats — **EXTRACTED 2026-08-06**

Lives in `packages/editor/src/field-host/field-stats.ts`. The row below is the measurement
it was sized against, annotated with what the move actually cost. **This is the row §2.1's
fourth correction was found on** — read that bullet before trusting any small row in this
document.

**Owns (state) — 6:** `statsChannel`@2026 · `cachedLogStats`@2003 · `statsOpsLen`@2004 · `statsUndoLen`@2005 · `statsRedoLen`@2006 · `lastReconfigureMs`@1992

All six left, and **nothing stayed** — the first extraction of which that is true. The three
before it each left a container behind as a `HostSubstrate` value member because `renderScene`
draws from it; this cluster renders nothing, and no other cluster read its state except
through `tick`, which now calls instead.

**Owns (functions) — 1:** `currentLogStats`@5949

It moved verbatim and kept its name inside the module. **But one function is not what this
cluster was**: the payload assembly and the `size() > 0` publish guard — twenty lines at
`tick`@5921–5941 — are the cluster's actual job and were attributed to `lifecycle`, which owns
`tick`. So this is the first cluster that could not travel as a record of functions. It was
given a verb the closure never had, `publishIfWatched()`, and `tick` trades its twenty lines
for one call. The closure now holds one `const stats = createStatsMeter({…})`, at the line
`currentLogStats` used to start on.

**Reads from other clusters** (2 edges → **7** in the module's `deps`):
  - `log` (owned by `world`) — 8 sites: `cachedLogStats`, `currentLogStats`
  - **+ `store`** (owned by `world`) — the payload's `chunks`. Filed under `lifecycle`'s read
    list, site `tick`.
  - **+ `lastRemeshMs`, `remeshVersion`** (owned by `world`) — two payload fields. Both filed
    under `lifecycle`, site `tick`.
  - **+ `voidCastJobGen`** (owned by `voidcast`) — the payload's `voidCastPending`, a boolean
    derived `!== null`. Filed under `lifecycle`, site `tick`; since 2026-08-06 it is
    `field-voidcast.ts`'s `jobGen`, which makes this the first dep in the tranche naming
    another extracted MODULE rather than a host binding.
  - **+ `analyzerPendingCount()`** (owned by `analyzer`) — the payload's `analyzerPending`. A
    CALL, so counted nowhere at all (§2.1's second correction). Since 2026-08-07 it is
    `field-analyzer.ts`'s `pendingCount`, so this dep names a second extracted MODULE and
    `createStatsMeter` may no longer be assembled above `createAnalyzer`.

`store` and `log` are `HostSubstrate` value members and needed no addition to the record.
`lastRemeshMs` and `remeshVersion` are host `let`s with exactly one extracted reader each, so
they ride as single-consumer thunks on the module's own record; `analyzerPendingCount` and
`voidCastJobGen` are members of `const` module records and pass by reference.

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (2 edges → **0**):
  - ~~`lastReconfigureMs` (read in `lifecycle`) — 1 site: `tick`~~ — the binding moved INTO the
    module; `tick` no longer names it.
  - ~~`statsChannel` (read in `lifecycle`) — 1 site: `tick`~~ — likewise. `tick` calls
    `stats.publishIfWatched()`, and `FieldHost.subscribeStats` delegates to
    `stats.subscribe(cb)` with its signature and behaviour unchanged.

**MUTATED BY other clusters** (1 edge → **1 named call**):
  - `lastReconfigureMs` (mutated by `stamp`) — 1 site: `applyReconfigureSession`. Now
    `stats.noteReconfigureMs(performance.now() - reconfigureStart)`, on `field-segment.ts`'s
    `armMaskDropReport` precedent. Same one site, same one condition (a reconfigure core
    REJECTED still does not update it — the assignment sat, and the call sits, below the
    `catch`'s early return).

**Public members (1):** `subscribeStats` — a plain delegate before the move and after it.

**One behaviour changed, deliberately.** `currentLogStats()` now runs INSIDE the publish
guard; `tick` ran it one line above, unconditionally, and used the result only in the payload.
The guard's own comment already described the stricter shape, so the code now does what the
comment says. `field.logStats` is a pure query and the cache's trackers advance only inside
its recompute branch, so a skipped call cannot make a later one wrong. What changes: an
unwatched host no longer runs an O(ops) log scan per rAF — every headless test driving the
loop *without subscribing* is such a host, though four editor suites do subscribe — and the
cache's one documented signature-aliasing window widens. **Widens in likelihood, not in
duration**: because nothing re-signs on a MATCH, an alias persists until a length genuinely
differs under either shape; what moved is that the netting sequence now has the unwatched span
to land in rather than one frame. Only `liveGenerators` and `compactableOps` can be wrong when
it does — the other three `LogStats` fields ARE the signature.
`packages/editor/tests/field-host/field-stats.test.ts` pins both halves of the guard.

---

## 7. Forward-looking: what this evidence suggests

**This section is a recommendation, not a description of the current system.**

### 7.1 Cleanly separable today

Ranked by external edge count with zero or one mutation crossing the boundary:

| Cluster | External edges | Boundary mutations | Partners |
|---|---|---|---|
| `stats` | 5 → **8** (7 in-reads + 1 in-mutation; the 2 read-by edges went to 0) **+1 uncounted call** | 1 in (`lastReconfigureMs` ← `stamp`) → **1 named call** | 3 → 5 — **EXTRACTED 2026-08-06** |
| `history` | 7 — the feed took **1** | 1 out (`drift.drift`) — stayed, it is `stepHistory`'s | 4 — **FEED EXTRACTED 2026-08-06**; the other 6 edges belong to `stepHistory`, which stayed (§6) |
| `segment` | 8 | 1 out (`tool.maskDropReported`) | 3 |
| `voidcast` | ~~**9**~~ **8** | **0** | ~~4~~ 3 — **EXTRACTED 2026-08-06** |
| `props` | 8 → **7** | 2 out (analyzer staleness flags) → **1 call** | 6 — **EXTRACTED 2026-08-06** |
| `view` | 8 → **7** as data, **+8** uncounted calls | 1 out (`world.dirty`) **+2 uncounted calls out** (`voidcast`) | **5** on data edges · **7** if calls count — **EXTRACTED 2026-08-06** |

All six read the same small substrate — `world.store`, `world.log`, `lifecycle.ctx`,
`lifecycle.disposed`, `catalogs.table` — and nothing else of consequence. (`view` is the
narrowest instance and the one that shows the column's limit: it reads `world.store` and
`world.dirty` and nothing else at all, and it was still the tranche's most invasive move —
its cost was never in this column but in the 25 sites that read IT.)

**The ranking's own top row was the wrong number**, which is worth stating because the column
it ranks on is what this section recommends acting on. `stats` sat at the head as the cheapest
separation at 5 edges; doing it found 8. Its 2 listed reads were really 7 — four of the five
missing ones had been filed under `lifecycle` all along and the fifth was a call nothing
counted (§2.1's fourth and second corrections) — while its 2 read-by edges went to zero,
because both were `tick` naming state that left with the module. It is still a clean
separation: every one of those reads is a thunk or a value member and the single mutation is
one named call. But it was never the cheapest, and a row can only ever understate. Treat every
figure in this column as a floor.

**The column ranked six clusters and foundations T3d extracted three it never ranked at
all** — `targeting` (14 edges), `picking` (9) and `drift` (5). Two of the three would have
sat inside this table's range on their edge counts and neither was listed, because the
ranking's entry condition was "zero or one mutation crossing the boundary" measured over
DATA: `targeting` has zero mutations and nine reads and was excluded by edge count alone;
`drift` has three inbound mutations and looked like the opposite of separable. What actually
decided both was the shape the column cannot see — `targeting` is a chain with one argument,
`drift` is a slot whose two readers agree on a home. **A separability ranking over edge
counts is a floor on cost and says nothing about whether a boundary EXISTS**; §6's three
rows carry what did decide them.

**Three of those five may not be held by value**, which the original phrasing here did not
say. `ctx`, `disposed` and `table` are `let`s the host REPLACES (`init`/`dispose`,
`setMaterialTable`), so an extracted module that copies them reads a photograph: a stale
material table meshes and bakes against a project the user has already changed, and a
snapshotted `disposed` answers `false` for the life of the process. Only `store` and `log`
are `const` handles a module may keep. The settled split is a type now —
`HostSubstrate` in `packages/editor/src/field-host/substrate.ts` — and §7.3 states it.

### 7.2 What entangles the rest

- **`stamp` ↔ `move` share one slot.** Not a coupling to be tidied: the move session *is*
  a stamp session with `moving: true` (5289). Any boundary drawn between them cuts a state
  machine in half.
- **`input` is a driver, not an owner.** 20 of its edges were writes into `tool`, `camera`,
  `targeting` and `move` (12 at head, into three — the `move` writes and the stroke pair
  left with the pointer chain and the look pair re-homed into `camera`; §5.2). It has no
  state worth extracting; it is the adapter that turns DOM events into calls — T3c made
  that literal, with four of its handlers now one-line delegates onto the machine.
- **`lifecycle.ret.dispose` owns 24 mutations across six clusters.** Any per-cluster
  extraction has to hand teardown back to its cluster, or dispose keeps reaching in.
- **`analyzer` is 14 mutations downstream of everyone who dirties the world.** Its
  staleness flags are set by `world`, `props` and `lifecycle` — it is a subscriber wearing
  the shape of a peer. **EXTRACTED 2026-08-07 and this paragraph is what it cost**: all 14
  survived the move as calls onto four named verbs, so the module's seam is 18 members
  against a 14-function row. "A subscriber wearing the shape of a peer" turned out to be
  exactly the right prediction and exactly no obstacle — being written-to is expensive to
  SAY and cheap to move, because every writer wanted a verb it could name.
- **`render` reads 30 edges across 13 clusters and mutates nothing**, almost all of it in
  `renderScene`. Pure fan-in: it is the one function that has to see everything.

### 7.3 Recommended shape

The `let`-vs-`const` split (58 vs 12) is what decides the mechanism, because a `const`
handle passed by value cannot fork but a reassigned `let` silently can.

1. **An explicit context record for the substrate. LANDED at T3a (2026-08-05) as
   `HostSubstrate`** — `packages/editor/src/field-host/substrate.ts`, a package-internal
   record type plus an identity factory, whose own TSDoc is the authority on the split.
   **CONSTRUCTED at T3b1 (2026-08-06)**, once the `voidcast` extraction had something to
   hand it — `createFieldHost` assembles one at the top of the closure, and its first
   consumer covered five of the sixteen members. Assembling it there rather than beside a
   consumer is what fixes where a substrate member must be DECLARED by: the value side is
   read eagerly, which is why `flagStore` moved up out of the advisor block — and, at T3d
   Task 2, why it is the one binding of that whole cluster that could not follow the rest of
   it into `field-analyzer.ts` (§2.7). The substrate
   accounts for the large majority of the
   244 read edges (`world.store` alone is read at 42 sites across 14 clusters, `world.log` at
   37 sites across 8, `catalogs.table` at 14 sites across 6).

   **The split this section originally proposed was wrong on two members, and the record
   corrects it.** `table` and `archetypeById` are NOT `const`: `setMaterialTable` assigns a
   whole new `table` and `setEntityCatalog` rebuilds `archetypeById` rather than editing it,
   so a module holding either by value goes on working against a project the user has
   changed — well-formed data, wrong buckets, no error anywhere. The record therefore has
   **two sides, sixteen members**:

   - **Eleven held BY VALUE** — `const` in the host, so the binding never moves and every
     write lands through the identity already handed out (`chunkMeshes.set`,
     `propMeshes.length = 0`, `flagStore.applyFlags`): `store`, `log`, `dirty`, `worker`,
     `chunkMeshes`, `flagStore`, `requestContext`, `litByClass`, `propMeshes`, `ghostMeshes`,
     `voidCastMeshes`. Note `litByClass` is on this side even though it is DERIVED from
     `table` — a table swap clears and refills the map rather than replacing it, which is
     exactly what makes it safe to pass while its source is not.
   - **Five as THUNKS** — `let` in the host, where a snapshot is a permanent fork:
     `table()`, `archetypeById()`, `ctx()`, `disposed()`, `canvasEl()`. `ctx` and `canvasEl`
     fail at both ends (copied before `init` they are `null` forever; copied before `dispose`
     they outlive the device), and `disposed` is the loudest: snapshot it and every
     `if (disposed) return` guard in an extracted module waves the teardown through.

   Nothing is frozen or copied by the factory, and that is deliberate rather than an
   omission — the shared identity IS the contract on the value side, so defending it from
   mutation would break the thing it exists for. When a member moves between `const` and
   `let` in the host it moves sides in the type, and the compiler makes every consumer say
   so.
2. **Sub-modules for the six clean clusters in §7.1**, each taking that record plus a
   narrow callback for the one boundary mutation it performs.
3. **A small internal store for the interactive middle** — `stamp`+`move`+`gesture`,
   `tool`, `camera`, `selection`. These are `let` scalars reassigned across cluster lines
   (`stamp`, `moveDrag`, `pendingMove`, `tool`, `look`, `selection`, `momentaryShift`…).
   Passing them by value forks; passing them as sub-hosts means every sub-host needs a
   reference to every other. A single subscribable store with named slots is the shape that
   matches how the code already behaves, since `notifyStamp` / `notifySelection` /
   `notifyTool` / `notifyEntities` / `notifyHistory` (now `historyFeed.notify`) /
   `notifyDrift` are already exactly
   that pattern hand-rolled six times. **Half of that is now shared rather than hand-rolled:**
   T3a's `ViewChannel` (§2.2) owns the subscribe/publish/deliver half for all thirteen seams,
   so what a store would still add is the SLOTS and their change detection, not the
   notification machinery.
4. **Leave `lifecycle` and `render` last.** They are the two functions that legitimately see
   everything; they get simpler only after the clusters beneath them do.

   **HALF WRONG, and the half is worth keeping.** `render` went at T3d Task 3, with `tool`,
   `camera`, `selection` and `entities` all still in the closure — eleven of its
   twenty-nine deps name state those tasks will move. The recommendation assumed the deps
   record would have to be REWRITTEN when they do. It does not: each of the eleven is a
   NARROW named thunk, so the later tasks change one line at the ASSEMBLY and nothing inside
   `field-render.ts` changes SHAPE — no signature, no body, no type. **Six comment sites in
   that module do change wording, and they carry `MIGRATION (until T3d Task 4/5)` markers so
   the boundary grep finds them** (§2.8). "Nothing changes" would overstate it; "nothing
   structural changes" is the claim, and it is the one that matters for whether waiting would
   have helped. "It gets simpler if you wait" was true of the module's
   ASSEMBLY-SITE spelling and false of the module. `lifecycle` is a different case and this
   correction does not reach it — it is last for `world`'s reason (§2.7's cycle note), not
   for fan-in.

### 7.4 Which cluster to extract first

**DONE — extracted 2026-08-06** to `packages/editor/src/field-host/field-voidcast.ts`,
and it was the `HostSubstrate`'s first consumer, which is what this recommendation was for.
The prediction below held: no `FieldHost` member changed, every pin ran unmodified, and the
whole of the cluster's inbound DATA was already substrate. The one thing the recommendation
got wrong was `tool.tool` — a phantom (§2.1). See §6's `voidcast` row for the as-built.

**`voidcast`** (the X-ray layer): 3 state bindings, 5 functions, 9 external edges, **zero
mutation edges in either direction**, 4 partners, and no public API surface at all — so no
`FieldHost` member changes and no test can observe the move except through behaviour that
is already covered. Its entire inbound dependency is `lifecycle.ctx`, `lifecycle.disposed`,
`tool.tool`, `world.store` and `world.worker` (plus calls to `world`'s `chunkOrigin`,
`chunkCopy` and `snapshotAllChunks`); its entire outbound surface is `voidCastJobGen` read
by `lifecycle.tick` and `voidCastMeshes` read by `render.renderScene`. It is the smallest
change that proves out the context-record mechanism in §7.3 before anything load-bearing
depends on it.

`segment` and `history` are close seconds (one boundary mutation each). **`history` went
fifth, and split** — the ranking treats a cluster as one movable thing, and this one was two:
a feed with a single dependency and a lifecycle verb with six. The boundary mutation the row
scores it on belongs entirely to the half that stayed, which is the ranking's blind spot
worth naming: a row that mixes a trivially separable seam with an inseparable verb averages
them into a number that describes neither.

**And `props` went second the same day**, ahead of both — not because this section ranked it
there (it did not; two boundary mutations put it below them here) but because T3b1 ordered
its tasks by MEASURED extraction cost against the as-built, and the two staleness flags turn
out to be one named write-thunk rather than two problems. What the ranking above could not
see is the thing that made `props` interesting: nine inbound CALLS, which no column here
counts (§2.1's second correction). See §6's `props` row.

**And `view` went LAST, deliberately, against a ranking that puts it joint-cheapest.** On
this section's own column it ties `props` at 8 external edges with one boundary mutation, so
nothing here argues for deferring it. Two facts the column cannot hold did. First, its cost
is not inbound: 25 sites in six other clusters read its two `let`s (or the helper over one of
them), and every one had to
become a call — a diff no edge count on this page predicts, because the column measures what
a cluster READS and this cluster's expense is what reads IT. Second, it depends on `voidcast`
through two uncounted calls, so extracting it earlier would have discovered that ordering
constraint as a build error in the middle of the threading pass. **The generalisation for
whatever T3b2 orders next: rank by inbound reads when choosing what to extract, and by
outbound calls when choosing WHEN.** Neither number is in the table above.

### 7.5 Honest assessment: extracting the stamp session

**DONE — extracted 2026-08-07** to `packages/editor/src/field-host/field-machine.ts`,
together with `move` and `gesture`, and LAST of the tranche rather than first. This section
is why it went last, and it was right on every count: it went with `move` (it had to), the
14 `cancelStampSession` sites became `machine.cancelSession()`, and the merge table below
is exactly what the module's shape ended up being — `stamp`+`move`+`gesture` as ONE module,
because every boundary drawn between the three cuts a state machine in half. What changed
between this assessment and the move is the two preconditions it names in its last
paragraph: the substrate (§7.3 step 1) landed at T3a/T3b1, and the Esc ladder became a
capture stack, so the cluster could own its own cancellable state. The interactive-middle
STORE (§7.3 step 3) was never built and turned out not to be needed — the three clusters
that would have shared it went into one module instead. See §6's `stamp` row for the
as-built. The assessment below stands as the measurement.

**The stamp-session cluster is the worst available first extraction, not the best.** The
evidence:

- **13 partner clusters** — second only to `world`, which is the shared substrate rather
  than a peer. `stamp` touches `catalogs`, `drift`, `entities`, `gesture`, `history`,
  `input`, `lifecycle`, `materials`, `move`, `render`, `selection`, `stats`, `world`.
- **45 cross-cluster edges** (22 out, 23 in), of which 6 are mutations in both directions.
- **`stamp.stamp` alone is read at 21 sites across 7 other clusters** and is reassigned
  from an eighth (`move.dropMove`). It is the most cross-read `let` in the closure — the
  bindings above it (`store`, `log`) are `const` handles, not reassignable state.
- **12 public members** — the largest public surface of any cluster. Every one of them is
  an entry point into the same slot.
- **The slot is shared three ways.** `startStamp` opens a *place* session, `openEntity`
  opens a *reconfigure* session, and `beginMove` opens a reconfigure session flagged
  `moving: true`. "Stamp session" is not a subset of the state; it is one of three modes
  over one variable.

Crucially, **no nearby merge rescues it**. Absorbing its neighbours makes the boundary
*worse*, not better:

| Unit | Edges internalised | External edges remaining | Partners |
|---|---|---|---|
| `stamp` alone | 0 | 45 (6 mut) | 13 |
| `stamp`+`move` | 8 | **49** (7 mut) | **14** |
| `stamp`+`move`+`drift` | 9 | 52 (8 mut) | 13 |
| `stamp`+`move`+`drift`+`gesture` | 13 | 61 (6 mut) | 13 |
| + `history` | 16 | 62 (5 mut) | 12 |

Every merge internalises fewer edges than it inherits. The session machinery is the hub of
the interactive layer; it cannot be lifted out cleanly until the substrate (§7.3 step 1) and
the interactive-middle store (step 3) exist to lift it *onto*.

If the stamp session must move first anyway, the two facts that will bite are: (a) it cannot
go without `move`, because `dropMove` reassigns `stamp` and `sendPreviewJob` reassigns
`moveCommitPending`; and (b) `lifecycle.ret.dispose`, `input.onKeyDown` and
`world.resetWorld` all call `cancelStampSession`, which is invoked from 14 regions across
7 clusters — the teardown edge has to be inverted into a callback before the module can own
its own lifetime. (T3a replaced one of those named callers with an indirect one rather than
removing it: `input.escapeLadder` is gone, and the session's Esc capture holds
`cancelStampSession` as its cancel closure, so `input.onKeyDown` reaches it through
`router.escape()` now. The teardown edge stands; only its spelling changed.)
