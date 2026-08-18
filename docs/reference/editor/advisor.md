---
summary: A dedicated worker that mirrors the field, flags where the project's own agent cannot walk, and on demand drives the real mover at one finding to prove it.
verified: 2026-08-18
---

# The walkability advisor

The advisor runs core's stage-1 walkability passes over a **mirror** of the field as the user
digs, draws what it finds as severity-coloured markers in the viewport, lists it in a flags
palette, and — on demand — drives the **project's own** mover at one finding to see whether it
really sticks.

**It is advisory throughout (D-F4-1), and that is a design commitment rather than a v0 limit.**
Nothing the advisor reports blocks a verb, mutates a field, or is auto-fixed. A filter HIDES a
finding and a reachability demotion tags one; neither deletes one. The only thing that retires
a finding is a re-analysis that no longer reports it — the analyzer changing its mind.

## The analyzer worker

`packages/editor/src/frontend/analyzer-worker.ts`, with its protocol and client at
`packages/editor/src/field-host/analyzer-protocol.ts` and
`packages/editor/src/field-host/analyzer-client.ts`.

It is **one of the editor's two workers** and one of the **three** entrypoints
`packages/editor/scripts/build-frontend.ts` declares — the chrome (`index.html`), the field
worker, and this one. Derive both:

```sh
grep -rl "new Worker(" packages/editor/src | wc -l          # workers
grep -nE '"src/frontend' packages/editor/scripts/build-frontend.ts   # entrypoints
```

It is spawned by URL as `/analyzer-worker.js`; `packages/editor/tests/build-frontend.test.ts`
pins that the worker bundles land un-hashed at the outdir root, or those URLs 404
([bundling](bundling.md)).

The worker holds a MIRROR `FieldStore` and runs `analyzeChunk` / `markUnreachable` /
`detectPits` from `@furnace/core/field` directly. All logic lives in a PURE handler factory —
`createAnalyzerWorkerHandler({ loadEngine, post })`, the `createFieldWorkerHandler` shape — so
the whole protocol unit-tests with no real `Worker`; the entry wires only the real
`self.postMessage` and the real dynamic import.

### The mirror is every allocated chunk, not a window

That costs a second copy of the world's density, one 4 KiB `Int8Array` per chunk. A window
cannot be made correct: stage 1's ceiling scan is uncapped, so any chunk missing ABOVE an
anchor manufactures a false ceiling and silently drops every rise beyond it.

Buffers are structured-CLONED and never transferred — the host goes on editing its own. There
is no reset verb: a world swap lists the outgoing keys as `removed` (upserts apply BEFORE
removals, so the mirror sync filters the removal list against the LIVE store, since a new world
can reuse an old key), and a `cellSize` that differs from the live mirror's resets it outright.

### The re-analysis set — a caller lists what it WROTE; the worker owns the widening

`reanalysisKeys` (module-private in `analyzer-protocol.ts`) takes each dirty chunk, its 26
neighbours, and every allocated chunk BELOW it in its own XZ column plus the 4 CARDINAL ones,
intersected with what the mirror holds.

The column term is not belt-and-braces: `ceilingAbove` scans the anchor's own column uncapped
and `scanRise` scans each cardinal neighbour bounded only by that ceiling, so a hole dug in one
chunk can let a floor anchor several chunks below see through it for the first time. The
fixture committed beside it (the "cardinal-column term is load-bearing" case) analyses one
chunk before and after a floor appears four chunks up and one column across, and goes from 0
`ledge` to 1. A wider set costs time, never correctness.

ABOVE stays excluded: a higher chunk reads down into the dirty one only at its own bottom row,
i.e. only when it is already a 26-neighbour. The halo's sufficiency for the BOUNDED probes is
lattice-dependent and filed at
`docs/backlog/editor-and-tooling/analyzer-halo-assumes-sub-chunk-reach.md`.

### Serialized dispatch, and it is load-bearing

`self.onmessage` re-enters per message regardless of whether the previous one settled, and
`verify` suspends twice (the bundle import, then inside `analyzerVerify`, which awaits
`createWorld` BEFORE reading the store). A `sync` landing in either window would mutate the
very `FieldStore` the in-flight verify captured, and the verdict would describe a half-updated
mirror — not corruption, but a wrong answer in exactly the edit-while-verifying case the editor
is for.

