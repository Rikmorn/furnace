# The `createFieldHost` closure, mapped

A factual map of the state held inside `createFieldHost` in
`packages/editor/src/viewport-host/field-host.ts`, as of 2026-08-03. Every binding in the
closure is assigned to exactly one owning cluster, and every read and write that crosses a
cluster line is listed.

This is a **description, not a proposal**. §7 is the one forward-looking section and is
marked as such.

**Three clusters have since left.** `segment` was extracted to
`packages/editor/src/viewport-host/field-segment.ts` on 2026-08-03 — its six state bindings,
its six functions and its one boundary mutation (`tool.maskDropReported`) are no longer in
the closure. `voidcast` followed on 2026-08-06, to
`packages/editor/src/viewport-host/field-voidcast.ts`, taking two of its three state
bindings and all five of its functions (§6's `voidcast` row records what stayed and why).
`props` went the same day, to `packages/editor/src/viewport-host/field-props.ts`, taking one
of its two state bindings and all three of its functions. Every count below still includes
all three. They are left as measured because they are what the remaining 20 clusters were
sized against; subtract those three rows from §4 when reading them as current.

**And foundations T3a changed three things the map names.** §2.2 records exactly what, and
which numbers below are consequently stale. Read it before trusting a site list.

## 1. The shape of the file

Re-measured 2026-08-05 where the row says so. The rows marked *(2026-08-03)* are the
original pass and have **not** been re-derived — re-deriving them is a full attribution
sweep, not a `wc -l`, and a number that looks fresh but isn't is worse than one that admits
its date.

| Fact | Value |
|---|---|
| File total | **7,228 lines** (re-measured 2026-08-06 after `props` left; was 7,276 after `voidcast`, 7,347 at T3a, 7,410 at the original pass). Net **−48** this time, against 241 lines now standing in `field-props.ts`. Same shape as `voidcast`'s −71: a module pays for a header the closure did not need, moving prose out of a shared file is not the same as deleting it, and the wiring left behind carries new prose of its own. |
| Code / comment / blank | **3,454 / 3,537 / 237** (re-measured 2026-08-06 after `props`; was 3,496 / 3,541 / 239 after `voidcast`, 3,554 / 3,554 / 239 at T3a, 3,620 / 3,551 / 239 originally). The CODE figure is again the one that moved for a structural reason: **−42** code against **−4** comment, because a cluster that leaves takes its prose with it and then earns some of it back at the seam. |
| `export function createFieldHost` | **line 1647** → end of file (**5,582 lines**) *(re-measured 2026-08-06 after `props`)* |
| `return { … }` object literal | **line 6470** *(re-measured 2026-08-06 after `props`)* |
| Closure-level bindings | **281** (re-measured 2026-08-06 after `props` by §2's rule; was 284 after `voidcast`, 289 at T3a, 293 originally. `props` took three functions and one `let` out and put `props` back, which is the whole −3. The arrow-function/data split — 161/132 as originally measured — has still **not** been re-derived) |
| `FieldHost` public members | **66** (re-verified 2026-08-05: 63 defined in the return literal, 3 shorthand re-exports of closure functions: `frameSelection`, `frameWorld`, `snapView`) |
| Clusters below | 23 *(2026-08-03)* |
| Cross-cluster **read** edges | 244 *(2026-08-03 — stale, see §2.2)* |
| Cross-cluster **mutation** edges | **70** *(2026-08-03)* |

The line-count method behind the second row: strip blank lines, count a line as a comment if
its first non-space characters are `//` or if it lies inside a `/* … */` block, and count
everything else as code. The blank count reproduces the original pass exactly, which is the
evidence that the two methods agree.

Comment lines now OUTNUMBER code lines — 3,537 to 3,454, i.e. **50.6%** of every non-blank
line in the file is prose (they were exactly level at T3a, and code led at the original
pass). That density is why the file reads as documented rather than merely large — but the
code alone is 3,454 lines, still ~8.6× the ~400-line file guideline in
`.claude/rules/clean-code.md`, and `createFieldHost` alone is ~112× the ~50-line function
guideline.

**Three clusters out and those ratios have not visibly moved**, which is the honest scale of
the problem. Two different reductions, worth keeping apart because they answer different
questions. Per cluster: `voidcast` took **0.97%** off the FILE (71 of 7,347 lines) but
**1.63%** off the CODE (58 of 3,554); `props` took **0.66%** off the FILE (48 of 7,276) and
**1.20%** off the CODE (42 of 3,496). Cumulatively T3b1 stands at **−1.6%** of the file and
**−2.8%** of the code. The gap between the two figures is the point — a cluster's prose
leaves with it, and then the wiring left behind earns prose of its own, so the FILE shrinks
more slowly than the logic in it does. The code figure is the one that speaks to the
~400-line guideline, and at ~1.2–1.6% per cluster that guideline is not reachable by
extraction of this kind.

The easy extractions are already done. These sibling modules in the same directory are
already pure and are **not** part of the closure: `field-ghost`, `field-stamp`,
`field-placements`, `field-pick`, `field-move`, `field-flags`, `field-history`,
`field-selection-cells`, `field-camera`, `viewport-cursor`, `input-map`, `gizmo`,
`camera-control`, `box-edges`, `reference-grid`, and now `field-segment`, `field-voidcast`
and `field-props` — the last three lifted out STATEFUL rather than discovered to be pure.
What remains inside the closure is the stateful residue.

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

### 2.1 Three corrections, from extracting `segment` and `voidcast` against this map

All three were found by doing the work; all three would mislead the next extraction if left
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
  is the one a reader is most likely to trust as a size.
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

### 2.2 Changed since the measurement pass — foundations T3a, 2026-08-05

Three changes land inside the closure the map describes. Each is recorded here rather than
smeared across §6, because the honest correction for most of the affected rows is "this
site no longer exists", not a re-count nobody has done.

- **`escapeLadder` is DELETED**, and its reads moved. The five-rung chain became a capture
  STACK (`packages/editor/src/viewport-host/input-router.ts`): a state acquires an entry
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
  (`packages/editor/src/viewport-host/view-channel.ts`). The §6 state lists name the new
  bindings, with declaration lines re-measured at T3a. This matters to §2.1's rule and to
  §7.3's mechanism: a seam is now a `const` whose identity never moves, so it is safe to
  pass BY VALUE to an extracted module — thirteen bindings crossed from the `let` column to
  the `const` one, and an extracted cluster can hold its own channel directly instead of
  taking a `() => cb` thunk. No mutation edge in §5 targets a seam, so the 58-`let`/12-`const`
  split there is unaffected.
- **Line numbers have drifted.** The file grew from 7,248 (post-`segment`) to 7,347. Every
  `@line` in §6 is the 2026-08-03 measurement **except** the thirteen seam bindings, which
  were re-measured with their rename. Treat the rest as ±100 and grep by name.

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
| `stamp` | 7 | 19 | 12 | **13** | 45 | 6 |
| `render` | 5 | 5 | 0 | 13 | 30 | 0 |
| `lifecycle` | 5 | 1 | 2 | 11 | 76 | 24 |
| `input` | 2 | 13 → **12** | 1 | 10 | 59 (high — §2.2) | 20 |
| `catalogs` | 3 | 0 | 3 | 10 | 26 | 2 |
| `entities` | 8 | 9 | 8 | 9 | 28 | 0 |
| `selection` | 9 | 17 | 4 | 9 | 21 | 2 |
| `materials` | 17 | 7 | 1 | 8 | 40 | 15 |
| `analyzer` | 19 | 14 | 6 | 8 | 39 | 14 |
| `tool` | 10 | 12 | 4 | 8 → **7** | 35 → **34** | 11 |
| `camera` | 8 | 10 | 4 | 8 | 25 | 10 |
| `targeting` | 1 | 6 | 0 | 7 | 14 | 2 |
| `picking` | 0 | 4 | 0 | 7 | 9 | 1 |
| `props` | 2 | 3 | 1 | 6 | 8 → **7** as `deps` (+**9** uncounted calls — §6) | 2 |
| `view` | 2 | 1 | 2 | 6 | 8 | 1 |
| `move` | 3 | 7 | 1 | 5 | 20 | 5 |
| `gesture` | 4 | 2 | 2 | 5 | 17 | 2 |
| `voidcast` | 3 | 5 | 0 | 4 → **3** | 9 → **8** | **0** |
| `history` | 2 | 2 | 3 | 4 | 7 | 1 |
| `segment` | 6 | 6 | 1 | 3 | 8 | 1 |
| `drift` | 2 | 3 | 2 | 3 | 5 | 3 |
| `stats` | 6 | 1 | 1 | 3 | 5 | 1 |

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
driver: it reassigns state in five other clusters.

| Target | Written by | Line |
|---|---|---|
| `tool.momentaryShift` | `onKeyDown` / `onKeyUp` / `onBlur` | 6421 / 6435 / 6459 |
| `tool.momentaryCtrl` | `onKeyDown` / `onKeyUp` / `onBlur` | 6425 / 6439 / 6460 |
| `tool.digging` | `onPointerDown` / `onPointerUp` | 6106 / 6196 |
| `tool.lastStroke` | `onPointerMove` | 6172 |
| `tool.maskDropReported` | `onPointerDown` | 6107 |
| `targeting.lastPointer` | `onPointerDown` / `onPointerMove` | 6057 / 6117 |
| `camera.look` | `onPointerDown` / `onPointerUp` | 6111 / 6197 |
| `camera.dollyPixels` | `onWheel` | 6235 |
| `camera.keys` (`const` Set) | `onKeyDown` / `onKeyUp` / `onBlur` | 6428 / 6433 / 6457 |
| `move.pendingMove` | `onPointerMove` / `onPointerUp` | 6148 / 6194 |

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

**Reads from other clusters** (31 edges):
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
  - `lastReconfigureMs` (owned by `stats`) — 1 site: `tick`
  - `lastRemeshMs` (owned by `world`) — 1 site: `tick`
  - `layers` (owned by `view`) — 1 site: `ret.init`
  - `normalsMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `remeshVersion` (owned by `world`) — 1 site: `tick`
  - `selectionCellBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `selectionCellMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `stampGhostBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `stampGhostMat` (owned by `materials`) — 2 sites: `ret.dispose`
  - `statsChannel` (owned by `stats`) — 1 site: `tick`
  - `store` (owned by `world`) — 2 sites: `ret.init`, `tick`
  - `unbindCamera` (owned by `camera`) — 1 site: `ret.dispose`
  - `voidCastBind` (owned by `materials`) — 2 sites: `ret.dispose`
  - `voidCastJobGen` (owned by `voidcast`) — 1 site: `tick`
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

Lives in `packages/editor/src/viewport-host/field-props.ts`. The row below is the measurement
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


### Cluster: tool

**Owns (state) — 10:** `tool`@1706 · `momentarySaved`@1712 · `momentaryShift`@1713 · `momentaryCtrl`@1714 · `toolChannel`@1717 · `toolErrorChannel`@1721 · `maskDropReported`@1726 · `digRadius`@1957 · `digging`@1958 · `lastStroke`@1959

**Owns (functions) — 12:** `reportToolError`@2551 · `sphereShape`@2539 · `toolMask`@2569 · `toolOp`@2599 · `strokeShape`@2632 · `commitToolOp`@2656 · `isKitFillTool`@2674 · `eyedropper`@2764 · `applyTool`@2812 · `applyRadius`@3276 · `notifyTool`@5587 · `deriveMomentary`@5599

**Reads from other clusters** (7 edges):
  - `log` (owned by `world`) — 1 site: `commitToolOp`
  - `selection` (owned by `selection`) — 5 sites: `toolMask`
  - `store` (owned by `world`) — 4 sites: `commitToolOp`, `eyedropper`
  - `table` (owned by `catalogs`) — 3 sites: `commitToolOp`, `eyedropper`, `isKitFillTool`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (17 → **16** edges):
  - `digRadius` (read in `input`) — 2 sites: `onKeyDown`, `onWheel`
  - `digRadius` (read in `render`) — 3 sites: `ghostState`, `renderCursorAffordance`, `renderGhostLines`
  - `digRadius` (read in `segment`) — 2 sites: `rebuildSegmentPreview`, `segmentClick`
  - `digRadius` (read in `targeting`) — 1 site: `computeTarget`
  - `digging` (read in `input`) — 1 site: `onPointerMove`
  - `lastStroke` (read in `input`) — 1 site: `onPointerMove`
  - `momentaryCtrl` (read in `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `momentaryShift` (read in `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - ~~`tool` (read in `voidcast`) — 1 site: `requestVoidCast`~~ — **PHANTOM, deleted
    2026-08-06.** `requestVoidCast` never read the `tool` binding; the match was the word
    inside a refusal string. See §2.1's third correction for the class of error.

**MUTATED BY other clusters** (11 edges):
  - `digging` (mutated by `input`) — 2 sites: `onPointerDown`, `onPointerUp`
  - `lastStroke` (mutated by `input`) — 1 site: `onPointerMove`
  - `maskDropReported` (mutated by `input`) — 1 site: `onPointerDown`
  - `maskDropReported` (mutated by `segment`) — 1 site: `segmentClick`
  - `momentaryCtrl` (mutated by `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `momentaryShift` (mutated by `input`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`

**Public members (4):** `setDigRadius`, `setTool`, `subscribeTool`, `subscribeToolError`


### Cluster: view

**Owns (state) — 2:** `layers`@1830 · `sliceY`@1842

**Owns (functions) — 1:** `sliceOpts`@2732

**Reads from other clusters** (2 edges):
  - `selection` (owned by `selection`) — 1 site: `layers`
  - `store` (owned by `world`) — 1 site: `ret.setSlice`

**MUTATES other clusters** (1 edge):
  - `dirty` (owned by `world`) — 1 site: `ret.setSlice`

**Read by other clusters** (5 edges):
  - `layers` (read in `lifecycle`) — 1 site: `ret.init`
  - `layers` (read in `picking`) — 2 sites: `pickCandidates`
  - `layers` (read in `render`) — 14 sites: `renderScene`
  - `sliceY` (read in `targeting`) — 2 sites: `cursorRay`
  - `sliceY` (read in `world`) — 1 site: `remeshOne`

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (2):** `setLayers`, `setSlice`


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
  - `selection` (read in `view`) — 1 site: `layers`

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


### Cluster: gesture

**Owns (state) — 4:** `gesture`@1740 · `pendingStamp`@1780 · `pendingStampChannel`@1813 · `suspendReported`@1786

**Owns (functions) — 2:** `setPendingStamp`@2992 · `suspendedByStamp`@6045

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


### Cluster: stamp

**Owns (state) — 7:** `stamp`@1845 · `stampGen`@1850 · `stampTouched`@1855 · `stampChannel`@1893 · `ghostMeshes`@1877 · `placementGhost`@1886 · `previewCoalescer`@4951

**Owns (functions) — 19:** `randomStampSeed`@3576 · `notifyStamp`@3584 · `destroyStampGhosts`@4088 · `applyStampGhost`@4156 · `sendPreviewJob`@4851 · `previewStamp`@4970 · `nudgeStampRegion`@4982 · `rotationOptions`@4994 · `rotateStampSession`@5017 · `cancelStampSession`@5038 · `reseedForArchetype`@5066 · `openStampSession`@5088 · `stampRegionClick`@5135 · `reportEmptyPreview`@5176 · `commitStampSession`@5196 · `openEntitySession`@5246 · `applyReconfigureSession`@5436 · `commitActiveSession`@5512 · `confirmActiveSession`@5532

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
  - `lastReconfigureMs` (owned by `stats`) — 1 site: `applyReconfigureSession`
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

**Public members (12):** `startStamp`, `updateStamp`, `nudgeStamp`, `rotateStamp`, `rerollStamp`, `commitStamp`, `commitSession`, `confirmSession`, `cancelStamp`, `subscribeStamp`, `openEntity`, `applyReconfigure`


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


### Cluster: move

**Owns (state) — 3:** `moveDrag`@1910 · `moveCommitPending`@1916 · `pendingMove`@1921

**Owns (functions) — 7:** `endMove`@5297 · `beginMoveSession`@5306 · `updateMove`@5339 · `reaimMove`@5383 · `demoteStalledMove`@5396 · `dropMove`@5400 · `cancelMoveInFlight`@6180

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


### Cluster: history

**Owns (state) — 2:** `historyChannel`@1910 · `historySig`@1868

**Owns (functions) — 2:** `notifyHistory`@3617 · `stepHistory`@5550

**Reads from other clusters** (6 edges):
  - `drift` (owned by `drift`) — 1 site: `stepHistory`
  - `log` (owned by `world`) — 8 sites: `notifyHistory`, `stepHistory`
  - `stamp` (owned by `stamp`) — 1 site: `stepHistory`
  - `store` (owned by `world`) — 2 sites: `stepHistory`
  - `table` (owned by `catalogs`) — 1 site: `stepHistory`

**MUTATES other clusters** (1 edge):
  - `drift` (owned by `drift`) — 1 site: `stepHistory`

**Read by other clusters** (0 edges):
  - none

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (3):** `undo`, `redo`, `subscribeHistory`


### Cluster: voidcast — **EXTRACTED 2026-08-06**

Lives in `packages/editor/src/viewport-host/field-voidcast.ts`. The row below is the
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
  - `layers` (owned by `view`) — 14 sites: `renderScene`
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


### Cluster: input

**Owns (state) — 2:** `canvasEl`@1667 · `lastCursor`@5973

**Owns (functions) — 12** (was 13; `escapeLadder`@6261 was deleted 2026-08-05, §2.2)**:** `syncCursor`@5974 · `onPointerDown`@6056 · `onPointerMove`@6116 · `onPointerUp`@6186 · `onPointerCancel`@6205 · `onWheel`@6229 · `onContextMenu`@6249 · `onKeyDown`@6301 · `onKeyUp`@6431 · `onBlur`@6455 · `attachListeners`@6465 · `detachListeners`@6481

**Reads from other clusters** (37 edges):
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

**MUTATES other clusters** (20 edges):
  - `digging` (owned by `tool`) — 2 sites: `onPointerDown`, `onPointerUp`
  - `dollyPixels` (owned by `camera`) — 1 site: `onWheel`
  - `keys` (owned by `camera`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `lastPointer` (owned by `targeting`) — 2 sites: `onPointerDown`, `onPointerMove`
  - `lastStroke` (owned by `tool`) — 1 site: `onPointerMove`
  - `look` (owned by `camera`) — 2 sites: `onPointerDown`, `onPointerUp`
  - `maskDropReported` (owned by `tool`) — 1 site: `onPointerDown`
  - `momentaryCtrl` (owned by `tool`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `momentaryShift` (owned by `tool`) — 3 sites: `onBlur`, `onKeyDown`, `onKeyUp`
  - `pendingMove` (owned by `move`) — 2 sites: `onPointerMove`, `onPointerUp`

**Read by other clusters** (2 edges):
  - `canvasEl` (read in `picking`) — 1 site: `pointerPress`
  - `canvasEl` (read in `targeting`) — 2 sites: `toNdc`

**MUTATED BY other clusters** (0 edges):
  - none

**Public members (1):** `escape`


### Cluster: stats

**Owns (state) — 6:** `statsChannel`@2026 · `cachedLogStats`@2003 · `statsOpsLen`@2004 · `statsUndoLen`@2005 · `statsRedoLen`@2006 · `lastReconfigureMs`@1992

**Owns (functions) — 1:** `currentLogStats`@5949

**Reads from other clusters** (2 edges):
  - `log` (owned by `world`) — 8 sites: `cachedLogStats`, `currentLogStats`

**MUTATES other clusters** (0 edges):
  - none

**Read by other clusters** (2 edges):
  - `lastReconfigureMs` (read in `lifecycle`) — 1 site: `tick`
  - `statsChannel` (read in `lifecycle`) — 1 site: `tick`

**MUTATED BY other clusters** (1 edge):
  - `lastReconfigureMs` (mutated by `stamp`) — 1 site: `applyReconfigureSession`

**Public members (1):** `subscribeStats`

---

## 7. Forward-looking: what this evidence suggests

**This section is a recommendation, not a description of the current system.**

### 7.1 Cleanly separable today

Ranked by external edge count with zero or one mutation crossing the boundary:

| Cluster | External edges | Boundary mutations | Partners |
|---|---|---|---|
| `stats` | 5 | 1 in (`lastReconfigureMs` ← `stamp`) | 3 |
| `history` | 7 | 1 out (`drift.drift`) | 4 |
| `segment` | 8 | 1 out (`tool.maskDropReported`) | 3 |
| `voidcast` | ~~**9**~~ **8** | **0** | ~~4~~ 3 — **EXTRACTED 2026-08-06** |
| `props` | 8 → **7** | 2 out (analyzer staleness flags) → **1 call** | 6 — **EXTRACTED 2026-08-06** |
| `view` | 8 | 1 out (`world.dirty`) | 6 |

All six read the same small substrate — `world.store`, `world.log`, `lifecycle.ctx`,
`lifecycle.disposed`, `catalogs.table` — and nothing else of consequence.

**Three of those five may not be held by value**, which the original phrasing here did not
say. `ctx`, `disposed` and `table` are `let`s the host REPLACES (`init`/`dispose`,
`setMaterialTable`), so an extracted module that copies them reads a photograph: a stale
material table meshes and bakes against a project the user has already changed, and a
snapshotted `disposed` answers `false` for the life of the process. Only `store` and `log`
are `const` handles a module may keep. The settled split is a type now —
`HostSubstrate` in `packages/editor/src/viewport-host/substrate.ts` — and §7.3 states it.

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
   `HostSubstrate`** — `packages/editor/src/viewport-host/substrate.ts`, a package-internal
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
   `notifyTool` / `notifyEntities` / `notifyHistory` / `notifyDrift` are already exactly
   that pattern hand-rolled six times. **Half of that is now shared rather than hand-rolled:**
   T3a's `ViewChannel` (§2.2) owns the subscribe/publish/deliver half for all thirteen seams,
   so what a store would still add is the SLOTS and their change detection, not the
   notification machinery.
4. **Leave `lifecycle` and `render` last.** They are the two functions that legitimately see
   everything; they get simpler only after the clusters beneath them do.

### 7.4 Which cluster to extract first

**DONE — extracted 2026-08-06** to `packages/editor/src/viewport-host/field-voidcast.ts`,
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

`segment` and `history` are close seconds (one boundary mutation each).

**And `props` went second the same day**, ahead of both — not because this section ranked it
there (it did not; two boundary mutations put it below them here) but because T3b1 ordered
its tasks by MEASURED extraction cost against the as-built, and the two staleness flags turn
out to be one named write-thunk rather than two problems. What the ranking above could not
see is the thing that made `props` interesting: nine inbound CALLS, which no column here
counts (§2.1's second correction). See §6's `props` row.

### 7.5 Honest assessment: extracting the stamp session

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
