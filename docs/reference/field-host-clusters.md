# The `createFieldHost` closure, mapped

A factual map of the state held inside `createFieldHost` in
`packages/editor/src/field-host/field-host.ts`, as of 2026-08-03. Every binding in the
closure is assigned to exactly one owning cluster, and every read and write that crosses a
cluster line is listed.

This is a **description, not a proposal**. §7 is the one forward-looking section and is
marked as such.

**Eight clusters have since left, and a ninth left in half.** `segment` was extracted to
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
says what it cost this map, and `tool` and `input` are the two rows.

Every count below still includes all nine. They are left as measured because they are what
the remaining 14 clusters were sized against; subtract those rows from §4 when reading them
as current — the rows themselves are now marked, so the subtraction is a matter of skipping
the ones whose heading says EXTRACTED rather than of remembering a list. **The two rows
marked PARTIALLY HOLLOWED are the exception to that instruction and must not be skipped:**
they are live clusters whose edge lists are part stale, and each stale line is annotated
where it stands rather than removed.

**And foundations T3a, T3b1 and T3c each changed things the map names.** §2.2, §2.3 and
§2.4 record exactly what, and which numbers below are consequently stale. Read them before
trusting a site list.

## 1. The shape of the file

Re-measured 2026-08-05 where the row says so. The rows marked *(2026-08-03)* are the
original pass and have **not** been re-derived — re-deriving them is a full attribution
sweep, not a `wc -l`, and a number that looks fresh but isn't is worse than one that admits
its date.