So the handler chains every message onto one tail, and **the tail's rejection is caught**: a
rejected tail makes every later `.then` skip its callback, wedging the worker permanently. That
catch also MARKS the rejection handled, which silences the runtime's own report — so
`analyzer-worker.ts`'s `console.error` is the ONLY remaining signal for the one failure the
protocol cannot report over the wire (`post` itself throwing). It is not decoration.

### jobId discipline

Every request has exactly one response, `acked` included, so a FAILED mirror update reaches a
waiter instead of being dropped. The client's `pending` map discards any response nobody asked
for, resolves by the response kind the request DERIVES (`RESPONSE_KIND satisfies
Record<AnalyzerRequest["kind"], …>`), and rejects a wrong-kind answer rather than casting it.

The dispatch's `default` arm throws through a `never`-parameter guard, so a new request kind
with no `case` is a COMPILE error — and it is a real runtime refusal too, which is the half
that matters: an `if`/`else` chain would send anything unrecognised into its LAST arm, silently
clobbering the collider set and acking success.

### One `PhysicsContext` per worker lifetime

`loadEngine` is memoized on first use and never re-run per verify. The ES module registry would
dedupe a same-URL re-import anyway; what the memo adds is that a DIFFERENT url can never be
loaded into this worker — the project's verify path holds one headless `PhysicsContext` as a
module singleton, and core's context ids are 16-bit and wrap without aliasing detection. Only a
LOAD failure drops the memo, so a later verify can retry a bundle that has since built.

## Host wiring and the two cadences

The mirror syncs at the SAME density choke point the void cast invalidates from, so every write
is mirrored by construction. A latest-wins pump (`createAnalyzePump`, exported from
`analyzer-client.ts`) collapses bursts: the fire callback is read at FIRE time, so the
accumulated dirty set goes out rather than the one current when a key was pressed; it posts the
mirror sync and the analysis in ONE turn and relies on the worker's arrival-order dispatch
rather than awaiting the ack. `undefined` leaves the latch idle. It is a COMMAND as much as a
query, deliberately.

**Two cadences, and the split is the whole cost story.** Per-edit passes analyse what was
written and go out immediately. The two CONNECTIVITY passes — the reachability demotion and the
pit hunt — are whole-world by nature (one dug cell can open or seal a trap anywhere) and ride
an idle tail, `ANALYZER_IDLE_MS` (`packages/editor/src/field-host/field-analyzer.ts`), re-armed
by every density write so a drag pushes them out rather than running them.

**That debounce is the budget knob, and the measurement behind it is recorded here because no
seal carries it.** F4 tranche A measured the whole-world re-flood at ~72% of a full
`analyzeWorld` on top of it — 2.9–3.2 ms against 4.1–4.2 ms over 108 chunks, both growing with
the world. That is a dated snapshot (2026-07-26), not a live figure; re-measure before reasoning
from it.

## Nothing is posted without an agent profile

The advisor is parameterized on the project's capsule, and a guessed one would be the advisor
inventing its own premise. With no profile the pending flags accumulate (an install later
catches up in full), nothing goes out, and the host says so ONCE — *"walkability advisor idle —
this project installs no agent profile"* — at the first edit that would have analysed, as a
**`warn`** rather than an error. The advisor is behaving correctly and no verb was refused, so
this must not light the ⚠ chip on an otherwise clean boot. It is the only `warn` the tool-error
seam sends; every refusal on it, `verifyFlag`'s included, stays `error`.

Reachability and pit SEEDS are the loaded world's manifest `playerStart`, and EMPTY for a new
world honestly so: both passes refuse an empty seed set outright rather than demoting
everything or guessing where the agent enters.

`FieldStats.analyzerPending` is 0–2 (1 in flight + 1 queued; the latch admits no more) and
counts work the pump would actually RUN, not flags the host happens to hold. Two states set a
flag and owe nothing, and both read 0: no profile IN HAND — off, not busy — and a world with no
chunks in it, where the whole-world request DEFERS rather than consumes and has nothing to
analyse until something is dug or loaded. `analyzerPendingCount` and the fire path decide that
on ONE predicate (`analyzerHasWork`), so the meter cannot claim a pass the pump has already
declined. The status bar's analyzer chip is absent at 0 and names the count above it, because
the count is PASSES owed, not chunks.

### The idle notice waits for the profile QUESTION to be answered

