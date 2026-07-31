# Field tool follow-ons — props, stamp sessions, the segment brush, the void cast

Tracker for the field-editor tool items deferred out of F2b/F3a/F3b: each is a known
gap, cost, or divergence in the field tools that was filed rather than fixed because it
needed a design call, a measurement, or a scope the shipping task did not have. They are
merged so there is **one place to check whenever you touch
`packages/editor/src/viewport-host/field-host.ts`, `field-placements.ts`, or
`packages/core/src/field/{ops,kit-render,reconfigure}.ts`**. Nothing here blocks; every
section keeps its own trigger. Sections keep their original content.

**Not in here:** the gate-UX finding SETS (`field-f2b-gate-ux-findings.md`,
`field-f3a-gate-ux-findings.md`, `field-f3b-gate-ux-findings.md`) stay as separate files —
they are the post-feature polish stage's charter inputs.

## Editor props render as collision PROXIES, not the archetype's actual meshes

**Context.** F3b Task 10 gave the field editor its placed-prop layer: after a scatter
commits, `FieldHost` rebuilds one instanced draw per archetype from the op log's
`PlacementOp` records (`rebuildProps` → `groupPlacements` → `packPlacementMatrices`). What
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

**Reference:** `packages/editor/src/viewport-host/field-placements.ts` (the proxy
mapping + the shading constraint); `packages/editor/src/viewport-host/field-host.ts`
(`rebuildProps`, `proxyGeometry`); `packages/editor/src/frontend/lib/catalog.ts`
(`parseEntityCatalog` — deliberately does not carry the catalog's `meshes` paths);
`packages/dungeon/src/field-world.ts` (`buildArchetypeGroups` — the mesh-accurate loader
this would converge on); `docs/reference/dungeon-architecture.md` (the placement artifact).

## The placement sizing convention is implemented twice, with nothing pinning the two together

**Context.** One rule — "how big is a placed prop, given its archetype's collision
primitive and its record's per-axis scale" — has two independent implementations:

- `proxyScale` / `proxyExtents` in `packages/editor/src/viewport-host/field-placements.ts`
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

**Reference:** `packages/editor/src/viewport-host/field-placements.ts` (`proxyExtents`,
`proxyScale` — and their TSDoc, which names the dungeon as the authority);
`packages/dungeon/src/field-world.ts` (`placementCollider`);
`packages/core/src/field/kit-render.ts` (`packPlacementMatrices` — where the promoted
version would live, and the precedent for promoting);
`packages/editor/tests/catalog.test.ts` (the cross-package coupling-test precedent: it
parses the catalog the dungeon actually ships).

## The editor's prop layer rebuilds unconditionally, and re-creates proxy geometry every time

**Context.** `rebuildProps` in `packages/editor/src/viewport-host/field-host.ts` tears the
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

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`rebuildProps`,
`proxyGeometry`, `destroyProps`, and the seven call sites);
`packages/editor/src/viewport-host/field-placements.ts` (`groupPlacements` — the grouping a
signature would be taken over; `PROXY_PRIMITIVE` — the three-primitive ceiling);
the *Placed props ignore the slice plane* section below (the sibling that would
make this a hot path).

## Placed props ignore the slice plane — they draw full-height over a sliced field

**Context.** F3b Task 10 added the editor's committed prop layer (`rebuildProps` in
`packages/editor/src/viewport-host/field-host.ts`), gated by the `props` layer flag alone.
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

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`renderScene`'s `props`
gate; `setSlice`; `applyStampGhost`'s existing full-height note);
`packages/editor/src/frontend/lib/field-protocol.ts` (`sliceAprons` — how the field is
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

**Reference:** `packages/editor/src/viewport-host/field-placements.ts`
(`seedArchetypeParams`, `withArchetypeOptions`);
`packages/editor/src/viewport-host/field-host.ts` (`startStamp` — the seeding call site
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

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`openEntity`,
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
`packages/editor/src/viewport-host/field-host.ts` (`segmentClick`). Precedent: WorldEdit
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

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`requestVoidCast`'s
in-flight refusal and the `VOID_CAST_CHUNK_BUDGET` comment carrying the measurement;
`createPreviewCoalescer` for the shape that already exists);
`packages/editor/src/frontend/lib/field-client.ts` (one worker, no cancel — the class TSDoc
states the contract).

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

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`deleteEntity`;
`stepHistory`'s clear, which is the precedent, and `applyReconfigureSession`'s
`drift = result.drift.length === 0 ? null : result.drift`);
`packages/core/src/field/reconfigure.ts` (`deleteGeneratorEntity`'s "No drift report" note
naming both findings it gives up).
