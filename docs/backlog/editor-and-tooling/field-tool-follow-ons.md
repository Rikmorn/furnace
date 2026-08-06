# Field tool follow-ons — props, stamp sessions, the segment brush, the void cast

Tracker for the field-editor tool items deferred out of F2b/F3a/F3b: each is a known
gap, cost, or divergence in the field tools that was filed rather than fixed because it
needed a design call, a measurement, or a scope the shipping task did not have. They are
merged so there is **one place to check whenever you touch
`packages/editor/src/field-host/field-host.ts`, `field-props.ts`, `field-placements.ts`,
or `packages/core/src/field/{ops,kit-render,reconfigure}.ts`**. Nothing here blocks; every
section keeps its own trigger. Sections keep their original content.

`field-props.ts` joined that list at foundations T3b1 (2026-08-06), when the prop layer was
lifted out of `field-host.ts`; three of the sections below point at it, and the host now
holds only the nine call sites and the `propInstanceCounts` facade.

**Not in here:** the F2b/F3a/F3b gate-UX finding SETS were separate files until the F4.5
seal (2026-08-03) consumed them into the charter and deleted them. What survived them lives
in `box-select-is-two-clicks-not-a-drag.md`, `create-session-ghost-cannot-be-dragged.md` and
`void-cast-budget-and-inside-view-are-still-unwalked.md`; the rest is as-built in
`docs/reference/editor-architecture.md` §16–§18.

## Editor props render as collision PROXIES, not the archetype's actual meshes

**Context.** F3b Task 10 gave the field editor its placed-prop layer: after a scatter
commits, the prop layer `FieldHost` delegates to (`field-props.ts` since T3b1) rebuilds one
instanced draw per archetype from the op log's `PlacementOp` records (`rebuildProps` →
`groupPlacements` → `packPlacementMatrices`). What
each instance DRAWS is a unit primitive sized from the catalog's **collision** block — a
cube for `box`, a sphere for `sphere`, a cylinder for `capsule` — tinted with the
archetype's `material.litColor`. The stamp ghost does the same thing in wireframe.

The dungeon does not: its field-world loader fetches each archetype's `.fmesh` variants
and instances the real geometry (`buildArchetypeGroups` in `packages/dungeon/src/field-world.ts`).
So the editor shows you correct COUNT, POSE, SCALE and rough VOLUME of every prop, but not
its silhouette — a stalagmite reads as a capped cylinder, a rock as a box.

That was the honest v0 call rather than an oversight: mesh-accurate props need a `.fmesh`
fetch + decode path inside the editor (the chrome cannot value-import core, and the host
has no asset transport of its own today — the material and entity catalogs both arrive as
parsed JSON from a chrome-side `fetch`), a per-(archetype, variant) geometry cache with a
teardown story, and a decision about what happens when a variant mesh 404s mid-session.
Proxies cost none of that and are never WRONG about the thing the editor is actually for
at this stage: where the props are and whether they collide with the walk-gate.

Note the shading constraint any replacement inherits: the prop layer shares the kit's
`litInstanced` material, whose no-inverse-transpose normal shortcut survives the proxies'
non-uniform scale only because each primitive's normals are eigenvectors of its scale (see
`proxyRecords`' TSDoc). An arbitrary `.fmesh` under a non-uniform scale would skew normals
with no test to catch it — real meshes must either keep uniform scale or get a material
that supplies proper normals.

**Trigger to revisit:** the F4 "seeing & the cockpit pass" (where prop appearance is the
point), OR the first time a silhouette mismatch actually misleads a placement decision —
e.g. props read as well-spaced in the editor and visibly interpenetrate in the game.