`setAgentProfile` takes `AgentProfile | null`, and the `null` is load-bearing: the profile
arrives over HTTP (the catalog hook → `/catalog/agent.json`) and the pump does not wait for it,
so "no profile in hand" reads identically before any answer and after a negative one. The
notice is a claim about the PROJECT and its one-shot makes it permanent, so posting it from the
in-flight state would state — for the session — whichever of two async arrivals won the race,
on a project that may well ship a profile.

`setAgentProfile(null)` is the negative answer, *"asked, and this project has none"*: it
catches nothing up, requests no pass, and posts nothing itself — it only licenses the next pass
to say so, which keeps the notice's moment at the first edit that would have analysed rather
than at load.

**Only the catalog 404 may send it.** A failed fetch does not know (a 500 over a project with a
fine `agent.json` is the ordinary case) and a malformed catalog knows the opposite; both already
reported what happened with the status or the JSON path in the line, and the idle sentence would
be a second, less true account of it. Everything else that reads the profile — the pump, the
`verifyFlag` guard, the pending count — treats the two null-ish states the same on purpose:
neither has a capsule, so neither owes any analysis.

## The flag store

`packages/editor/src/field-host/field-flags.ts` is pure and GPU-free (the `field-ghost.ts` /
`field-placements.ts` sibling). `createFlagStore()` holds stage-1 findings by OWNER chunk, pits
beside them (a pit region can span chunks, so its anchor's chunk is not a complete owner), and
verdicts keyed by `${kind}@${cell}` — the same key the presentation dedupe uses, which is not a
coincidence: a verdict is about a finding the user can see.

A `flags` response REPLACES every chunk it names, empty lists included, which is how a fixed
problem stops being reported AND how a stale `unreachable` tag clears (`markUnreachable` leaves
prior demotions standing on its skip paths, so a store that MERGED tags would hide those
findings for the session). `pits` replaces the pit set wholesale when present and is ABSENT on
an incremental response — emitting `[]` there would clear every trap on the next keystroke.

**Cross-border duplicates are real and paid for here.** `low-clearance` anchors on the
offending NEIGHBOUR cell, so a border cell is emitted by both owners' passes (tranche A measured
48 duplicated cells of 208 on a border-aligned fixture). Suppressing that in core would LOSE
flags at the border, so the store's dedupe keeps the LEAST-demoted copy — the two can carry
different `unreachable` tags, having been analysed by different passes, and a stale demotion on
one owner must never hide a finding the other has nothing against. Ordered by key string:
determinism, not spatial order, so a list does not reshuffle between responses that found the
same things.

**Filters are one-sided by design.** The default filter set is candidates only, and it is CHROME
state — `DEFAULT_FLAG_FILTERS` lives in `packages/editor/src/frontend/lib/field-host-mirrors.ts`,
not in the store. The reachability test hides `unreachable === true` and nothing else:
`undefined` is the normal mixed-vintage state of a per-chunk analyzer beside a whole-world pass,
and the PERMANENT state of every `pit` (which that pass skips), so testing `=== false` for
"reachable" would silently hide every never-flooded finding — a false negative wearing a
filter's clothes. Filters survive world loads, like the layer flags; `clear()` drops findings,
pits and verdicts but not filters.

## Viewport markers

ONE instanced unit cube per visible finding at `FLAG_MARKER_SIZE_M`
(`packages/editor/src/field-host/field-analyzer.ts`) — under the 0.25 m cell, so it reads as a
pin ON a floor cell rather than a block filling it — lifted `cellSize / 2` so it occupies the
AIR cell its flag anchors on.

UNLIT instanced (`shader.unlitInstanced`, white base), deliberately: a marker that dims when the
camera-following key light looks away is a marker that stops doing its job in the shading mode
meant for mood. Whole-layer teardown-and-rebuild, the `rebuildProps` rule.