| Fact | Value |
|---|---|
| File total | **7,188 lines** (re-measured 2026-08-06 at the close of T3b1, after the docs pass corrected the `FieldHost` seam preamble: **+13, every one a COMMENT line**, so the code column below is untouched). Was 7,175 after the layering move, 7,181 after `view` left, 7,165 after the `history` feed, 7,216 after `stats`, 7,228 after `props`, 7,276 after `voidcast`, 7,347 at T3a, 7,410 at the original pass. The layering move's own net was **−6** and pure import geometry: no cluster left, no statement changed — seven of this file's imports were re-pointed from `../frontend/lib/…` to `./…` or `../shared/…`, and four became short enough for the formatter to collapse a multi-line specifier list onto one line. |
| Code / comment / blank | **3,394 / 3,558 / 236** (re-measured 2026-08-06 at the close of T3b1; the docs pass moved the COMMENT column by +13 and nothing else). Was 3,394 / 3,545 / 236 after the layering move, 3,400 / 3,545 / 236 after `view`, 3,400 / 3,529 / 236 after the `history` feed, 3,429 / 3,550 / 237 after `stats`, 3,454 / 3,537 / 237 after `props`, 3,496 / 3,541 / 239 after `voidcast`, 3,554 / 3,554 / 239 at T3a, 3,620 / 3,551 / 239 originally. The layering move itself was **−6** code, zero comment, zero blank — the whole delta being the collapsed import lines. |
| `export function createFieldHost` | **line 1660** → end of file (**5,529 lines**) *(re-measured 2026-08-06 at the close of T3b1; the SPAN has not moved all slice — only the start line, down 13 by the docs pass's comment block and up 6 before that by the collapsed imports)* |
| `return { … }` object literal | **line 6454** *(re-measured 2026-08-06 at the close of T3b1)* |
| Closure-level bindings | **270** (re-measured 2026-08-06 after `view` by §2's rule; was 272 after the `history` feed, 275 after `stats`, 281 after `props`, 284 after `voidcast`, 289 at T3a, 293 originally. `view` took two `let`s and one function out and put `viewState` back: −2. The arrow-function/data split — 161/132 as originally measured — has still **not** been re-derived, and §6's per-cluster counts must not be summed to stand in for it: those rows are mixed-epoch, so the two figures are only comparable at the epoch each was taken. §6's `history` row works the example) |
| `FieldHost` public members | **66** (re-verified 2026-08-05: 63 defined in the return literal, 3 shorthand re-exports of closure functions: `frameSelection`, `frameWorld`, `snapView`) |
| Clusters below | 23 *(2026-08-03)* |
| Cross-cluster **read** edges | 244 *(2026-08-03 — stale, see §2.2)* |
| Cross-cluster **mutation** edges | **70** *(2026-08-03)* |

The line-count method behind the second row: strip blank lines, count a line as a comment if
its first non-space characters are `//` or if it lies inside a `/* … */` block, and count
everything else as code. The blank count reproduces the original pass exactly, which is the
evidence that the two methods agree.

Comment lines still OUTNUMBER code lines — 3,558 to 3,394, i.e. **51.2%** of every non-blank
line in the file is prose (they were exactly level at T3a, and code led at the original
pass). That density is why the file reads as documented rather than merely large — but the
code alone is 3,394 lines, still ~8.5× the ~400-line file guideline in
`.claude/rules/clean-code.md`, and `createFieldHost` alone is ~110× the ~50-line function
guideline.

**Six clusters out and those ratios have not visibly moved**, which is the honest scale of
the problem. Two different reductions, worth keeping apart because they answer different
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
`field-props`, `field-stats`, `field-history-feed` and `field-view` — the last six lifted out
STATEFUL rather than discovered to be pure. `field-history-feed` is the sharpest illustration
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

## 3. Where the public-surface hypothesis was wrong

The clusters were first hypothesised from the `FieldHost` type. Following the code changed
four things:

1. **The surface is 66 members, not 56.** The hypothesis omitted two whole families: the
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

| Cluster | State | Fns | Public | Partners | Edges | of which mutations |
|---|---|---|---|---|---|---|
| `world` | 8 | 14 | 5 | 18 | 94 | 17 |
| `stamp` | 7 → **1** (`ghostMeshes` stayed — substrate) | 19 → **0** | 11 (12 until `commitSession` died) | **13** | 45 | 6 — **EXTRACTED 2026-08-07** (`field-machine.ts`, with `move` + `gesture`) |
| `render` | 5 | 5 | 0 | 13 | 30 | 0 |
| `lifecycle` | 5 | 1 | 2 | 11 | 76 | 24 |
| `input` | 2 | 13 → **12** (+2 new: the capture pair) | 1 | 10 | 59 (high — §2.2) | 20 — **PARTIALLY HOLLOWED 2026-08-07**: the four pointer handlers' BODIES went to `field-machine.ts` and took most of both edge counts with them; the row is live, the numbers are pre-T3c (§6) |
| `catalogs` | 3 | 0 | 3 | 10 | 26 | 2 |
| `entities` | 8 | 9 | 8 | 9 | 28 | 0 |
| `selection` | 9 | 17 | 4 | 9 | 21 | 2 |
| `materials` | 17 | 7 | 1 | 8 | 40 | 15 |
| `analyzer` | 19 | 14 | 6 | 8 | 39 | 14 |
| `tool` | 10 → **8** | 12 | 4 | 8 → **7** | 35 → **34** → **29** | 11 → **8** — **PARTIALLY HOLLOWED 2026-08-07**: `digging` + `lastStroke` left with the pointer chain (§6) |
| `camera` | 8 | 10 | 4 | 8 | 25 | 10 |
| `targeting` | 1 | 6 | 0 | 7 | 14 | 2 |
| `picking` | 0 | 4 | 0 | 7 | 9 | 1 |
| `props` | 2 | 3 | 1 | 6 | 8 → **7** as `deps` (+**9** uncounted calls — §6) | 2 |
| `view` | 2 | 1 | 2 | **5** on data edges (6 − the `selection` phantom) · **7** if calls count (+`voidcast` out, +`tool` in — §6) | 8 → **7** as data (+**6** uncounted `sliceOpts()` calls in and **2** into `voidcast` out — §6) | 1 |
| `move` | 3 → **0** | 7 → **0** | 1 | 5 | 20 | 5 — **EXTRACTED 2026-08-07**, inseparably from `stamp` (§7.2) |
| `gesture` | 4 → **0** | 2 → **0** | 2 | 5 | 17 | 2 — **EXTRACTED 2026-08-07**, inside the session machine |
| `voidcast` | 3 | 5 | 0 | 4 → **3** | 9 → **8** | **0** |
| `history` | 2 | 2 → **3** (§6) | 3 | 4 | 7 — the module takes **1** (`log`); `stepHistory` stays and keeps the other 6 | 1 |
| `segment` | 6 | 6 | 1 | 3 | 8 | 1 |
| `drift` | 2 | 3 | 2 | 3 | 5 | 3 |
| `stats` | 6 | 1 | 1 | 3 → **5** | 5, of which 2 are inbound reads — the module needs **7** (§2.1's fourth correction) | 1 |

## 5. The cross-cluster mutation register

70 edges. This is the set that resists extraction: **58 target a `let`** — a reassignment,
which forks silently if the binding is passed by value — and **12 target a `const`
container** (`store`-adjacent sets and maps), which are safe to pass by value because the
binding never moves and the mutation goes through the object.

### 5.1 Teardown fan-out — `lifecycle.ret.dispose` (24 edges)

`ret.dispose` nulls all 15 `materials` bindings, both `camera` handles (`cam`,
`unbindCamera`), clears `world.chunkMeshes`, and resets three `analyzer` flags
(`analyzerResync`, `analyzerPlacementsStale`, `analyzerIdle`). `ret.init` writes `cam`,
`unbindCamera` and `world.dirty`. One function owns the whole lifetime of state that six
clusters read.

| Target | Written by | Line |
|---|---|---|
| `materials.normalsMat` … `materials.selectionCellBind` (15 bindings) | `ret.dispose` | 6697–6711 |
| `camera.cam` | `ret.init` / `ret.dispose` | 6596 / 6735 |
| `camera.unbindCamera` | `ret.init` / `ret.dispose` | 6603 / 6734 |
| `world.chunkMeshes` | `ret.dispose` | 6672 |
| `world.dirty` | `ret.init` | 6622 |
| `analyzer.analyzerResync` | `ret.dispose` | 6652 |
| `analyzer.analyzerPlacementsStale` | `ret.dispose` | 6664 |
| `analyzer.analyzerIdle` | `ret.dispose` | 6667 |

### 5.2 DOM handlers driving other clusters — `input` (20 edges)

The `input` cluster owns almost no state of its own (`canvasEl`, `lastCursor`). It is a
driver: it reassigns state in five other clusters — **three of them since 2026-08-07**
(`tool`, `camera`, `targeting`; the `move` rows and three of the five `tool` rows left the
file with the pointer chain).

**Five of these ten rows changed on that date (T3c), and the `Status` column says how.** The
line numbers are all pre-T3c and are NOT re-derived — grep by name (§2.4). The pattern is
worth reading whole, because it is what "the machine arbitrates, the tools act" cost this
table: every row a POINTER handler drove either left the file with the state it drove, or
stayed and became a call.

| Target | Written by | Line | Status (2026-08-07) |
|---|---|---|---|
| `tool.momentaryShift` | `onKeyDown` / `onKeyUp` / `onBlur` | 6421 / 6435 / 6459 | unchanged — keyboard |
| `tool.momentaryCtrl` | `onKeyDown` / `onKeyUp` / `onBlur` | 6425 / 6439 / 6460 | unchanged — keyboard |
| `tool.digging` | `onPointerDown` / `onPointerUp` | 6106 / 6196 | **not an edge** — state and writers both in `field-machine.ts` |
| `tool.lastStroke` | `onPointerMove` | 6172 | **not an edge** — same |
| `tool.maskDropReported` | `onPointerDown` | 6107 | **still an edge, now cross-MODULE** — `field-machine.ts`'s `pointerDown`, via `armMaskDropReport` |
| `targeting.lastPointer` | `onPointerDown` / `onPointerMove` | 6057 / 6117 | unchanged — the delegates still write it |
| `camera.look` | `onPointerDown` / `onPointerUp` | 6111 / 6197 | **re-homed in-file** — `beginLook` / `endLook`, which are `camera`'s |
| `camera.dollyPixels` | `onWheel` | 6235 | unchanged — wheel |
| `camera.keys` (`const` Set) | `onKeyDown` / `onKeyUp` / `onBlur` | 6428 / 6433 / 6457 | unchanged — keyboard |
| `move.pendingMove` | `onPointerMove` / `onPointerUp` | 6148 / 6194 | **not an edge** — state and writers both in `field-machine.ts` |

### 5.3 World reset / load fan-out — `world` (12 edges)

| Target | Written by | Line |
|---|---|---|
| `analyzer.analyzerStale` (`const` Set) | `resetWorld` | 6509 |
| `analyzer.analyzerDirty` (`const` Set) | `resetWorld`, `markDirtyWithNeighbors` | 6510, 2311 |
| `analyzer.analyzerResync` | `resetWorld` / `ret.loadWorld` | 6511 / 6776 |
| `analyzer.analyzerSeeds` | `resetWorld` / `ret.loadWorld` | 6512 / 6772 |
| `analyzer.analyzerWholeWorld` | `ret.loadWorld` | 6777 |
| `analyzer.flagStore` (`const`, `.clear()`) | `resetWorld` | 6514 |
| `selection.selection` | `resetWorld` | 6539 |
| `selection.lastSelection` | `resetWorld` | 6540 |
| `drift.drift` | `resetWorld` | 6557 |

### 5.4 The session cycle — `stamp` ↔ `move` (bidirectional, 3 edges)

**This is the only bidirectional mutation pair in the closure**, and it is the single most
important entry in this register.

| Target | Written by | Line |
|---|---|---|
| `stamp.stamp` | `move.dropMove` | 5426 |
| `move.moveCommitPending` | `stamp.sendPreviewJob` | 4892, 4916 |

The mutation edges understate it. The two clusters are one state machine:

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

### 5.5 The remainder (12 edges)

| Target | Written by | Line |
|---|---|---|
| `analyzer.analyzerPlacementsStale` | `props.rebuildProps` | 2405 |
| `analyzer.analyzerWholeWorld` | `props.rebuildProps` | 2406 |
| `gesture.suspendReported` | `stamp.openStampSession` / `stamp.openEntitySession` | 5112 / 5274 |
| `drift.drift` | `stamp.applyReconfigureSession` | 5483 |
| `drift.drift` | `history.stepHistory` | 5577 |
| `stats.lastReconfigureMs` | `stamp.applyReconfigureSession` | 5476 |
| `move.pendingMove` | `picking.pointerPress` | 3561 |
| `tool.maskDropReported` | `segment.segmentClick` | 3334 |
| `world.chunkMeshes` | `catalogs.ret.setMaterialTable` | 6931 |
| `world.dirty` | `catalogs.ret.setMaterialTable` | 6935 |
| `world.dirty` | `view.ret.setSlice` | 6904 |

### 5.6 Clusters with zero mutation edges in either direction

`voidcast`, `entities`, `render`, `picking` (as a target). `voidcast` and `entities` neither
mutate another cluster's state nor have theirs mutated; `render` and `picking` are pure
readers that own no reassignable state crossing a line.

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

**Owns (state) — 5:** `requestContext`@1664 · `ctx`@1665 · `disposed`@2009 · `raf`@2007 · `lastFrameT`@2008

**Owns (functions) — 1:** `tick`@5995

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

  - `analyzerIdle` (owned by `analyzer`) — 2 sites: `ret.dispose`
  - `analyzer` (owned by `analyzer`) — 1 site: `ret.dispose`
  - `cam` (owned by `camera`) — 3 sites: `ret.init`, `tick`
  - `chunkMeshes` (owned by `world`) — 1 site: `ret.dispose`
  - `flagMarkerBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `flagMarkerMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `flagStore` (owned by `analyzer`) — 1 site: `ret.init`
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
  - `analyzerIdle` (owned by `analyzer`) — 1 site: `ret.dispose`
  - `analyzerPlacementsStale` (owned by `analyzer`) — 1 site: `ret.dispose`
  - `analyzerResync` (owned by `analyzer`) — 1 site: `ret.dispose`
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
  - `ctx` (read in `analyzer`) — 1 site: `rebuildFlagMarkers`
  - `ctx` (read in `catalogs`) — 1 site: `ret.setMaterialTable`
  - `ctx` (read in `materials`) — 1 site: `ret.setShading`
  - `ctx` (read in `props`) — 1 site: `rebuildProps`
  - `ctx` (read in `selection`) — 1 site: `rebuildSelectionCells`
  - `ctx` (read in `stamp`) — 2 sites: `applyStampGhost`, `destroyStampGhosts`
  - `ctx` (read in `voidcast`) — 3 sites: `applyVoidCast`, `destroyVoidCast`, `requestVoidCast`
  - `ctx` (read in `world`) — 2 sites: `remeshOne`, `resetWorld`
  - `disposed` (read in `analyzer`) — 4 sites: `analyzePump`, `analyzerFire`, `reportAnalyzerFailure`, `verifyFlagImpl`
  - `disposed` (read in `catalogs`) — 2 sites: `ret.setMaterialTable`
  - `disposed` (read in `stamp`) — 3 sites: `previewCoalescer`, `sendPreviewJob`
  - `disposed` (read in `voidcast`) — 2 sites: `requestVoidCast`
  - `disposed` (read in `world`) — 2 sites: `remeshOne`

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (2):** `init`, `dispose`


### Cluster: materials

**Owns (state) — 17:** `normalsMat`@1679 · `litByClass`@1682 · `kitMat`@1688 · `kitBind`@1689 · `ghostMat`@1694 · `ghostBind`@1695 · `ghostCube`@1696 · `ghostCubeGeo`@1697 · `stampGhostMat`@1881 · `stampGhostBind`@1882 · `voidCastMat`@1943 · `voidCastBind`@1944 · `flagMarkerMat`@1813 · `flagMarkerBind`@1814 · `selectionCellMat`@1825 · `selectionCellBind`@1826 · `shading`@1701

**Owns (functions) — 7:** `buildLitMaterials`@2105 · `destroyLitMaterials`@2130 · `initMaterials`@2138 · `stampGhostMaterial`@2250 · `voidCastMaterial`@2256 · `bucketMaterial`@2265 · `kitInstancedMat`@2279

**Reads from other clusters** (4 edges):
  - `chunkMeshes` (owned by `world`) — 1 site: `ret.setShading`
  - `ctx` (owned by `lifecycle`) — 1 site: `ret.setShading`
  - `stamp` (owned by `stamp`) — 1 site: `stampGhostMaterial`
  - `table` (owned by `catalogs`) — 1 site: `buildLitMaterials`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (21 edges):
  - `flagMarkerBind` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `flagMarkerMat` (read in `analyzer`) — 2 sites: `rebuildFlagMarkers`
  - `flagMarkerMat` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `ghostBind` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `ghostCubeGeo` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `ghostCube` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `ghostCube` (read in `render`) — 4 sites: `renderScene`
  - `ghostMat` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `kitBind` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `kitMat` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `kitMat` (read in `props`) — 1 site: `rebuildProps`
  - `normalsMat` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `selectionCellBind` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `selectionCellMat` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `selectionCellMat` (read in `selection`) — 2 sites: `rebuildSelectionCells`
  - `shading` (read in `render`) — 2 sites: `renderScene`, `sceneLights`
  - `stampGhostBind` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `stampGhostMat` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `voidCastBind` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `voidCastMat` (read in `lifecycle`) — 2 sites: `ret.dispose`

**MUTATED BY other clusters** (15 edges):
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

**Owns (state) — 8:** `store`@1670 · `log`@1671 · `dirty`@1672 · `worker`@1673 · `chunkMeshes`@1674 · `lastRemeshMs`@1968 · `remeshVersion`@1972 · `worldEpoch`@4644

**Owns (functions) — 14:** `markDirtyWithNeighbors`@2289 · `chunkOrigin`@2327 · `buildKit`@2340 · `destroyChunkRender`@2439 · `applyMesh`@2452 · `remeshOne`@2494 · `drainDirty`@2518 · `chunkCopy`@4227 · `snapshotChunks`@4110 · `snapshotAllChunks`@4234 · `chunkSetBox`@3913 · `occupiedTopYOf`@3942 · `compactLoadedLog`@6577 · `resetWorld`@6504

**Reads from other clusters** (12 edges):
  - `analyzePump` (owned by `analyzer`) — 3 sites: `markDirtyWithNeighbors`, `ret.loadWorld`, `ret.newWorld`
  - `ctx` (owned by `lifecycle`) — 2 sites: `remeshOne`, `resetWorld`
  - `disposed` (owned by `lifecycle`) — 2 sites: `remeshOne`
  - `orbitState` (owned by `camera`) — 1 site: `ret.exportArtifact`
  - `sliceY` (owned by `view`) — 1 site: `remeshOne`
  - `table` (owned by `catalogs`) — 4 sites: `buildKit`, `compactLoadedLog`, `remeshOne`, `ret.exportArtifact`

**MUTATES other clusters** (12 edges):
  - `analyzerDirty` (owned by `analyzer`) — 2 sites: `markDirtyWithNeighbors`, `resetWorld`
  - `analyzerResync` (owned by `analyzer`) — 2 sites: `resetWorld`, `ret.loadWorld`
  - `analyzerSeeds` (owned by `analyzer`) — 2 sites: `resetWorld`, `ret.loadWorld`
  - `analyzerStale` (owned by `analyzer`) — 1 site: `resetWorld`
  - `analyzerWholeWorld` (owned by `analyzer`) — 1 site: `ret.loadWorld`
  - `drift` (owned by `drift`) — 1 site: `resetWorld`
  - `flagStore` (owned by `analyzer`) — 1 site: `resetWorld`
  - `lastSelection` (owned by `selection`) — 1 site: `resetWorld`
  - `selection` (owned by `selection`) — 1 site: `resetWorld`

**Read by other clusters** (65 edges):
  - `chunkMeshes` (read in `catalogs`) — 1 site: `ret.setMaterialTable`
  - `chunkMeshes` (read in `lifecycle`) — 1 site: `ret.dispose`
  - `chunkMeshes` (read in `materials`) — 1 site: `ret.setShading`
  - `chunkMeshes` (read in `render`) — 1 site: `renderScene`
  - `dirty` (read in `entities`) — 2 sites: `ret.deleteEntity`, `ret.duplicateEntity`
  - `dirty` (read in `stamp`) — 1 site: `commitStampSession`
  - `lastRemeshMs` (read in `lifecycle`) — 1 site: `tick`
  - `log` (read in `analyzer`) — 1 site: `analyzerPlacementGroups`
  - `log` (read in `entities`) — 14 sites: `entityFootprints`, `entityRecord`, `ret.bakeEntity`, `ret.deleteEntity`, `ret.duplicateEntity`, `ret.listEntities`, `ret.setEntityFrozen`
  - `log` (read in `history`) — 8 sites: `notifyHistory`, `stepHistory`
  - `log` (read in `picking`) — 1 site: `pickCandidates`
  - `log` (read in `props`) — 1 site: `rebuildProps`
  - `log` (read in `stamp`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `openEntitySession`
  - `log` (read in `stats`) — 8 sites: `cachedLogStats`, `currentLogStats`
  - `log` (read in `tool`) — 1 site: `commitToolOp`
  - `remeshVersion` (read in `lifecycle`) — 1 site: `tick`
  - `store` (read in `analyzer`) — 7 sites: `analyzerHasWork`, `postMirrorSync`, `rebuildFlagMarkers`, `rebuildFlagSelection`, `selectFlagImpl`
  - `store` (read in `camera`) — 1 site: `frameWorld`
  - `store` (read in `catalogs`) — 1 site: `ret.setMaterialTable`
  - `store` (read in `drift`) — 1 site: `driftedEntities`
  - `store` (read in `entities`) — 3 sites: `entityFootprints`, `ret.deleteEntity`, `ret.duplicateEntity`
  - `store` (read in `history`) — 2 sites: `stepHistory`
  - `store` (read in `lifecycle`) — 2 sites: `ret.init`, `tick`
  - `store` (read in `picking`) — 2 sites: `pickCandidates`, `pointerPick`
  - `store` (read in `selection`) — 5 sites: `commitSelectionSpec`, `rebuildSelectionCells`, `selectionAabb`, `selectionClick`, `selectionInfo`
  - `store` (read in `stamp`) — 3 sites: `applyReconfigureSession`, `commitStampSession`, `sendPreviewJob`
  - `store` (read in `targeting`) — 8 sites: `computeTarget`, `cursorRay`, `materialSeedVoxel`, `selectionPoint`, `voidSeedVoxel`
  - `store` (read in `tool`) — 4 sites: `commitToolOp`, `eyedropper`
  - `store` (read in `view`) — 1 site: `ret.setSlice`
  - `store` (read in `voidcast`) — 2 sites: `requestVoidCast`
  - `worker` (read in `lifecycle`) — 1 site: `ret.dispose`
  - `worker` (read in `stamp`) — 1 site: `sendPreviewJob`
  - `worker` (read in `voidcast`) — 1 site: `requestVoidCast`
  - `worldEpoch` (read in `analyzer`) — 2 sites: `verifyFlagImpl`
  - `worldEpoch` (read in `entities`) — 1 site: `entityFootprints`

**MUTATED BY other clusters** (5 edges):
  - `chunkMeshes` (mutated by `catalogs`) — 1 site: `ret.setMaterialTable`
  - `chunkMeshes` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `dirty` (mutated by `catalogs`) — 1 site: `ret.setMaterialTable`
  - `dirty` (mutated by `lifecycle`) — 1 site: `ret.init`
  - `dirty` (mutated by `view`) — 1 site: `ret.setSlice`

**Public members (5):** `newWorld`, `loadWorld`, `exportArtifact`, `occupiedTopY`, `getSmoothLimits`


### Cluster: catalogs

**Owns (state) — 3:** `table`@1705 · `archetypes`@1794 · `archetypeById`@1795

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
  - `archetypeById` (read in `analyzer`) — 1 site: `analyzerPlacementGroups`
  - `archetypeById` (read in `picking`) — 1 site: `pickCandidates`
  - `archetypeById` (read in `props`) — 1 site: `rebuildProps`
  - `archetypeById` (read in `stamp`) — 1 site: `sendPreviewJob`
  - `archetypes` (read in `stamp`) — 2 sites: `openStampSession`, `reseedForArchetype`
  - `table` (read in `entities`) — 2 sites: `ret.deleteEntity`, `ret.duplicateEntity`
  - `table` (read in `history`) — 1 site: `stepHistory`
  - `table` (read in `materials`) — 1 site: `buildLitMaterials`
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
  - `archetypeById` (owned by `catalogs`) — 1 site: `rebuildProps`
  - `ctx` (owned by `lifecycle`) — 1 site: `rebuildProps`
  - `kitMat` (owned by `materials`) — 1 site: `rebuildProps`
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
  - `propMeshes` (read in `render`) — 1 site: `renderScene` — unchanged; the array is shared
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

**Owns (state) — 10 → 8:** `tool`@1706 · `momentarySaved`@1712 · `momentaryShift`@1713 · `momentaryCtrl`@1714 · `toolChannel`@1717 · `toolErrorChannel`@1721 · `maskDropReported`@1726 · `digRadius`@1957 · ~~`digging`@1958~~ — **moved to `field-machine.ts` 2026-08-07** · ~~`lastStroke`@1959~~ — **moved 2026-08-07**

**Owns (functions) — 12:** `reportToolError`@2551 · `sphereShape`@2539 · `toolMask`@2569 · `toolOp`@2599 · `strokeShape`@2632 · `commitToolOp`@2656 · `isKitFillTool`@2674 · `eyedropper`@2764 · `applyTool`@2812 · `applyRadius`@3276 · `notifyTool`@5587 · `deriveMomentary`@5599

**Reads from other clusters** (7 edges):
  - `log` (owned by `world`) — 1 site: `commitToolOp`
  - `selection` (owned by `selection`) — 5 sites: `toolMask`
  - `store` (owned by `world`) — 4 sites: `commitToolOp`, `eyedropper`
  - `table` (owned by `catalogs`) — 3 sites: `commitToolOp`, `eyedropper`, `isKitFillTool`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (17 → **16** → **14** edges):
  - `digRadius` (read in `input`) — 2 sites: `onKeyDown`, `onWheel`
  - `digRadius` (read in `render`) — 3 sites: `ghostState`, `renderCursorAffordance`, `renderGhostLines`
  - `digRadius` (read in `segment`) — 2 sites: `rebuildSegmentPreview`, `segmentClick`
  - `digRadius` (read in `targeting`) — 1 site: `computeTarget`
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
  - `layers` (read in `picking`) — 2 sites: `pickCandidates`
  - `layers` (read in `render`) — 14 sites: `renderScene` (the count is right, and it is the
    single densest read site in the closure)
  - `sliceY` (read in `targeting`) — 2 sites: `cursorRay`. **The one place the compiler forced
    a local**: the two reads are a null check and a compare in one expression, and narrowing
    does not survive a call boundary, so that site binds `const sliceY = viewState.sliceY()`
    first and keeps the expression verbatim.
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


### Cluster: targeting

**Owns (state) — 1:** `lastPointer`@1967

**Owns (functions) — 6:** `toNdc`@2531 · `cursorRay`@2696 · `computeTarget`@2739 · `selectionPoint`@3028 · `materialSeedVoxel`@3080 · `voidSeedVoxel`@3116

**Reads from other clusters** (9 edges):
  - `cam` (owned by `camera`) — 2 sites: `cursorRay`
  - `canvasEl` (owned by `input`) — 2 sites: `toNdc`
  - `digRadius` (owned by `tool`) — 1 site: `computeTarget`
  - `sliceY` (owned by `view`) — 2 sites: `cursorRay`
  - `store` (owned by `world`) — 8 sites: `computeTarget`, `cursorRay`, `materialSeedVoxel`, `selectionPoint`, `voidSeedVoxel`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (3 edges):
  - `lastPointer` (read in `move`) — 3 sites: `ret.beginMove`
  - `lastPointer` (read in `render`) — 6 sites: `ghostState`, `renderCursorAffordance`

**MUTATED BY other clusters** (2 edges):
  - `lastPointer` (mutated by `input`) — 2 sites: `onPointerDown`, `onPointerMove`

**Public members (0):** none — internal only


### Cluster: selection

**Owns (state) — 9:** `selection`@1748 · `lastSelection`@1750 · `selectionChannel`@1790 · `selectionBatch`@1756 · `anchorBatch`@1757 · `boxPreviewBatch`@1761 · `boxAnchor`@1742 · `selectionCells`@1823 · `selectionCellsCount`@1827

**Owns (functions) — 17:** `currentSelectionSpec`@2563 · `selectionAabb`@2823 · `cloneSelectionSpec`@2839 · `selectionInfo`@2852 · `notifySelection`@2876 · `aabbEdgeBatch`@2882 · `rebuildSelectionBatch`@2895 · `destroySelectionCells`@2901 · `rebuildSelectionCells`@2917 · `setBoxAnchor`@2960 · `refreshSelectionDisplay`@3012 · `setSelection`@3017 · `boxRegionSpec`@3048 · `updateBoxPreview`@3061 · `commitSelectionSpec`@3151 · `boxCorner`@3352 · `selectionClick`@3367

**Reads from other clusters** (7 edges):
  - `ctx` (owned by `lifecycle`) — 1 site: `rebuildSelectionCells`
  - `selectionCellMat` (owned by `materials`) — 2 sites: `rebuildSelectionCells`
  - `store` (owned by `world`) — 5 sites: `commitSelectionSpec`, `rebuildSelectionCells`, `selectionAabb`, `selectionClick`, `selectionInfo`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (12 edges):
  - `anchorBatch` (read in `render`) — 3 sites: `renderScene`
  - `boxAnchor` (read in `input`) — 2 sites: `escapeLadder`†, `onPointerMove`
  - `boxAnchor` (read in `render`) — 1 site: `renderCursorAffordance`
  - `boxPreviewBatch` (read in `render`) — 3 sites: `renderScene`
  - `selectionBatch` (read in `render`) — 3 sites: `renderScene`
  - `selectionCells` (read in `render`) — 2 sites: `renderScene`
  - `selection` (read in `camera`) — 2 sites: `frameTargetBox`
  - `selection` (read in `input`) — 1 site: `escapeLadder`†
  - `selection` (read in `stamp`) — 1 site: `ret.startStamp`
  - `selection` (read in `tool`) — 5 sites: `toolMask`
  - ~~`selection` (read in `view`) — 1 site: `layers`~~ — **PHANTOM, deleted 2026-08-06**: the
    occurrence is the object KEY `selection: true` in the `layers` literal, not a read of this
    binding. See §6's `view` row for the class.

**MUTATED BY other clusters** (2 edges):
  - `lastSelection` (mutated by `world`) — 1 site: `resetWorld`
  - `selection` (mutated by `world`) — 1 site: `resetWorld`

**Public members (4):** `clearSelection`, `reselect`, `subscribeSelection`, `selectionCellCount`


### Cluster: segment

**Owns (state) — 6:** `segmentAnchor`@1747 · `segmentAnchorBatch`@1766 · `segmentPreviewBatch`@1767 · `segmentPreviewEnd`@1773 · `segmentHudChannel` (extracted: `field-segment.ts`@170) · `lastSegmentHud`@1990

**Owns (functions) — 6:** `publishSegmentHud`@3181 · `publishSegmentHudThrottled`@3203 · `setSegmentAnchor`@3219 · `rebuildSegmentPreview`@3255 · `updateSegmentPreview`@3263 · `segmentClick`@3309

**Reads from other clusters** (2 edges):
  - `digRadius` (owned by `tool`) — 2 sites: `rebuildSegmentPreview`, `segmentClick`

**MUTATES other clusters** (1 edge):
  - `maskDropReported` (owned by `tool`) — 1 site: `segmentClick`

**Read by other clusters** (5 edges):
  - `segmentAnchorBatch` (read in `render`) — 3 sites: `renderScene`
  - `segmentAnchor` (read in `input`) — 2 sites: `escapeLadder`†, `onPointerMove`
  - `segmentAnchor` (read in `render`) — 1 site: `renderCursorAffordance`
  - `segmentPreviewBatch` (read in `render`) — 3 sites: `renderScene`

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
  - `gesture` (read in `render`) — 2 sites: `renderCursorAffordance`, `renderScene`
  - `pendingStamp` (read in `input`) — 5 sites: `escapeLadder`†, `onPointerDown`, `onPointerMove`, `syncCursor`
  - `pendingStamp` (read in `render`) — 2 sites: `renderCursorAffordance`
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
  - `drift` (owned by `drift`) — 1 site: `applyReconfigureSession`
  - `lastReconfigureMs` (owned by `stats`) — 1 site: `applyReconfigureSession`. Still one
    site, now a named CALL: `stats.noteReconfigureMs(…)` (`field-stats.ts`, extracted
    2026-08-06).
  - `moveCommitPending` (owned by `move`) — 2 sites: `sendPreviewJob`
  - `suspendReported` (owned by `gesture`) — 2 sites: `openEntitySession`, `openStampSession`

**Read by other clusters** (17 edges):
  - `ghostMeshes` (read in `render`) — 1 site: `renderScene`
  - `placementGhost` (read in `render`) — 3 sites: `renderScene`
  - `stamp` (read in `entities`) — 4 sites: `gizmoVisible`, `ret.bakeEntity`, `ret.deleteEntity`, `ret.setEntityFrozen`
  - `stamp` (read in `gesture`) — 1 site: `suspendedByStamp`
  - `stamp` (read in `history`) — 1 site: `stepHistory`
  - `stamp` (read in `input`) — 5 sites: `escapeLadder`†, `onKeyDown`, `syncCursor`
  - `stamp` (read in `materials`) — 1 site: `stampGhostMaterial`
  - `stamp` (read in `move`) — 8 sites: `beginMoveSession`, `cancelMoveInFlight`, `dropMove`, `updateMove`
  - `stamp` (read in `render`) — 1 site: `renderScene`

**MUTATED BY other clusters** (1 edge):
  - `stamp` (mutated by `move`) — 1 site: `dropMove`

**Public members (11):** `startStamp`, `updateStamp`, `nudgeStamp`, `rotateStamp`, `rerollStamp`, `commitStamp`, `confirmSession`, `cancelStamp`, `subscribeStamp`, `openEntity`, `applyReconfigure` — `commitSession` was the 12th until foundations T3c deleted it (zero production callers)


### Cluster: drift

**Owns (state) — 2:** `drift`@1860 · `driftChannel`@1900

**Owns (functions) — 3:** `driftedEntities`@3667 · `driftPayload`@3698 · `notifyDrift`@3703

**Reads from other clusters** (1 edge):
  - `store` (owned by `world`) — 1 site: `driftedEntities`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (1 edge):
  - `drift` (read in `history`) — 1 site: `stepHistory`

**MUTATED BY other clusters** (3 edges):
  - `drift` (mutated by `history`) — 1 site: `stepHistory`
  - `drift` (mutated by `stamp`) — 1 site: `applyReconfigureSession`
  - `drift` (mutated by `world`) — 1 site: `resetWorld`

**Public members (2):** `subscribeDrift`, `dismissDrift`


### Cluster: entities

**Owns (state) — 8:** `selectedEntityId`@1896 · `entitySelectionBatch`@1897 · `entitySelectionChannel`@1946 · `gizmo`@1905 · `gizmoBatch`@1906 · `footprintCache`@3758 · `footprintSig`@3759 · `entitiesChannel`@1907

**Owns (functions) — 9:** `entityRecord`@3710 · `entityFootprints`@3760 · `rebuildEntitySelectionBatch`@3789 · `gizmoVisible`@3823 · `activeGizmoAxis`@3833 · `gizmoAxisAt`@3838 · `setSelectedEntity`@4064 · `revalidateEntitySelection`@4073 · `notifyEntities`@3649

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
  - `entitySelectionBatch` (read in `render`) — 3 sites: `renderScene`
  - `gizmoBatch` (read in `render`) — 3 sites: `renderScene`
  - `gizmo` (read in `camera`) — 2 sites: `orbitPivot`
  - `selectedEntityId` (read in `camera`) — 2 sites: `frameTargetBox`
  - `selectedEntityId` (read in `input`) — 1 site: `escapeLadder`†
  - `selectedEntityId` (read in `picking`) — 3 sites: `pointerPress`

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
  - `lastPointer` (owned by `targeting`) — 3 sites: `ret.beginMove`
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

**Owns (functions) — 2 at the original pass, 3 as built:** `historySignature`@3555 (a T3b1-BASE
line) · `notifyHistory`@3617 · `stepHistory`@5550 (both original-pass lines; at BASE they are
3562 and 5447). **The three line numbers are MIXED-EPOCH**, which is the shape of the
correction below rather than an untidiness in it.

`historySignature` is absent from the original list because **it did not exist at the original
pass.** At the map's production commit `b507d3f6`, `notifyHistory` built the signature INLINE
(`const sig = { undoLen: …, redoLen: …, undoTop: …, redoTop: … }`, `b507d3f6:field-host.ts`
:3617–3636) against a single-slot `historyCb`. The named `const historySignature` arrived later,
in `83097df2` ("the thirteen subscribe seams go multicast"), when the seam became a channel and
the facade needed to compute a signature of its own. Two callers from that day on —
`notifyHistory` and `subscribeHistory` — **which is exactly why that seam was not a delegate.**
The row is updated to the as-built count of 3.

**No inference about the map's completeness follows, and the arithmetic that looks like it does
is a trap.** §6's function counts sum to **160** today against §1's **161** arrow-valued
bindings, but that gap is not an omission: the `input` row was decremented **13 → 12** post-hoc
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
  - `drift` (owned by `drift`) — 1 site: `stepHistory` — **stays in the closure**
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

**MUTATES other clusters** (1 edge — **unchanged, and in the closure**):
  - `drift` (owned by `drift`) — 1 site: `stepHistory`

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
`snapshotAllChunks` arrives back as a dep.

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
  - `voidCastMeshes` (read in `render`) — 1 site: `renderScene` — unchanged; the map is
    shared substrate, not a returned value.

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (0):** none — internal only. Confirmed by the move: no `FieldHost`
signature changed, and every existing pin ran unmodified.


### Cluster: analyzer

**Owns (state) — 19:** `analyzer`@4370 · `flagStore` (moved 2026-08-06 to the closure's
state block, ahead of the substrate assembly it is a value member of) · `flagsChannel`@4363 · `agentProfile`@4376 · `agentProfileAnswered`@4387 · `profileMissingReported`@4392 · `analyzerDirty`@4398 · `analyzerStale`@4402 · `analyzerResync`@4405 · `analyzerPlacementsStale`@4408 · `analyzerWholeWorld`@4410 · `analyzerSeeds`@4416 · `analyzerBusy`@4419 · `analyzerIdle`@4420 · `verifyInFlight`@4637 · `flagMarkers`@1811 · `markerCount`@1815 · `flagSelectionBatch`@1933 · `analyzePump`@4605

**Owns (functions) — 14:** `reportAnalyzerFailure`@4424 · `analyzerPlacementGroups`@4434 · `analyzerHasWork`@4452 · `postMirrorSync`@4461 · `analyzerFire`@4496 · `publishFlags`@4565 · `setSelectedFlag`@4576 · `selectFlagImpl`@4584 · `scheduleWholeWorldPass`@4622 · `verifyFlagImpl`@4646 · `analyzerPendingCount`@4752 · `destroyFlagMarkers`@4758 · `rebuildFlagMarkers`@4776 · `rebuildFlagSelection`@4829

**Reads from other clusters** (15 edges):
  - `archetypeById` (owned by `catalogs`) — 1 site: `analyzerPlacementGroups`
  - `ctx` (owned by `lifecycle`) — 1 site: `rebuildFlagMarkers`
  - `disposed` (owned by `lifecycle`) — 4 sites: `analyzePump`, `analyzerFire`, `reportAnalyzerFailure`, `verifyFlagImpl`
  - `flagMarkerMat` (owned by `materials`) — 2 sites: `rebuildFlagMarkers`
  - `log` (owned by `world`) — 1 site: `analyzerPlacementGroups`
  - `orbitState` (owned by `camera`) — 1 site: `selectFlagImpl`
  - `store` (owned by `world`) — 7 sites: `analyzerHasWork`, `postMirrorSync`, `rebuildFlagMarkers`, `rebuildFlagSelection`, `selectFlagImpl`
  - `worldEpoch` (owned by `world`) — 2 sites: `verifyFlagImpl`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (10 edges — **total unchanged by the `props` extraction**):
  - `analyzePump` (read in `props`) — 1 site: ~~`rebuildProps`~~ → `field-host.ts`'s
    `markPlacementsStale` (**re-sited 2026-08-06**; `rebuildProps` left the closure for
    `field-props.ts`, which does NOT name the pump — the read moved into the host-side arrow
    that is this seam's write-thunk. Still one site, still `props`, still in the closure.)
  - `analyzePump` (read in `world`) — 3 sites: `markDirtyWithNeighbors`, `ret.loadWorld`, `ret.newWorld`
  - `analyzerIdle` (read in `lifecycle`) — 2 sites: `ret.dispose`
  - `analyzer` (read in `lifecycle`) — 1 site: `ret.dispose`
  - `flagMarkers` (read in `render`) — 2 sites: `renderScene`
  - `flagSelectionBatch` (read in `render`) — 3 sites: `renderScene`
  - `flagStore` (read in `lifecycle`) — 1 site: `ret.init`
  - `flagStore` (read in `picking`) — 1 site: `pickCandidates`

**MUTATED BY other clusters** (14 edges — **total unchanged by the `props` extraction**; two
sites are re-named below, both relocations rather than deletions):
  - `analyzerDirty` (mutated by `world`) — 2 sites: `markDirtyWithNeighbors`, `resetWorld`
  - `analyzerIdle` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `analyzerPlacementsStale` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `analyzerPlacementsStale` (mutated by `props`) — 1 site: ~~`rebuildProps`~~ →
    `field-host.ts`'s `markPlacementsStale` (**re-sited 2026-08-06**)
  - `analyzerResync` (mutated by `lifecycle`) — 1 site: `ret.dispose`
  - `analyzerResync` (mutated by `world`) — 2 sites: `resetWorld`, `ret.loadWorld`
  - `analyzerSeeds` (mutated by `world`) — 2 sites: `resetWorld`, `ret.loadWorld`
  - `analyzerStale` (mutated by `world`) — 1 site: `resetWorld`
  - `analyzerWholeWorld` (mutated by `props`) — 1 site: ~~`rebuildProps`~~ →
    `field-host.ts`'s `markPlacementsStale` (**re-sited 2026-08-06**)
  - `analyzerWholeWorld` (mutated by `world`) — 1 site: `ret.loadWorld`
  - `flagStore` (mutated by `world`) — 1 site: `resetWorld`

**Why `analyzer`'s `Edges: 39` in §4 does NOT move**, though the `props` row above re-counts
itself `5 → 4`: the two counts answer different questions. The props row counts what
`field-props.ts`'s `deps` record carries — four, because the pump and the two flags all
arrive behind one `markPlacementsStale()`. This row counts what crosses a cluster line
inside the closure, and all three still do; they simply do it from a named arrow at the
`createProps` call site instead of from inside `rebuildProps`. **Nothing about the analyzer's
coupling improved** — the extraction gave that coupling a name, and a name is not a
reduction. The `voidcast` phantom (§2.1) was struck at both ends because it never existed;
these three are struck at neither, because they still do.

**Public members (6):** `setAgentProfile`, `subscribeFlags`, `setFlagFilters`, `verifyFlag`, `selectFlag`, `flagMarkerCount`


### Cluster: camera

**Owns (state) — 8:** `cam`@1666 · `orbitState`@2016 · `cameraAimed`@2024 · `cameraPoseChannel`@2030 · `keys`@2050 · `look`@2057 · `dollyPixels`@2061 · `unbindCamera`@1668

**Owns (functions) — 10:** `aimCamera`@2040 · `placeCamera`@2047 · `cameraEye`@2080 · `applyOrbit`@2093 · `orbitPivot`@3875 · `frameTargetBox`@3884 · `frameSelection`@3893 · `frameWorld`@4008 · `snapView`@4040 · `applyFlyMove`@5630

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
  - `cam` (read in `targeting`) — 2 sites: `cursorRay`
  - `dollyPixels` (read in `input`) — 1 site: `onWheel`
  - `look` (read in `input`) — 7 sites: `onPointerMove`
  - `orbitState` (read in `analyzer`) — 1 site: `selectFlagImpl`
  - `orbitState` (read in `input`) — 3 sites: `onPointerMove`, `onWheel`
  - `orbitState` (read in `world`) — 1 site: `ret.exportArtifact`
  - `unbindCamera` (read in `lifecycle`) — 1 site: `ret.dispose`

**MUTATED BY other clusters** (10 edges):
  - `cam` (mutated by `lifecycle`) — 2 sites: `ret.dispose`, `ret.init`
  - `dollyPixels` (mutated by `input`) — 1 site: `onWheel`
  - `keys` (mutated by `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `look` (mutated by `input`) — 2 sites: `onPointerDown`, `onPointerUp`
  - `unbindCamera` (mutated by `lifecycle`) — 2 sites: `ret.dispose`, `ret.init`

**Public members (4):** `frameChunks`, `cameraAimedByHand`, `subscribeCameraPose`, `isLooking`


### Cluster: render

**Owns (state) — 5:** `gridSegments`@2064 · `gridMinor`@2065 · `gridMajor`@2071 · `ghostPos`@5658 · `ghostScale`@5659

**Owns (functions) — 5:** `sceneLights`@5641 · `ghostState`@5670 · `renderGhostLines`@5681 · `renderCursorAffordance`@5708 · `renderScene`@5732

**Reads from other clusters** (30 edges):
  - `anchorBatch` (owned by `selection`) — 3 sites: `renderScene`
  - `boxAnchor` (owned by `selection`) — 1 site: `renderCursorAffordance`
  - `boxPreviewBatch` (owned by `selection`) — 3 sites: `renderScene`
  - `chunkMeshes` (owned by `world`) — 1 site: `renderScene`
  - `digRadius` (owned by `tool`) — 3 sites: `ghostState`, `renderCursorAffordance`, `renderGhostLines`
  - `entitySelectionBatch` (owned by `entities`) — 3 sites: `renderScene`
  - `flagMarkers` (owned by `analyzer`) — 2 sites: `renderScene`
  - `flagSelectionBatch` (owned by `analyzer`) — 3 sites: `renderScene`
  - `gesture` (owned by `gesture`) — 2 sites: `renderCursorAffordance`, `renderScene`
  - `ghostCube` (owned by `materials`) — 4 sites: `renderScene`
  - `ghostMeshes` (owned by `stamp`) — 1 site: `renderScene`
  - `gizmoBatch` (owned by `entities`) — 3 sites: `renderScene`
  - `lastPointer` (owned by `targeting`) — 6 sites: `ghostState`, `renderCursorAffordance`
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
  - `shading` (owned by `materials`) — 2 sites: `renderScene`, `sceneLights`
  - `stamp` (owned by `stamp`) — 1 site: `renderScene`
  - `voidCastMeshes` (**since 2026-08-06 owned by the SUBSTRATE, not by `voidcast`**) — 1
    site: `renderScene`. The extraction left the Map in the closure precisely because this
    edge exists: it is a `HostSubstrate` value member that `field-voidcast.ts` fills and
    `renderScene` drains, one identity rather than two copies. The edge did not go away — it
    stopped crossing a cluster line and started crossing a MODULE one, which is what
    extracting against a substrate is supposed to do to a read edge.

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (0 edges):
  - none

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (0):** none — internal only


### Cluster: picking

**Owns (state) — 0:** none (behaviour only)

**Owns (functions) — 4:** `pickCandidates`@3407 · `pointerPick`@3462 · `applyPointerPick`@3503 · `pointerPress`@3541

**Reads from other clusters** (8 edges):
  - `archetypeById` (owned by `catalogs`) — 1 site: `pickCandidates`
  - `canvasEl` (owned by `input`) — 1 site: `pointerPress`
  - `flagStore` (owned by `analyzer`) — 1 site: `pickCandidates`
  - `layers` (owned by `view`) — 2 sites: `pickCandidates`
  - `log` (owned by `world`) — 1 site: `pickCandidates`
  - `selectedEntityId` (owned by `entities`) — 3 sites: `pointerPress`
  - `store` (owned by `world`) — 2 sites: `pickCandidates`, `pointerPick`

**MUTATES other clusters** (1 edge):
  - `pendingMove` (owned by `move`) — 1 site: `pointerPress`

**Read by other clusters** (0 edges):
  - none

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (0):** none — internal only


### Cluster: input — **PARTIALLY HOLLOWED 2026-08-07** (T3c: the four pointer handlers' BODIES → `field-machine.ts`)

The four `onPointer*` functions are still declared here and still what `attachListeners`
attaches — but since T3c they are one-line delegates onto `machine.pointerDown/Move/Up/Cancel`
(two lines for the first two, which still record `lastPointer` on the way past). The
ARBITRATION they used to hold — pointerdown's seven-way chain, pointermove's six-way, the
pair that end a gesture — is in `field-machine.ts`, because most of what those branches test
is that module's state. The three tests that are NOT its (`camera.look`, `selection.boxAnchor`,
`segment.segmentAnchor`) travel back the other way as liveness thunks on the machine's deps
record, and the verbs the chain dispatches to (`eyedropper`, `applyTool`, `selectionClick`,
`pointerPress`, the segment brush's three) all stayed in their own clusters.

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

The per-binding SITE COUNTS below are not re-derived — that is a full attribution sweep
(§1's rule), and a number that looks fresh but isn't is worse than one that admits its date.
The lists above are per-BINDING and exact at that grain. Grep by name.

**Owns (state) — 2:** `canvasEl`@1667 · `lastCursor`@5973 — **both stayed**

**Owns (functions) — 12** (was 13; `escapeLadder`@6261 was deleted 2026-08-05, §2.2)**:** `syncCursor`@5974 · `onPointerDown`@6056 · `onPointerMove`@6116 · `onPointerUp`@6186 · `onPointerCancel`@6205 · `onWheel`@6229 · `onContextMenu`@6249 · `onKeyDown`@6301 · `onKeyUp`@6431 · `onBlur`@6455 · `attachListeners`@6465 · `detachListeners`@6481 — **all twelve still declared here; four are now delegates (see above), and two new ones joined them (`capturePointer`, `releasePointer`)**

**Reads from other clusters** (37 edges — see the staleness note above):
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

**MUTATES other clusters** (20 edges — this is the list T3c changed most; §5.2 carries the
same ten rows with per-site lines, annotated there):
  - `digging` (owned by `tool`) — 2 sites: `onPointerDown`, `onPointerUp` — **GONE:** binding
    and writer both left, together
  - `dollyPixels` (owned by `camera`) — 1 site: `onWheel` — stayed
  - `keys` (owned by `camera`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp` — stayed
  - `lastPointer` (owned by `targeting`) — 2 sites: `onPointerDown`, `onPointerMove` —
    **stayed**, and deliberately: the two delegates still write it before handing over,
    because its three readers (`ghostState`, `renderCursorAffordance`, the facade's
    `beginMove`) are all in this file and the chain never reads it
  - `lastStroke` (owned by `tool`) — 1 site: `onPointerMove` — **GONE**, with `digging`
  - `look` (owned by `camera`) — 2 sites: `onPointerDown`, `onPointerUp` — **re-homed inside
    this file:** the writes are `beginLook`/`endLook` now, which are `camera`'s, so the edge
    is `camera` writing its own state and `input` no longer has it
  - `maskDropReported` (owned by `tool`) — 1 site: `onPointerDown` — **left the file:** now
    `field-machine.ts`'s `pointerDown` through the `armMaskDropReport` thunk
  - `momentaryCtrl` (owned by `tool`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp` — stayed
  - `momentaryShift` (owned by `tool`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp` — stayed
  - `pendingMove` (owned by `move`) — 2 sites: `onPointerMove`, `onPointerUp` — **GONE:**
    both the binding (2026-08-07, with `move`) and both writers (T3c's chain move) are in
    `field-machine.ts`

**Read by other clusters** (2 edges):
  - `canvasEl` (read in `picking`) — 1 site: `pointerPress` — through `capturePointer` since
    2026-08-07, not the raw element
  - `canvasEl` (read in `targeting`) — 2 sites: `toNdc`
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
    CALL, so counted nowhere at all (§2.1's second correction).

`store` and `log` are `HostSubstrate` value members and needed no addition to the record.
`lastRemeshMs` and `remeshVersion` are host `let`s with exactly one extracted reader each, so
they ride as single-consumer thunks on the module's own record; `analyzerPendingCount` and
`voidCastJobGen` are `const` bindings and pass by reference.

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
- **`input` is a driver, not an owner.** 20 of its edges are writes into `tool`, `camera`,
  `targeting` and `move`. It has no state worth extracting; it is the adapter that turns
  DOM events into calls.
- **`lifecycle.ret.dispose` owns 24 mutations across six clusters.** Any per-cluster
  extraction has to hand teardown back to its cluster, or dispose keeps reaching in.
- **`analyzer` is 14 mutations downstream of everyone who dirties the world.** Its
  staleness flags are set by `world`, `props` and `lifecycle` — it is a subscriber wearing
  the shape of a peer.
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
   read eagerly, which is why `flagStore` moved up out of the advisor block. The substrate
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