**Reference:** `packages/editor/src/field-host/field-placements.ts` (the proxy
mapping + the shading constraint); `packages/editor/src/field-host/field-props.ts`
(`rebuildProps`, `proxyGeometry` — both were in `field-host.ts` until foundations T3b1,
2026-08-06); `packages/editor/src/shared/catalog.ts`
(`parseEntityCatalog` — deliberately does not carry the catalog's `meshes` paths);
`packages/dungeon/src/field-world.ts` (`buildArchetypeGroups` — the mesh-accurate loader
this would converge on); `docs/reference/dungeon-architecture.md` (the placement artifact).

## The placement sizing convention is implemented twice, with nothing pinning the two together

**Context.** One rule — "how big is a placed prop, given its archetype's collision
primitive and its record's per-axis scale" — has two independent implementations:

- `proxyScale` / `proxyExtents` in `packages/editor/src/field-host/field-placements.ts`
  (editor): the proxy the editor DRAWS, both as a ghost wireframe and as the committed
  instanced prop.
- `placementCollider` in `packages/dungeon/src/field-world.ts` (game): the static collider
  the runtime DERIVES at load.

They agree exactly today, including the fiddly parts — a `box` scales per-axis, a
`sphere`/`capsule` takes the MAX scale axis because a radius has no per-axis form, and a
capsule's height is `2·(halfHeight + radius)`. The editor's TSDoc says so and cites the
dungeon as the authority. But nothing FAILS if one drifts, and drift is silent in the worst
possible way: the whole value of the proxy is that it predicts the collider, so a divergence
shows up as props that looked well-spaced in the editor and interpenetrate (or block a
walk-lane) in the game — exactly the class of bug a walk-gate is expensive to diagnose.

A parity test was considered and rejected as not-yet-cheap. `placementCollider` is a private
function inside `field-world.ts`, a module that pulls the dungeon's renderer and physics; an
editor test cannot import it without either exporting it (a dungeon src change for a test's
benefit) or loading a heavy module headlessly. Re-encoding the mapping in a test instead
would just be a THIRD copy of the convention, catching drift only in whichever copy the test
happened not to share.

The durable fix is the one the duplication points at: promote the sizing beside
`packPlacementMatrices` in `packages/core/src/field/kit-render.ts`, which is already the
single source of truth for the other half of this exact problem (placement TRS packing,
extracted in F3b Task 6 precisely because three consumers had copies). That needs core to
carry the collision-primitive vocabulary — which today lives only in the two consumers'
local catalog types — so it is a core API decision, not a patch.

**Trigger to revisit:** F4 or F5 next touches either implementation, OR the placement
sizing gains a third consumer (which is the same threshold Task 6 used for
`packPlacementMatrices`), OR a walk-gate turns up props that collide differently than they
drew.

**Reference:** `packages/editor/src/field-host/field-placements.ts` (`proxyExtents`,
`proxyScale` — and their TSDoc, which names the dungeon as the authority);
`packages/dungeon/src/field-world.ts` (`placementCollider`);
`packages/core/src/field/kit-render.ts` (`packPlacementMatrices` — where the promoted
version would live, and the precedent for promoting);
`packages/editor/tests/catalog.test.ts` (the cross-package coupling-test precedent: it
parses the catalog the dungeon actually ships).

## The editor's prop layer rebuilds unconditionally, and re-creates proxy geometry every time

**Context.** `rebuildProps` in `packages/editor/src/field-host/field-props.ts` tears the
whole placed-prop layer down and rebuilds it from the op log on every path that could have
changed it — commit, reconfigure apply, ⌘Z/⇧⌘Z, world new/load, `setEntityCatalog`. Two
costs ride along, and they are one fix:

1. **No change detection.** The rebuild runs whether or not any placement op moved. In a
   world with props, undoing an ordinary brush stroke destroys and recreates every
   archetype's geometry and instanced buffers for a step that touched no placement at all.
2. **No geometry cache.** `proxyGeometry` creates a fresh `geometry.cube` / `sphere` /
   `cylinder` per archetype per rebuild, though there are at most THREE distinct primitives
   in the whole system (the three `EntityCollision` kinds), and their sizes are fixed unit
   constants — nothing about them varies per archetype or per record.

Neither is a live problem. Undo is user-paced, the layer is small at F3b scale, and instance
counts are fixed at creation so *some* rebuild is required whenever the record set changes.
The unconditional shape was also the honest first version: it has no cache to invalidate and
no signature to get wrong, which is what a first slice should optimise for.

The fix is one change with two halves: a `Record<ProxyPrimitive, Geometry>` cache created at
`init` and destroyed at `dispose` (the three unit primitives never vary, so they never need
rebuilding), plus a grouping-signature check at the top of `rebuildProps` that returns early
when the per-archetype record set is unchanged. The signature has to cover record CONTENT,
not just counts — a scatter re-cook can return the same number of records at different poses
(`propInstanceCounts` alone would not see that), so it needs the placement op ids, which the
log already carries.

**Trigger to revisit:** before F5 streaming scale (where a world holds far more props than
one region's worth and a full teardown per undo stops being free), OR the first time the
prop layer lands on a per-frame path — e.g. slice-clipping the props
(the *Placed props ignore the slice plane* section below), whose most likely implementation
rebuilds the layer on every slice-slider tick, which is a drag, which is a hot path.

**Reference:** `packages/editor/src/field-host/field-props.ts` (`rebuildProps`,
`proxyGeometry`, `destroyProps` — the whole cluster, lifted out of `field-host.ts` at
foundations T3b1, 2026-08-06; the call sites stayed behind and there are NINE of them, not
seven — see `docs/reference/field-host-clusters.md` §6's `props` row);
`packages/editor/src/field-host/field-placements.ts` (`groupPlacements` — the grouping a
signature would be taken over; `PROXY_PRIMITIVE` — the three-primitive ceiling);
the *Placed props ignore the slice plane* section below (the sibling that would
make this a hot path).

## Placed props ignore the slice plane — they draw full-height over a sliced field

**Context.** F3b Task 10 added the editor's committed prop layer (`rebuildProps` in
`packages/editor/src/field-host/field-props.ts`), gated by the `props` layer flag alone.
`setSlice(y)` clips the FIELD and the KIT by re-meshing every chunk through the worker's
apron clamp (samples at/above the plane read as air), and it makes every gesture raycast
slice-coherent. Props get none of that: turn the slice on and the cave's floor is cut away
while its rocks and stalagmites still hover at full height over the cut.

The stamp GHOST has the same v0 gap and it is already documented as deliberate
(`applyStampGhost`: "the stamp ghost renders FULL-HEIGHT even over a sliced field").

**Third instance, F3b Task 12 — the void cast.** `requestVoidCast` sends the worker no
`sliceY`, so the X-ray casts the whole air volume and draws it with `compare: "always"`;
enable both and the cast paints over the cut the slice just made. Unlike the props, the
right answer here is not obviously "clip it": an X-ray that ignores the slice is arguably
what an X-ray is for. It joins the list because whatever rule the other two settle on has
to say something about this one, and because the three of them are now the whole set of
display layers that disagree with the slice.

This did NOT qualify for the AGENTS.md inline-fix threshold, on two of its four conditions:

- **It needs a design decision.** The field's slice is a geometric clamp; a prop has no
  geometry the editor owns (it is a proxy primitive, and eventually a `.fmesh`). The
  candidate rules are cull-whole-prop-by-anchor-Y, cull-by-AABB-overlap, or a real
  per-instance clip in the shader — visibly different answers for a prop straddling the
  plane, which is the common case for a floor scatter under a floor-height slice.
- **It is not a small change.** Instanced draws have a fixed count set at creation, so a
  cull rule means rebuilding the whole layer on every slice-slider tick (the slider is a
  drag), or splitting the layer into per-slice partitions, or moving the decision into the
  shader. Each of those is a different cost profile, and the slider is a hot path.

**Trigger to revisit:** the F3b Safari gate, if slicing a props world reads as broken
rather than as a known display gap; OR whenever the stamp ghost's identical full-height gap
is closed (the two want the same answer, and closing one alone would make the ghost and the
committed layer disagree with each other). The void cast rides along on whichever fires.

**Reference:** `packages/editor/src/field-host/field-host.ts` (`renderScene`'s `props`
gate; `setSlice`; `applyStampGhost`'s existing full-height note);
`packages/editor/src/field-host/field-protocol.ts` (`sliceAprons` — how the field is
actually clipped); `docs/reference/editor-architecture.md` §16 (Layers + slice) and §18
(the prop layer).

## Switching archetype mid-session keeps the previous archetype's scatter hints

**Context.** F3b Task 10 wired the entity catalog into the stamp form: a scatter session
opens with the chosen archetype's authored `scatter` block (density / minSpacing /
scaleRange / variants …) overlaid on the generator's schema defaults
(`seedArchetypeParams`, called once from `FieldHost.startStamp`). The `archetypeId` param
also renders as a picker, its options the catalog ids (`withArchetypeOptions`).

Seeding happens ONCE, at session open. Picking a different archetype in the form after
that changes the id alone — a session opened on `rock` (density 0.3, spacing 1.0) and
switched to `stalagmite` keeps rock's numbers instead of stalagmite's authored 0.15 / 1.4.
The props are placed with the wrong distribution for what they are, and nothing says so.

The alternative — re-seeding on every archetype change — is not obviously right either: it
silently discards whatever the user just tuned. The real answer is probably a third shape
(track which params the user has actually edited and re-seed only the untouched ones, or
offer an explicit "reset to <archetype> defaults" affordance beside the picker), which is
a UX decision, not a patch. Filed rather than guessed at.

**Trigger to revisit:** the F3b gate round, if switching archetype mid-session comes up as
a real annoyance; OR the first catalog with more than two archetypes, where switching
between them stops being a rare gesture. It also becomes moot if a future design gives
each archetype its own palette button (one press = one session, seeded correctly).

**Reference:** `packages/editor/src/field-host/field-placements.ts`
(`seedArchetypeParams`, `withArchetypeOptions`);
`packages/editor/src/field-host/field-host.ts` (`startStamp` — the seeding call site
and the TSDoc that states the once-only rule); `packages/dungeon/catalog/entities.json`
(the authored `scatter` blocks).

## Reconfigure ghost previews against CURRENT field state, not the entity's pre-span state

**Context.** F3a Task 8 shipped `FieldHost.openEntity` — a stamp session seeded from a
committed entity's recorded provenance, previewed through the existing worker-v3
stamp-ghost machinery. That machinery snapshots the store **as it stands now** and
evaluates the generator against it. `reconfigureGenerator` does something different: it
rewinds the affected chunks to their pre-span state first, then applies the new span and
replays the culled downstream ops. So for `replace` the two agree in practice (the span
overwrites what it covers), but for `keep-existing-air` — and for any case where later
edits overlapped the entity's footprint — the ghost can show a merge against air/rock
that Apply will not reproduce. The ghost is honest about the new SHAPE; it is not a
promise about the merge. Named in `openEntity`'s TSDoc as a v0 limit, and repeated in
the reconfigure card in `StampInspector.tsx` so the user sees it where it bites.

The fix is worker-side restore: the preview job would have to carry (or reconstruct) the
pre-span images of the affected chunks — i.e. the worker gets the same rewind
`restorePreState` performs, or the host performs the rewind on a scratch store and sends
THAT snapshot. The second is cheaper to build (all the machinery is core-side and pure)
but replays the prefix on the main thread per preview, which is exactly the cost the
worker exists to avoid; snapshots (`captureDueSnapshots`) are the lever that makes it
affordable. That is a real design question, not a patch — hence deferred rather than
bodged.

**Trigger to revisit:** the first time a reconfigure under `keep-existing-air` surprises
someone at a gate, OR when snapshot capture is wired into the editor session (the same
records make the rewind cheap enough to run per preview).

**Reference:** `packages/editor/src/field-host/field-host.ts` (`openEntity`,
`sendPreviewJob`, `snapshotChunks`); `packages/core/src/field/reconfigure.ts`
(`restorePreState` — the two routes and when the culled one is taken);
`packages/core/src/field/snapshots.ts` (`captureDueSnapshots`). Note the sibling v0
divergence already documented on `previewStamp` (a ⌘Z or a stroke mid-session moves the
store under a live preview) — same class of staleness, same eventual fix.

## Segment brush: a BOX cross-section (rectangular corridor sweep)

**Context.** The segment brush shipped in F3b (spec D-F3-14, plan Task 13) sweeps the
brush SPHERE between two clicked points — a `capsule` `BrushShape` in
`packages/core/src/field/ops.ts`, committed as one ordinary brush op with the active
tool's effect (dig → tunnel, fill → rampart). The original ask
(`field-two-point-tunnel-brush.md`, now resolved and deleted) framed it as sweeping
"whatever shape we selected in the tool", i.e. the BOX cross-section too: a rectangular
corridor rather than a round tunnel. That half was explicitly cut from Task 13 as the
first trim, and it is the half with real design questions attached:

- **Orientation.** A swept box needs a roll about the sweep axis that two clicked points
  do not supply. World-up-aligned is the obvious default and is wrong for a vertical
  sweep (the degenerate case the capsule handles by having no orientation at all).
- **Kit lattice discipline.** Kit classes are grid-locked to the 0.5 m lattice and
  `assertOpValid` accepts only an axis-aligned BOX for them — so a swept box is the one
  shape that could plausibly carry a kit class, and only when the sweep is
  axis-aligned AND both endpoints snap. That is a new validation rule, not a reuse.
- **SDF cost.** A capsule's SDF is one clamped projection; an oriented box sweep needs a
  rotation into the box's frame per sample, in the applier's innermost loop.

None of that is hard, but none of it is free, and the round tunnel covers the use case
that motivated the ask ("creating connections in space is difficult").

**Trigger to revisit:** a use of the segment brush that WANTS square corridors — most
likely built-kit masonry passages, where the round capsule cannot carry a kit class at
all. Or the batched UX/polish stage, if the sphere/box brush duality gets revisited
wholesale. (This originally named "the F4 tool-feel round"; F4 turned out to be the
*seeing* phase and the feel work batched into the post-feature polish stage instead.)

**Reference:** F3 spec §3.3 + D-F3-14 (local design spec); `BrushShape` in
`packages/core/src/field/types.ts`; the capsule SDF + `assertOpValid` kit rule in
`packages/core/src/field/ops.ts`; the gesture in
`packages/editor/src/field-host/field-host.ts` (`segmentClick`). Precedent: WorldEdit
`//line` and Axiom's path tools ship both cross-sections.

## The void cast monopolises the one field worker: no cancel, and refusal where coalescing belongs

**Context.** F3b Task 12's X-ray posts ONE job that sweeps every allocated chunk.
`FieldWorkerClient.ensure()` creates a single worker, `mesh()` / `stampPreview()` /
`voidCast()` all post to it, and the handler is synchronous per message — so for the whole
duration of a cast, every chunk remesh and every stamp preview waits behind it. Benchmarked
at the 512-chunk ceiling: ~630 ms (code review, 584 chunks) to ~1.3 s (bun/JSC, 512 dug
chunks). Neither is a hang; both are long enough to feel.

Task 12 shipped the cheap half: `requestVoidCast` refuses while a job is in flight, keyed on
the WORKER being busy (`voidCastJobGen`) rather than on the user still wanting the answer,
because a discard cannot call the worker off — it can only agree to ignore the result. That
stops five toggles from stacking five full sweeps. Two things it does not fix:

- **No cancel.** `invalidateVoidCast` strands a job client-side; the worker grinds on. The
  protocol has no cancel message and the client has no abort.
- **Refusal is not coalescing.** Toggle off then on during a cast and the second request is
  refused with "a void cast is still building — re-tick the void layer once it lands". The
  user's last intent is dropped rather than queued. This file already contains the right
  shape — `createPreviewCoalescer` (latest-wins, at most one queued re-fire) is what the
  stamp preview uses for exactly this problem — and the open question is whether the cast
  should share it or whether a whole-world job wants different semantics from a
  region-sized one.

**The sequence to watch for at the gate,** because it will read as "the editor hitches" and
be hard to attribute: enable the cast on a big world → immediately dig → the stroke lands,
but its remesh queues behind ~1 s of cast work, so the viewport freezes → and when the cast
finally arrives it is thrown away by the very edit that was waiting on it (the stroke
invalidated it). Every part of that is working as designed; the whole is not.

**Trigger to revisit:** the F3b Safari gate reporting viewport hitching while the X-ray is
on, OR the first other whole-world worker job (F4's analyzer is the likely candidate), at
which point "one worker, first come first served" stops being a one-feature problem and
wants a priority or a second worker.

**Reference:** `packages/editor/src/field-host/field-voidcast.ts` (`requestVoidCast`'s
in-flight refusal and the `VOID_CAST_CHUNK_BUDGET` comment carrying the measurement — both
were in `field-host.ts` until foundations T3b1, 2026-08-06);
`packages/editor/src/field-host/field-stamp.ts` (`createPreviewCoalescer`, the shape that
already exists); `packages/editor/src/field-host/field-client.ts` (one worker, no cancel —
the class TSDoc states the contract).

## An entity delete leaves the previous reconfigure's drift report standing

**Context.** `FieldHost.deleteEntity` (F4.5b Task 4) splices an entity's span out and
REPLAYS every downstream op that reaches the affected chunks — the same rewind-and-replay
`applyReconfigure` runs, minus the drift pass. It does not touch the standing drift report.

That leaves the report describing verdicts (`drifted` / `orphaned`) measured against a
store state the delete has since moved. Delete an entity UPSTREAM of a reported op and that
op has now replayed onto a different context again: its recorded verdict is a claim about a
world that no longer exists. `stepHistory` clears the report for exactly this reason
("stale in either direction" — an F3a gate finding), and `loadWorld` clears it too.

Deliberately NOT fixed inline: it is a behavioural decision the task plan did not carry
(the plan enumerates delete's effects precisely and a drift clear is not among them), and
the fix has a second half worth deciding at the same time — a delete's replay could equally
well PRODUCE findings (an `orphaned` downstream op that now writes nothing is precisely
what deleting the masonry it cut into makes), which core's `deleteGeneratorEntity` TSDoc
already names as an additive, non-breaking widening whenever a caller earns it. Clearing
and reporting are the same decision approached from two sides, and picking only the first
would foreclose the second badly.

**Cost of leaving it:** low and self-healing. The stale report survives until the next
apply, history step, dismiss or world load. Its rows still frame real chunks, and F4.5b
Task 4's Δ badges point at it from the rows it intersects — so the visible symptom is a
badge on a row whose named disturbance is one edit out of date, not a wrong action.

**Trigger to revisit:** whoever widens `deleteGeneratorEntity`'s return to carry findings
(core's own TSDoc invites it), OR a gate report of a drift row that outlived the edit it
described.

**Reference:** `packages/editor/src/field-host/field-host.ts` (`deleteEntity`;
`stepHistory`'s clear, which is the precedent, and `applyReconfigureSession`'s
`drift = result.drift.length === 0 ? null : result.drift`);
`packages/core/src/field/reconfigure.ts` (`deleteGeneratorEntity`'s "No drift report" note
naming both findings it gives up).

---

## Folded in at the F4.5 seal (2026-08-03)

Five standalone entries about the field host's own behaviour, moved here because this file is
the register they belong to and they were being read one at a time. Content unchanged; each
keeps its own trigger.

## The translate gizmo draws on frozen and baked entities

**Context.** `field-host.gizmoVisible()` gates the handles on three things: the
`pointer` tool armed, an entity selected, and no session the gizmo did not open.
It does NOT ask whether the selected entity can actually be moved. Selecting a
FROZEN or BAKED entity therefore draws a full translate gizmo on it; pressing a
handle calls `beginMoveSession` → `openEntitySession`, which refuses through
`openBlockedReason` and reports "entity N is frozen — unfreeze it to edit". So it
is a false affordance, not a corruption: nothing moves and the reason is legible.

The fix is a one-line addition to `gizmoVisible` (the record's
`openBlockedReason` must be null), but it is deliberately NOT taken in F4.5b Task
5 because it runs into a question that task does not own: whether a frozen entity
should be SELECTABLE at all. If selection itself were refused the gizmo question
disappears; if selection stays, the emphasis box has the same "you can select it
but not act on it" shape and the two should be answered together.

**Trigger to revisit.** F4.5b Task 8 or 10, whichever settles what a frozen entity
looks like in the palette row and the session card.

**Reference.** `packages/editor/src/field-host/field-host.ts` —
`gizmoVisible`, `beginMoveSession`;
`packages/editor/src/shared/field-entity.ts` — `openBlockedReason`.

---

## Log-signature caches can miss a world swap

**Context.** `FieldHost` memoizes derived state on a *signature* built from the op log's
own numbers. `currentLogStats` (`packages/editor/src/field-host/field-stats.ts` since
foundations T3b1, 2026-08-06; `field-host.ts` before that — the op-cost meter's cache) uses
`(ops.length, undoStack.length, redoStack.length)`. A world
swap goes through `resetWorld`, which empties `log.ops` and both stacks and resets
`log.nextId` — so two worlds whose logs agree on those numbers produce the SAME signature,
and the incoming world reads the outgoing world's cached values.

Found 2026-07-31 during F4.5b Task 3 review, on the sibling cache: the entity-footprint
memo showed world A's boxes after loading world B (reproduced — two 2-op worlds with ids
1 and 2 sign identically; a click on empty space in world B re-selected world A's entity
and drew its box where nothing was). **That one is FIXED** — its signature now leads with
`worldEpoch`, the counter `resetWorld` already bumps for the analyzer, and
`tests/field-host-pointer.gpu.test.ts` pins it.

`currentLogStats` has the same shape of exposure and was left alone as out of scope. Its
consequence is milder — a stale op-cost READOUT (totalOps / undo depth / compactable) for
one frame — because it is recomputed every WATCHED rAF and the next tick after any log
mutation corrects it. It is only wrong in the window where the two worlds' three lengths
agree AND nothing has mutated the new log yet, which for a freshly loaded world with the
status bar mounted is the frame right after the load.

**T3b1 widened that window on an UNWATCHED host — in LIKELIHOOD, not in duration.** The
extraction moved the recompute inside the stats publish guard, so a host with no
`subscribeStats` subscriber does not scan the log at all (the point: an O(ops) scan per rAF
for a payload nobody receives). The mutations that can alias the signature now have that
whole span to net in rather than a single frame. What did NOT change is how long an alias
lasts once entered: nothing re-signs on a match — the trackers advance only inside the
recompute branch — so a stale reading is carried by every subsequent publish until a length
genuinely differs, under the old shape exactly as much as the new one. The paragraph above
saying it "corrects on the next tick" is loose in the same way: it corrects on the next tick
whose signature MOVED.

Two facts bound the whole thing, and both were missed on the first pass. Only
`liveGenerators` and `compactableOps` can be wrong — `totalOps`, `undoDepth` and `redoDepth`
ARE the three signature lengths, so a matched signature makes them correct by construction.
And in production the unwatched span is still effectively empty of editing — **but the
mechanism this entry first gave for that was falsified three commits later, inside the same
slice.** T3b1 Task 3 wrote "the chrome subscribes in a provider-level effect keyed
`[engineReady, host]`, not per status-bar mount"; T3b1 Task 7 then replaced that fan-out with
per-consumer `useSyncExternalStore` latches, and no such effect exists at HEAD. What is true
now: THREE surfaces read stats — `packages/editor/src/frontend/components/shell/StatusBar.tsx`,
`packages/editor/src/frontend/hooks/useActionContext.tsx` and
`packages/editor/src/frontend/hooks/useWorld.tsx` — and the last two are session-lifetime
providers mounted at the shell root (`components/shell/Shell.tsx`), so an unwatched production
host still exists only before `engineReady` and after chrome teardown. That conclusion now
holds by ACCIDENT rather than by design: it rests on two unrelated providers happening to
destructure `stats`, which is exactly the "correct-if-the-author-remembered" failure mode the
*Worth considering instead* paragraph below argues against. None of this changes the fix; it
is one more reason to prefer the explicit-signal option to a second hand-rolled signature.

**The fix, when it is worth doing:** the same one token — put `worldEpoch` at the front of
the `currentLogStats` signature. Cheap; not done at the time only because the task's
boundary was the pick, and not done at T3b1 either because that task's boundary was the
extraction and a signature change is a behaviour change. `worldEpoch` is a host `let` and
`field-stats.ts` does not read it today, so the fix now also costs one thunk on
`StatsMeterDeps`.

**Worth considering instead:** both caches invalidating on an explicit signal rather than
each inventing a signature. `resetWorld` is the ONE place a world goes away; a
`cacheEpoch`-style bump read by every memo in the host would make a new cache correct by
default rather than correct-if-the-author-remembered. Two hand-rolled signatures is the
point at which that starts paying.

**Trigger to revisit:** a third log-signature cache being added; the first report of a
stale meter reading after a world load; or **any of the three stats readers above dropping
its `useFieldHostState()` call** — that is now the event that turns the widened unwatched
window from theoretical into a real production editing span.

**Reference:** `packages/editor/src/field-host/field-stats.ts` (`currentLogStats` and the
module header's note on the widened window); `packages/editor/src/field-host/field-host.ts`
(`entityFootprints`, the fixed version + its comment);
`packages/editor/tests/field-host-pointer.gpu.test.ts` (the world-swap case).

---

## A live stamp session survives a ⌘Z / ⇧⌘Z step

**Context.** `field-host.stepHistory` refreshes everything a history step can move
— the dirtied chunks, the prop layer, the entity list, the entity selection — but
does not touch the live `stamp` session. A plain reconfigure session (opened by
the Entities row's Open button, or by `openEntity`) therefore outlives a step
that rewrote the log underneath it. Two shapes:

- The step UNDOES the commit the session's entity came from. The session now names
  an entity that is not in the log; Apply fails with core's
  `reconfigureGenerator: unknown entity N` and the session keeps standing.
- The step undoes an earlier RECONFIGURE of a surviving entity. Nothing fails —
  the session simply describes params/region relative to a record the step has
  already replaced, and Apply quietly re-lands an edit the user just undid.

F4.5b Task 5 fixed the MOVE case only (`if (stamp?.moving === true)
cancelStampSession()` in `stepHistory`), because a move is cursor-driven and the
canvas that binds ⌘Z is necessarily focused during one — so it was reachable in a
single keypress and inside that task's scope. The plain-reconfigure exposure is
older and wider.

The blanket case is already argued twice in this file: `resetWorld` and
`setMaterialTable` both cancel outright, on the reasoning that a session whose
inputs moved must not be left offering an Apply that would build something the
ghost never showed. A history step is the same class of event.

**Trigger to revisit.** The next task that touches `stepHistory` or the session
lifecycle — F4.5b Task 8/10 (session card + strip) would surface it, since the
card is what leaves an enabled Apply on screen.

**Reference.** `packages/editor/src/field-host/field-host.ts` — `stepHistory`,
`resetWorld`, `setMaterialTable`. Tests for the move half:
`packages/editor/tests/field-host-move.test.ts`.

---

## A `G` grab moved by the ARROW keys reads as idle, and ⏎ discards it

**Context.** `dropMove()` (`packages/editor/src/field-host/field-host.ts`) ends a live
move by asking `moveIsIdle(d)` (`field-host/field-move.ts`) whether the move handed the
region anything — and `moveIsIdle` reads the DRAG's accumulated lattice steps
(`d.applied`), i.e. how far the CURSOR travelled. A grab is not only driven by the cursor:
the arrow pad (`nudgeStampRegion`) and the stamp inspector's d-pad move the same session's
region without touching `d.applied`. So the sequence

> select a stamp → `G` → ← ← ← → ⏎

leaves `d.applied === [0,0,0]`, `moveIsIdle` answers true, and `dropMove` calls
`cancelStampSession()` — the region the user just moved three steps is thrown away with no
message. The same three steps committed fine before `G` was pressed (a plain reconfigure
session's ⏎ routes to `commitActiveSession`), which is what makes it surprising rather than
merely strict.

Reproduced during F4.5b Task 7, not by reading: routing the public `commitSession()`
through the same path turned `tests/field-host-move.test.ts`'s *"a move commits through the
reconfigure splice"* red at `Expected: 2, Received: 0` — a `nudgeStamp(4, 0, -2)` on a
`beginMove` session, discarded on confirm. Task 7 therefore did NOT route the public verb
through `dropMove`; the canvas ⏎ keeps it, so the defect stays where it already was rather
than spreading to three entry points.

**The shape of the fix.** The zero-step rule is right — a twitchy click should not spend a
history entry — but it is asking the wrong question. What it wants to know is whether the
SESSION's region differs from the entity's RECORDED region, which `dropMove` can answer
directly (`entityRecord(stamp.entityId)` is one call away, and the comparison is six
numbers). That also makes it correct for the mixed case (drag two steps, arrow back two),
which the current test cannot express at all. `moveIsIdle` then either goes away or becomes
a region comparator rather than a drag one.

**Trigger to revisit.** The next task that touches `dropMove` or the move session's
terminal verbs — Task 10's session card is the likely one, since its Apply button is a
third entry point into exactly this decision and would inherit the same discard.

**Reference.** `packages/editor/src/field-host/field-move.ts` (`moveIsIdle`),
`field-host.ts` (`dropMove`, `confirmActiveSession`), `tests/field-host-move.test.ts`.

---

## The stamp seam pushes fresh identities per frame, so no consumer memo can hold

**Context.** `FieldHost.subscribeStamp` publishes `structuredClone(stamp)` on every
`notifyStamp` — every param edit, every region nudge, every phase transition, at pointer
rate while a move drag runs. So `session.params` is a NEW object identity on every push even
when nothing in it changed, and every downstream memo keyed on that identity recomputes.

The concrete cost measured in F4.5b Task 10, through the real Shell + stub host, 20 distinct
session pushes, counting `SchemaForm` renders:

| | no `formValues` memo | with it |
|---|---|---|
| host clones params (production today) | 40 | **40** |
| params identity held stable (counterfactual) | 40 | **21** |

`SchemaForm` re-seeds its drafts whenever `values` is a new array, and that re-seed is a
state write during render — hence two renders per push, each rebuilding every field row. The
card's own `useMemo` is correct and is the half that belongs in the component; it simply
cannot reach the cause. The same shape will bite every future consumer of this seam.

**What the fix is not.** Not "stop cloning": the clone is what keeps the chrome from holding
host state, which is a rule worth more than the renders.

**The options**, all of which need a decision rather than an edit:
(a) a value-equality guard in `useFieldHostState`'s stamp mirror (the `sameEntities`
precedent — since foundations T3b1 the mirror is `latchStamp`, whose `adopt` callback is
literally `prev => …`, so the guard now spells `latch(prev => sameSession(prev, s) ? prev : s)`
and `latchStats` beside it is a second in-file precedent for exactly this shape), which needs a definition of
"same session" that is honest about `run`, `phase` and `region`;
(b) a narrower guard on `params` alone, since that is the field whose identity drives the
form — cheaper, and it leaves phase/region churn re-rendering the card as it should;
(c) push a stable `params` from the host by cloning only when the params actually change.

(b) looks cheapest and most targeted, but the comparison depth is the real question — the
entity comparator next door compares through `formatParam` because what must not go stale is
the STRING on screen, and the same argument may or may not apply to a live form.

**STATUS 2026-07-31 (F4.5b Task 11 — trigger fired, still NOT acted on).** Task 11 did land
in `SessionCard.tsx` and did upgrade the renderers (bounded numbers became a range + a
scrubby label + an exact input; small enums became segmented controls), so the premise above
— "which makes each of those 40 renders more expensive" — was due for a measurement. It was
taken, and it does not support acting:

| card form (4 params) | 20 session pushes | DOM nodes in the card |
|---|---|---|
| 4 plain `NumberField`s | 19.0 / 23.0 / 20.1 ms | 47 |
| slider + stepper + slider + segmented | 18.4 / 23.0 / 21.8 ms | 55 |

Three runs each through the real Shell + stub host, with a warmup mount before both (the
FIRST measurement pair was confounded: whichever form ran first looked ~30% slower, which
is module init and JIT, not the form). The two are indistinguishable at ~1 ms per push, and
the +17% DOM is not where the cost is — the re-seed-during-render is. So the extra renderers
did NOT raise the stake; the entry stands on its original argument, unchanged.

Two honest limits on that number: it is happy-dom, not a browser (no layout, no paint), and
it is a FOUR-param form. A scatter's ten params under a pointer-rate move drag is the case
that would actually hurt, and it is still unmeasured.

**Trigger to revisit:** a MEASURED render cost on a real browser under a pointer-rate drag
(a move, not a click), or a second consumer of `subscribeStamp`. The "a task upgrades the
renderers" half of this trigger has now fired once and paid nothing — do not re-fire it.

**Reference:** `packages/editor/src/field-host/field-host.ts` (`notifyStamp` /
`subscribeStamp`), `packages/editor/src/frontend/hooks/useFieldHostState.tsx` (the stamp
mirror, and `sameEntities` beside it as the precedent), `packages/editor/src/frontend/
inspector/SchemaForm.tsx` (the `seed.current !== values` re-seed),
`packages/editor/src/frontend/components/shell/SessionCard.tsx` (`formValues`).

---