Colour is the stage-2 verdict if there is one, else the triage band. The four tints are declared
in `field-flags.ts`: `CANDIDATE_TINT` red, `INFO_TINT` the selection amber (shared with the
host's `SELECTION_COLOR` rather than restated — both mean CONTEXT), `VERIFIED_TRAPPED_TINT` the
candidate red darkened, `VERIFIED_CLEAR_TINT` a muted green. An `inconclusive` verdict falls
THROUGH to the band: a verify that ran out of budget proved nothing, and a third colour would
read as an answer.

`FieldHost.flagMarkerCount()` is the `propInstanceCounts()` twin — the layer is otherwise
write-only GPU state, so the count the rebuild settled on is the one readable fact and what
tests hold it to.

### ⚠ Nothing in the automated suite proves the markers REACH THE SCREEN

Deleting the `layers.flags && flagMarkers` push from `renderScene` fails no test in this repo,
and neither does whitening the tint at its UPLOAD site. Keep that second one qualified — the
tint policy itself IS pinned (`packages/editor/tests/field-host/field-flags.test.ts` asserts all
four constants and the `inconclusive` fall-through), so the gap is the hop from that pure
function to the GPU, not the colour policy, and the unqualified version under-claims real
coverage.

`packages/editor/tests/field-host-analyzer.gpu.test.ts` builds the layer against a real device
and pins its instance count, and its tick tests do call `renderScene` — but the host requests its
context WITHOUT `surfaceFormat: "linear"`, so under bun-webgpu that render is invalid
(asynchronously, as uncaptured device errors, which is why the tick still returns), and there is
no draw-list seam and no pixel read.

The weight of *"the markers are visible"* therefore rests entirely on
`packages/editor/scripts/analyzer-pixel-check.md`, which owns the four claims, the procedure, the
expected colours, and the warning that its pixel counts are one camera's reading rather than
constants. **Run it whenever anything under the marker layer changes.** Precedent:
`docs/learnings/2026-07-21-invisible-line-overlays.md` — ONE bug class (a `drawLines` MSAA
sample-count mismatch) that shipped dead pixels through TWO sealed slices and passed every
headless test.

## Stage 2 — the verify verb

This is the one place the editor loads the PROJECT's engine into a worker. `verifyFlag(key)`
posts the flag to the analyzer worker, which imports `/engine.js` and resolves
`getService("analyzerVerify")` off the bundle — the dungeon's own `walk-probe.ts`, driving the
real `CharacterMover` down directed lanes in a locally built physics scene. There is no
engine-generic form of this and there should not be: *"test the code, not the data"* only means
anything if the code under test is the project's own.

The verdict crosses as `VerifyVerdictWire` (`analyzer-protocol.ts`), a deliberate STRUCTURAL
twin of the dungeon's `VerifyVerdict` and NOT an import of it — the editor is project-first, has
no dependency on any project, and the bundle crosses that boundary untyped. The editor takes no
dependency on `@furnace/dungeon` at all; derive:

```sh
grep -rn "@furnace/dungeon" packages/editor/src packages/editor/package.json
```

Keep the fields identical; do not "unify" them by importing, because the import is what the
architecture forbids and the twin is what makes the boundary honest.

**Verify is ONE at a time, budgeted, and refuses four ways.** Past `VERIFY_BUDGET_MS`
(`field-analyzer.ts`) the verdict is `inconclusive` with reason `budget`, which the palette
paints as no answer rather than a third one. The four refusals, in the order a user meets them,
all through `subscribeToolError`:

1. a verify already running;
2. no agent profile — checked BEFORE the key lookup, so the message names the root cause
   instead of sending the user hunting a flag that was never analysed;
3. a key that no longer resolves (*"that flag was re-analyzed away"*);
4. a `pit`, refused in the HOST as well as disabled in the palette — stage 2 drives lanes at one
   anchor cell and a pit is a whole region, so one anchor's lanes would prove nothing about it.

A `worldEpoch` counter drops a verdict landing after a world reset; every OTHER staleness route
is the flag store's own rule (a chunk's re-analysis drops its verdicts). The in-flight latch
releases on every SETTLEMENT, or one dead bundle would cost the verb for the session. It does
NOT cover a `bundler.build()` that never settles — that import runs before the budget is
consulted and nothing bounds it, and a host-side timeout was deliberately not added: the worker
dispatches on a serialized tail, so a hung import has already wedged sync and analyze too, and a
timeout would trade a visibly stuck verb for an invisibly stuck one.

### Both transports are exercised, and they ARE two

`packages/editor/tests/analyzer-verify.test.ts` rides the real path headlessly — the real daemon
serving the real dungeon project, the real `analyzer-worker.ts` spawned as an actual Bun Worker,
a headless `PhysicsContext` with no GPU behind it, Rapier's wasm initialising in that realm, and
the shipped `CharacterMover` driven at a flag.

