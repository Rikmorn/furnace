# The F4.5 capability sweep's deferred column

The F4.5 charter's capability sweep (2026-07-29) adjudicated every editor capability the
category offers into three columns: **adopt** (built, and now `docs/reference/editor-architecture.md`
§16–§18), **ignore** (doesn't fit this editor — free-rotate gizmo, non-linear history,
drag-drop import until glTF, screenshot/turntable, number-row tool bindings, double-tap
modifier chords), and **backlog** — this file. Filed as one register rather than as fourteen
one-paragraph files: they were adjudicated together, in one sitting, against one another, and
splitting them would lose that (and would bury the directory). Each carries its own trigger,
and an item leaves this file the moment it is taken — delete its section, don't tick it.

Two members of the charter's backlog column are NOT here, deliberately:

- **cavity / AO / matcap shading** was the FALLBACK for premise P5 ("studio lighting reads on
  dig-heavy terrain"). P5 **passed** at the F4.5 holistic gate, so its stop condition never
  fired and the entry was never filed. **Its trigger still stands:** if studio shading ever
  reads flat on dig-heavy terrain, this is the answer to reach for.
- **scene-chrome-as-consumer-surface** had its own entry and was a bigger question than a
  capability. **It is now closed by deletion (2026-08-05, foundations T2):** the daemon's
  `scene.*` half and `@furnace/core/scene` were deleted, so there is no parked capability and
  no scene document to author. See `docs/reference/editor-architecture.md` §19.

**Absorbed at T5 (2026-08-11):** *The void cast's budget refusal and its inside-the-cavity
read have never been walked*, last section. The void cast is one of this sweep's own
capabilities; the unwalked half belongs in the same register as the deferred column.

---

## Footprint resize handles

The translate gizmo moves a committed entity's region; nothing resizes one in the viewport.
Today a region's SIZE is changed by editing the generator's params in the session card (a
hall's width/height/depth, a cave's radius), which is honest — the params are what actually
determine the shape, and a drag handle would have to map a box edge back onto whichever param
governs that axis, per generator.

**Trigger:** a generator whose size params are not obviously mappable to a box (or the second
time someone reaches for a corner and finds nothing there). Take it with the gizmo, not before
— `field-host/gizmo.ts` already owns handle picking and `field-move.ts` the anchored
arithmetic, and a resize is a third gesture through the same arbitration.

## Multi-select entities

`FieldHost.selectEntity` takes one id or `null`, and `subscribeEntitySelection` publishes one.
That is deliberate and load-bearing at this size: one selection means the palette row, the
viewport box, the session card's REST subject and the status strip's readout cannot disagree.
Multi-select would need a selection SET, a rule for what the session card shows over a
heterogeneous set (the inspector module already handles N targets and `isMixed` — that half
exists), and a decision about what delete/duplicate/move do to a set.

**Trigger:** a workflow that repeats the same edit across several stamps — most likely the
first time a world has enough entities that one-at-a-time is the bottleneck.

## Hover pre-highlight

Explicitly ruled out by the pick architecture rather than merely unbuilt. The field pick is a
**CPU ray cast**, which is affordable per CLICK and not per pointermove, so selection is
click-driven and nothing highlights under the cursor.

The CPU choice had two reasons and now has one. **The sample-count blocker is GONE** — the
host used to acquire its context at `sampleCount: 4` and core's `frame.renderToTexture`
throws on anything but 1, so an id pass could not be rendered at all; foundations T4c removed
MSAA from the editor and the context is now `sampleCount: 1`. What survives is that the two
things most worth picking (entity footprints, gizmo handles) have **no meshes at all**, so an
id pass would have to invent geometry for both before it beat the ray test.

**Trigger: a GPU pick path exists.** Half of what that once meant has happened. The remaining
half is id materials (or id geometry) for the mesh-less candidate kinds — which T4c's capture
work does NOT produce, since it draws the viewport's own pipelines rather than an id pass.
Until then this is still a consequence rather than a deferral, on one reason instead of two.

## Camera bookmarks

The camera has `F` (frame selection), `view.frameWorld`, the six axis snap views, and
click-to-frame from a flag row or a drift finding. What it has no concept of is a REMEMBERED
pose. Nothing persists a camera anywhere — per-world camera persistence was explicitly
declined at the F4.5 gate when `frameWorld` was ruled, so this would be the first thing to
introduce it.

**Trigger:** a world big enough that returning to a place costs real time. That is F5's
territory, and this should be decided there rather than filed forward blind.

## In-editor walk mode

Today the loop is bake → run the game → walk. It works and it is the loop the F4.5 gate
passed on. An in-editor walk would need the consumer's mover driven against the editor's live
field — which the walkability advisor's **stage 2 already does** at one finding under a time
budget, through the project's own `/engine.js`. So the mechanism precedent exists; what is
missing is the mode (input capture, a camera the host does not own, an exit).

**Trigger:** the bake-and-launch round trip becoming the thing that slows a session down —
measure it before building, because the bake is fast today.

## Select all / invert selection, and grow / shrink selection

Cell-selection set operations. The store holds a selection as chunk-keyed bitsets and
`SELECTION_UI_BUDGET` (200 000 cells) already bounds a flood, so "invert" and "grow by one
cell" are both well-defined and both budget-bounded — the question is where they live (the
selection chip's popover holds Clear and Reselect today) and whether they are worth the
surface.

**Trigger:** a masking workflow that a flood plus a box cannot express. Wants taking together
with `editor-M5B-viewport-interaction.md` §"A box selection is two clicks, not a press-drag-release" — all of it is one conversation about what
selection is for.

## Spring-loaded tools

Hold a key to arm a tool, release to go back — the pattern the momentary ⇧ (smooth) and ⌃
(dig↔fill invert) modifiers already implement for two specific effects. Generalising it to the
whole tool rail is the item.

**Trigger:** a third momentary override being wanted. Note the release semantics are already
subtle: `deriveMomentary` assigns the saved tool WHOLESALE on release, which is exactly why the
brush radius had to be moved out of `FieldTool` — a generalisation has to keep that distinction.

## Repeat last

No "do that again" verb. The action registry (`lib/actions.ts`) is the natural home — it knows
what ran — but "the last action" is ambiguous in an editor whose ops are strokes: repeating a
dig stroke means nothing without a position.

**Trigger:** a repeated PARAMETERISED verb worth repeating — a stamp with the same params at a
new region is the plausible one, and that is really "duplicate, then move", which exists.

## Autosave / crash recovery

**The field world lives in the host until the user saves it.** There is no daemon-side copy,
so a browser crash loses everything since the last `⌘S`. The `dirty` bit exists and the op log
is serialisable (`oplog.json` is already part of a saved world), so a periodic write of the
op log to a scratch path is a small mechanism — what makes it a decision is the recovery UX
(offer it? on what evidence that a crash happened? whose world does it belong to?).

**Trigger: the first lost session.** The user's own ruling — "not that big a deal… fine to
backlog".

## New from template

`world.new` starts empty. A template would be a starting world (a room, a corridor stub) —
which is `world.duplicate` from a world you keep for the purpose, so the capability half is
already there and what is missing is only the affordance.

**Trigger:** the user keeping a world around purely to duplicate it. That is the signal the
affordance is owed.

## Mirror / symmetry

No symmetry plane; every edit is what the brush touches. This is a substantial feature (a
plane, a mirrored op for every op kind, and a decision about what mirroring does to placements
and to committed generator entities), and it is the kind of thing that has to be designed into
the op log rather than added over it.

**Trigger:** authoring something whose symmetry is load-bearing — a built structure rather
than a cave. Decide it as a design question, not as a feature request.

## Game-view consumer extension (D-18)

The charter CUT a game view from F4.5 and recorded the ownership doctrine instead: a future
consumer-provided view extension, declared through the engine seam — **headlamp is a
player-entity concept, fog is a region/world concept, and the editor hosts them rather than
hardcoding them**. That doctrine is what closes the standing fog/headlamp question (the old
cockpit gate's finding ④): they were surfaced as editor view-flags, which conflated "debug
visualization" with "scene data you are authoring", and the answer is that they are neither —
they are the consumer's, and the editor should be able to host a view the consumer declares.

**Trigger:** the editor-extensions seam contract being worked (F5+). Today that seam has ONE
consumer — the analyzer worker's `analyzerVerify` — and this is the second one that would
justify formalising it.

## Per-prop editing

A placement record is not an independently editable object: a prop click selects the entity
that PLACED it, and the scatter's params are what a user changes. That is a deliberate model
(props are the output of a recipe, not hand-placed objects), and per-prop editing would break
it — a hand-moved prop is no longer reproducible from the recipe, so the op log would need a
per-record override concept.

**Trigger:** wanting one prop somewhere the scatter will not put it. Consider first whether a
second, tiny scatter answers it, which is the in-model solution.

---

**Reference:** the F4.5 charter's §7 capability sweep (the adjudication this file is the
backlog column of), `docs/reference/editor-architecture.md` §16–§18 for everything in the
adopt column, and `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md` for the
stage that produced both.


## The void cast's budget refusal and its inside-the-cavity read have never been walked

Two questions about the X-ray view mode that only a gate can answer, and that no gate has:

**(a) the 512-chunk budget.** A world over `VOID_CAST_CHUNK_BUDGET` refuses, and since the
F3b fix round the refusal SAYS so rather than being silent. What nobody has done is hit it on
a real world and decide the follow-up: does the budget rise, or does the cast scope to the
current selection? The measurement behind 512 is `~630 ms–1.3 s` of worker time at that
ceiling depending on fill, on **bun/JSC** — and browser V8 is not JSC, so the number wants
re-measuring in the browser before it is moved either way.

**(b) the inside-the-cavity read.** The cast is designed for outside-looking-in:
`compare: "always"` makes it dominate every opaque surface, which is exactly the case the
tool exists for. From INSIDE a carved space the read is expected to be much weaker. If
inside-view turns out to matter, that is a render-design item (a second material, a
depth-aware variant) and not a toggle bug.

### Context

Both were filed as F3b gate round-2 watch items and never got their round 2: F3b sealed with
the void cast's pixels visually UNCONFIRMED (an accepted gate variance — round 1 predated the
visible-refusal fix, so the user could not distinguish refusal from silence), and the F4.5
holistic gate's script walks sculpting, stamps, props, flags and the bake-and-walk spine but
does not touch the X-ray at all. So the cast remains **the one field overlay whose render
nothing has ever checked**. The template for checking it exists — the advisor's marker layer
is pixel-confirmed by a committed, re-runnable recipe at
`packages/editor/scripts/analyzer-pixel-check.md`.

A third, related gap is filed separately and is a design question rather than an observation:
the cast monopolises the one field worker, has no cancel, and drops a toggle-off-then-on
instead of coalescing (`field-tool-follow-ons.md` § *The void cast monopolises the one field
worker*).

### Trigger to revisit

**Either** a world large enough to trip the 512-chunk budget in normal use (F5's scale work
is the obvious candidate), **or** the first time somebody reaches for the X-ray while inside
a cavity and it does not answer. Cheap to take opportunistically: both are observations on an
existing build, not work.

### Reference

- `packages/editor/src/field-host/field-voidcast.ts` — `requestVoidCast`,
  `VOID_CAST_CHUNK_BUDGET`, the four refusals, `voidCastGen` / `voidCastJobGen`. (All of it
  lived in `field-host.ts` until foundations T3b1, 2026-08-06.)
- `packages/editor/scripts/analyzer-pixel-check.md` — the pixel-check recipe to copy.
- `docs/reference/editor-architecture.md` §14 (the void cast, its refusals and its lifetime).
- `docs/learnings/2026-07-21-invisible-line-overlays.md` — why "it is drawn" is not a claim to
  make from a green test suite.