It carries ONE honest deviation, recorded in its own header: Bun cannot dynamically import over
http (`import("http://…")` fails with `ENOENT`, measured 2026-07-26), so the test fetches
`/engine.js` from the running daemon and writes those exact bytes to a temp FILE. The artifact is
the daemon's; only the transport differs — which is why the browser's native `import("/engine.js")`
over http had to be checked separately, and was, at the F4 gate. That is the pixel-check recipe's
own claim 4: *a verify that raises an error instead of a chip is a no-go.* All-`inconclusive`
would not be a failure on its own (it is a real outcome); a `clear` and a `trapped` in the set are
what prove the mover actually walked lanes.

## The flags palette

`packages/editor/src/frontend/components/shell/FlagsPalette.tsx` — presentational: every host
verb arrives as a prop. It renders on what was FOUND, not on what is shown, because gating on the
visible rows would unmount the only control that could bring them back.

Findings group into rows by band (`kind`/`severity`/`unreachable`) and then agglomerate greedily
within `CLUSTER_RADIUS_M` (declared in that file) — single-linkage, so a run of pinches along a
corridor chains into one row; greedy rather than connected components, which leaves boundaries
arrival-order dependent and therefore STABLE, since the store hands findings over in key order
and the sort is stable.

Clicking a row frames its chunks (a pit's whole region via its chunk list, a per-cell finding's
owner chunk). Verify runs on the row's ANCHOR — for a cluster that is a sample, not a survey,
which is why the verdict chip reads `first: trapped` on a clustered row and why the scope rides
the TEXT rather than a tooltip (a `title` reaches a mouse and nothing else, and `narrow ×3 ·
trapped` read as three proven traps is the exact misreading).

The triage band reaches assistive tech as a word in the frame button's accessible name and
colour-blind eyes as a filled-vs-hollow dot glyph — colour alone would be the only signal of the
axis the list is triaged BY (WCAG 1.4.1). The Verify button's `disabled` is DERIVED from its
refusal string, never restated, so a third reason cannot leave the button live while its own name
announces why it is not.

**The filters gate BOTH surfaces**, because the host applies them once in its store and both the
marker rebuild and the list read what survives — so a checkbox in the palette also changes what
the viewport draws. The publish path is the ONE route from "the findings changed" to "everything
that shows them agrees": it rebuilds the markers FIRST and notifies the subscriber second,
because a subscriber may read the host back synchronously (the palette does) and none may observe
a summary whose markers are stale.

**Chrome state and its honest cost.** The summary is the host's; the filter set and the in-flight
verify key are CHROME state, held as two provider cells that each surface latches for itself.
`verifying` cannot live in the host because releasing it needs two signals no single host seam
carries — a verdict arrives on `subscribeFlags`, and each `verifyFlag` refusal arrives on
`subscribeToolError` having pushed no flags at all. Both releases are deliberately BLUNT (an
unrelated tool error also clears it; so does any flags push, not just the one carrying the
verdict), because that way round costs a button that looks live for a moment against a column
that sticks for good. The filters follow the layers/slice precedent — one effect keyed on the
value, so engine-ready and every later edit are ONE mechanism — and the provider mounting with
the shell is what makes them survive a palette being closed and re-opened. Remembering them
across SESSIONS is open (D-3).

## The `flags` layer gate

`flags` is one of the **eight** members of `FieldLayers`
(`packages/editor/src/field-host/field-host.ts`) — `field`, `kit`, `props`, `ghost`,
`selection`, `grid`, `flags`, `voidCast`. Derive:

```sh
sed -n '/^export type FieldLayers = {/,/^};/p' packages/editor/src/field-host/field-host.ts
```

Hiding the layer does NOT stop the analyzer — findings keep arriving and `subscribeFlags` keeps
firing, exactly as a hidden `selection` layer keeps masking ops.

## Two core instances in one realm, and why it is inert

The analyzer worker's realm holds TWO core instances, and the two workers are exempt from the
engine-leakage rule for DIFFERENT reasons. The field worker is the easy case — its realm never
loads `/engine.js`, so it holds exactly one core. The analyzer worker holds the copy bundled via
`analyzer-protocol.ts` AND the one esbuild inlines into the project's `/engine.js`.

**The duplicate is REAL**, so do not cite this exemption as evidence that a worker realm cannot
have one. It is inert on two conditions that both have to keep holding:

1. everything crossing the seam is plain structural DATA — no class identity, no `instanceof`,
   no symbols — so which core minted a value cannot matter;
2. the two share no module-level state: our copy runs the pure column pass and the placement
   rasterizer, the bundle's owns the physics context and the collider derivation. That second one
   is a claim about EXECUTION, not bundle content — even when Rapier ships inside a worker
   bundle, nothing in this realm calls it.

`packages/editor/tests/frontend-no-engine-leakage.test.ts` scopes its exemption to
`(field|analyzer)-protocol` and carries the full argument and the measurements in its exemption
comment ([bundling](bundling.md)).

## The agent profile catalog

`catalog/agent.json` is a project→editor catalog contract, DATA only, fetched with the materials
and entities catalogs in ONE pass so they cannot race. `parseAgentCatalog`
(`packages/editor/src/shared/catalog.ts`) validates it setup-loud with the same `CatalogError` and
path naming, and the host takes the result through `setAgentProfile`.

It is **STRUCTURAL validation only** — every field present and finite. The numeric CONTRACT
(positivity, `climbCeiling > stepHeight`, `clearance` at least the capsule's height, `skin` under
the radius) belongs to core and is reached through `assertAnalyzeInputs`, the setup-loud gate
every analyzer entry point runs FIRST; that function and the profile assertion behind it are
**package-internal to `@furnace/core`** and not on its published surface, so the editor cannot
call them directly and reports through the worker's typed error channel instead. Restating the
numeric rules in the editor would be a second source of truth that can disagree with the gate
that decides.

Both good outcomes are SILENT: a parsed profile shows itself in the markers, and a 404 is a
project with no agent — which the host already reports at the first edit that would have
analysed, a better moment than load. Only a MALFORMED catalog has something to say here, and it
must be said, or nothing would tell the user why the advisor never lit up. **The agent catalog
gates nothing; only MATERIALS gates Load.**

## What the advisor shares with the placement layer

Two facts hold the advisor's rasterized solidity, the committed prop layer, the placement ghost
and the game's rigid bodies to one pose:

- **The collider `anchor` (D-F4-14).** `EntityCollision` carries an optional
  `anchor: "center" | "base"`, structurally core's `PlacementCollision["anchor"]`, and the catalog
  parser carries it explicitly on all three kinds — that parser is a WHITELIST, and a dropped
  `anchor` would draw a base-anchored prop's proxy half-buried while the runtime stands its
  collider up. The proxy record and corner derivations position on core's
  `collisionCenter(collision, record)` rather than the record's own `position`. Called rather than
  composed, deliberately: the extent rule and the rotation into the record's frame both have to be
  right, and a hand-written copy is how the editor's proxy and the runtime's body drift apart.
- **Proxy scale takes `Math.abs` on every axis.** An extent is a DISTANCE, so a mirrored record
  covers the same box, whereas signed arithmetic would shrink a box's proxy through zero and make
  `Math.max` pick the LEAST negative axis for a round one.

## `GeneratorDef.emits` and the two branches that still sniff

`placesProps(emits)` in `packages/editor/src/field-host/field-placements.ts` is the successor to
a schema sniff that inferred *"does this place props?"* from an `archetypeId` param and would
have mis-read any placer naming its archetype another way. It is read at exactly two sites: the
editor-side empty-result refusal and `FieldGeneratorInfo.placesProps`, which the stamp
inspector's props count reads.

**The other two prop-generator branches still key off the archetype param name** —
`withArchetypeOptions` (the picker) resolves `ARCHETYPE_PARAM` off the schema's properties behind
a `typeof` guard, and `seedArchetypeParams` gates on `ARCHETYPE_PARAM in defaults`. Neither
consults the predicate, before or after.

**Consequence:** a generator that declares `emits: "placements"` (or `"both"`) but names its
archetype param something else gets the refusal and the count, and silently gets NO picker and no
seeding. Unifying the remaining two is unbuilt.

## What the advisor deliberately did not touch

The void cast's worker scheduling. The X-ray monopolises the one FIELD worker with no cancel and
refuses where coalescing belongs; the advisor was given a worker of its OWN rather than touching
that, so its passes never queue behind a cast and the cast's scheduling is unchanged. The gap
stands as filed at
`docs/backlog/editor-and-tooling/void-cast-monopolises-the-worker.md`.
