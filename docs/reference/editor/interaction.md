---
summary: What LMB and Esc do — the gesture machine, the CPU pick arbitration, the recency-ordered Esc capture stack, and the canonical-setter law that keeps the two honest.
verified: 2026-08-18
---

# Interaction

The viewport's interactive middle is **one module, because it is one state machine**:
`packages/editor/src/field-host/field-machine.ts`. It owns the stamp session, the move session
and the armed gesture, and it arbitrates the pointer chains.

The three clusters are one machine and not three: the move session IS a stamp session with a
`moving` flag, so any boundary drawn between them cuts a state machine in half; and the armed
gesture and the pending-stamp arm above it are the other half of the same click, because an arm
SHADOWS the armed gesture rather than replacing it, and the two must be read together to know
what LMB does.

It is a **factory returning an object** rather than a set of free functions, because free
functions would have to be handed the memory on every call. That is the difference from its pure
siblings (`field-stamp.ts`, `field-move.ts`, `field-ghost.ts`): those are transitions and
arithmetic over data handed in, and they were extractable precisely because they remember
nothing. **This is the memory.**

Derive its two widths — the widest deps record and the widest seam in the directory
([field-host](field-host.md)):

```sh
awk '/^export type MachineDeps = {/,/^};/'  packages/editor/src/field-host/field-machine.ts | grep -cE '^  [a-zA-Z]'
awk '/^export type FieldMachine = {/,/^};/' packages/editor/src/field-host/field-machine.ts | grep -cE '^  [a-zA-Z]'
```

Every cross-cluster dependency arrives in the deps record, and the reassignable ones arrive as
FUNCTIONS rather than as values. Two members are `let`s in the host, and either one snapshotted
at construction would give the module a private copy the host's own writes never reach: a stamp
opened after a catalog swap would seed from a catalog the project no longer has, and the stamp
arm would open region-draw over a selection the user made an hour ago.

## Two things the machine deliberately does NOT own

Both were decided by re-reading the as-built rather than by the shape of the name.

- **The box anchor and its two overlay batches.** By name the anchor is gesture state. By EDGES
  it is the selection cluster's, owned jointly with the anchor batch, the preview batch and the
  selection click. Taking it would have dragged the whole box-select overlay across the line for
  the sake of two calls, so the two calls arrive as deps instead.
- **The tool-op commit.** It is a BRUSH verb wearing a commit's name: it applies one op with the
  active tool's mask and pushes the history feed. The two verbs that DID move are the session's
  terminal pair, and they moved because leaving them behind would have meant promoting five
  private-state verbs to public surface purely to serve two callers — the opposite of what "owns
  its state privately" means.

## Esc is a capture stack, not a ladder

`packages/editor/src/field-host/input-router.ts` holds a stack of captures.

**A gesture or a selection ACQUIRES a capture when its state goes live and RELEASES it in the
same canonical setter that clears the state**, so membership IS liveness: the stack cannot hold
an entry for a state that is gone, and Esc cannot miss one that is standing.

Esc cancels the TOP and **returns whether it acted** — the claimed-event contract the canvas
branch reads to decide whether to `stopPropagation`, and the reason a press with nothing
captured still travels on to the app-level action registry
([action-registry](action-registry.md)). It is also what makes the agent door's interrupt verb
able to refuse ([agent-door](agent-door.md)).

Six states can be captured: a half-drawn box anchor, the segment anchor, the pending stamp arm,
the live session (a move included), the selected entity, and the cell selection — which is PARKED
in the Reselect slot, so an Esc that went one press too far has the same way back a Clear does.

### The canonical-setter law

**Every mutation of a captured state must go through its setter.** A bare assignment that skips
the reconcile leaves a capture behind, and the next Esc spends itself cancelling something that
already ended.

`createRung` (exported from `input-router.ts`) owns the discipline rather than N copies of it:
acquire on the first live read, release on the first dead one, and do NOTHING while it stays
live — which is what makes a REPLACE (a selection displacing another, an entity pick displacing
another) keep the position its first acquisition took. `cancel` runs AFTER the entry is removed,
so a cancel that re-acquires (an arm whose drawn corner is cancelled goes back to asking for a
region) pushes a fresh entry at the top rather than resurrecting the one the press just spent.

**Seven rungs stand on that one implementation, across four modules, and none of them is in the
facade.** Derive:

```sh
grep -rn "= createRung(" packages/editor/src/field-host/
```

The facade's own comment names that command and records that nothing in `field-host.ts` calls it
any more — the box anchor and the cell selection ride the selection cluster, the selected entity
rides the entities cluster, the session / stamp arm / pending move ride the machine, and the
segment anchor rides the segment brush.

### The crossing rule is computed, not commented

The machine's central slot once had thirteen write sites and no setter, and its Esc reconcile was
a hand-maintained list of which writes crossed null↔non-null, kept as a comment. **Nothing failed
when a fourteenth write was added and the comment was not.**

`setStamp` is that setter. All thirteen writes route through it; it computes
`crossed = (stamp === null) !== (next === null)` and reconciles only then, so the structure
answers what the comment used to assert.

The distinction the comment was maintaining is real and survives: **a crossing write reconciles
the capture, a live→live transform does not** — because a reconcile at a transform would be a
no-op with a cost and, worse, would imply that a slider drag re-acquires and moves the session's
stack position every time a param changed.

`setPendingMove` is the same law one slot over. The sub-threshold press — a press on the
already-selected entity, waiting to see whether the cursor travels far enough to mean "move" —
held no capture, so Esc fell straight past it to the selection the user was pressing on. It has a
rung of its own now. **There is no pointer-capture release on that rung, and the omission is
verified rather than overlooked:** the branch that arms it does not capture — capture is taken at
the threshold crossing, in the same breath that clears the slot — so a release would be a line
that could only ever throw on a stale id.

One deliberate bare write remains, the move-drag half of the slot the session shares with it, and
it reconciles in the same breath rather than being rewritten to use a setter. Two more writes are
deliberate for the same class of reason: a world reset clears the selection directly (routing it
through the setter would PARK the outgoing selection in the Reselect slot, and a Reselect across
a world swap restores cells describing a field that is gone), and the reselect swap does the same
from the other side.

### Recency replaced a declared priority

The old ladder's order was fixed, but every rung's own comment argued from recency (*"an arm is
by definition more recent than any session still standing beside it"*), and the fixed order held
only because the common flows happen to acquire in that order.

Making it structural costs the cases where the two disagree, and there are **exactly three
reachable ones** — two independent states that can be acquired in either order:

| Both live | The old ladder cancelled | The stack cancels |
| --- | --- | --- |
| an entity picked, THEN a cell selection drawn | the entity | the selection |
| a session live, THEN a cell selection drawn | the session | the selection |
| a session live, THEN an entity picked | the session | the entity |

The common flow is unchanged: draw a region, then pick something in it, and Esc still takes the
pick first — in that order recency and the ladder agree. **In all three rows above the stack is
the one obeying the ladder's own stated principle.**

All three are pinned by `packages/editor/tests/field-host-escape.gpu.test.ts` — the "recency, not
a fixed order" pin plus the two divergence rows beside it. The router's unit tests pin the stack;
that suite pins that the HOST still wires every state to it, with the scenarios the old rung
comments argued from.

**`escape()`'s "capture" means THIS stack's, not the DOM's.** The two words had been sitting one
file apart meaning different things, and the router's header says which it means.

## The machine arbitrates the pointer; the host attaches and steps aside

The four pointer listeners' CHAINS live in the machine; the four functions in the facade are one-
and two-line delegates.

**The rule that drew the line is stated where the chain is: most of what those branches TEST is
state the machine owns and nothing else does** — a live move, a pending stamp arm, the armed
gesture, a stroke in progress — so the chain follows the state, while every branch's VERB stayed
with its cluster and arrives as a dep. Exactly three branch tests are NOT the machine's — the
camera's look state, the selection's box anchor, and the segment anchor — and they travel the
other way, as liveness thunks.

What stayed on the facade is [field-host](field-host.md)'s: the DOM listeners themselves, the
keyboard three, the wheel, and DOM pointer capture as a function pair. **A module with no canvas
cannot own `setPointerCapture`** — what the machine took is the ARBITRATION, not the element
handling.

## The pick — CPU, per click, and tiered

`packages/editor/src/field-host/field-pick.ts` is the arbitration, and it is **pure and
GPU-free** — the `field-ghost.ts` / `field-placements.ts` sibling. `field-picking.ts` is the seam
that drives it.

CPU rather than a GPU id pass, and that is a decision with reasons rather than a fallback. **It
had two reasons and now has one**, which is worth stating rather than quietly restating the
survivor: the host used to acquire its context multisampled and core's render-to-texture throws
on a multisampled context, so an id pass could not even be RENDERED here — **MSAA was removed from
the editor and that blocker is gone.**

What still stands is the reason that was never about the context: **the two things most worth
picking — entity footprints and gizmo handles — have no meshes at all** (a line batch and pure
math respectively), so an id pass would have to invent geometry for both before it could beat a
ray test that already resolves them.

**The consequence is written into the design rather than tolerated: a CPU pick is affordable per
CLICK, not per pointermove, so there is no hover pre-highlight anywhere in the editor.** Selection
is click-driven.

### The arbitration rules

- **Three candidate kinds**, and `PICK_TIER` is a total `Record<PickCandidate["kind"], PickTier>`
  rather than a predicate, so adding a kind without classifying it does not compile. `prop` and
  `flag` resolve in the **object** tier; `entity` in the **volume** tier, and **objects are
  resolved FIRST**. That deviation from plain nearest-wins is structural: an entity's candidate is
  its stamped FOOTPRINT, the editor camera normally sits inside one (that is what carving a room
  and flying into it produces), such a footprint enters at `t = 0`, and it would otherwise win
  every click in the room and make every prop and marker inside it unpickable.
- **Within a tier, nearest wins and ties go to the SMALLER volume.** That is what resolves nested
  footprints — a scatter's box inside a hall's, both enclosing the eye at `t = 0` — with a fact
  the user can see, where the log order it replaces was invisible. Scoped to ties on purpose: two
  disjoint boxes are still decided by distance.
- **Gizmo handles are not candidates at all.** A handle is a line segment with a
  screen-proportional tolerance, so it is hit-tested BEFORE the arbitration and beats both tiers —
  including the footprint box every handle is drawn on top of.
- **Terrain occlusion is a `maxT`, inclusive.** One raycast at `PICK_RANGE_M` (`= DIG_RANGE_M`,
  `packages/editor/src/field-host/field-picking.ts`) passes the hit distance — or the probe's own
  range when it missed, because nothing past that range was tested. The bound is **inclusive**
  because occlusion means strictly BEHIND, and a carve entity's footprint face lying on the rock
  face it carved is the normal case. The cast is slice-coherent like every other cursor-driven
  raycast, and is skipped when the eye is in rock.
- **A prop click selects the entity that PLACED it.** A placement record is not an independently
  editable object here; the placements module pairs each record with the span that claims it. The
  OBB test uses the record's own frame, not the corner array the wireframe allocates.
- **A flag's pick volume is its anchor CELL** — the same box the camera frames and the selected
  outline draws, on the same half-cell lift the instanced matrices use. Deliberately not the drawn
  marker size: a 0.18 m pin is a hard click target ([advisor](advisor.md)).
- **Layer gates are honoured for props and flags — what you cannot see you cannot select — but
  NOT for entity footprints**, because the `selection` layer hides the emphasis box and a hidden
  box is not a hidden entity.

### Three outcomes, and the ORDER is the arbitration

1. a gizmo handle starts a constrained drag on the press with no threshold (nothing competes for
   a handle press);
2. a press on the ALREADY-selected entity arms a pending drag and does nothing else;
3. anything else is the plain pick.

**That middle rung is what makes a first click on an entity safe** — an unselected entity is
selected and nothing is armed, so the first click can never shove it. `DRAG_THRESHOLD_PX`
(`field-machine.ts`) is measured from the press rather than accumulated.

## One selection, two surfaces

`FieldHost.selectEntity(entityId | null)` and `subscribeEntitySelection` replaced a display-only
highlight verb, which was **deleted rather than deprecated**. There is one selection concept: the
state a viewport click writes is the state a palette row writes, so the two surfaces cannot
disagree about what is selected.

- **The selected-entity setter is the single mutator**, whoever is asking — a pointer click, the
  public verb, an entity leaving the log, a world reset. There is deliberately no second "clear"
  entry point. It validates against the log (an id no entity op carries selects NOTHING rather
  than reporting, because the ids come from a list that can lag it) and re-selecting what is
  already selected notifies nobody, which is what lets the seam's "pushed on every change"
  contract be read literally.
- **The selected entity wears its stamped footprint box** — the union of its span's op bounds,
  falling back to the recorded region only for a pure placer's span. That emphasis rides the
  `selection` layer gate; **the selection itself is not display state** and survives the layer
  being off.
- **The seam is independent of the CELL selection seam**, which carries the cells that mask ops.
  Neither verb disturbs the other, so both can stand at once.

**Esc and `F` deliberately disagree about ordering, and that is the reason.** `F` frames the
selected entity's footprint, else the cell selection's AABB, else refuses — a FIXED priority,
because an object selection names one thing and a cell selection names a volume. Esc takes the
most recently acquired capture. **`F` asks "which of these is the subject?"; Esc asks "what did
you just do?"**

The framing verb ANSWERS its refusal as an `ActionResult` rather than reporting it, and each of
its two callers says the sentence on its own channel — the canvas branch through the tool-error
seam, the registry row as the verdict it hands back.

## Move, delete, duplicate

**`beginMove(entityId)` opens exactly the session that opening an entity opens** — the same
refusals (unknown id, frozen, baked, retired generator, all runtime-quiet through the tool-error
seam), the same ghost, the same terminal verb. What it adds is a MODE: the session is flagged
`moving`, and the CURSOR drives the region.

**That is the load-bearing decision of the whole verb**: nothing is written to the log until the
drop, so a cancelled move costs nothing and leaves no history entry, and the drop is one ordinary
reconfigure splice.

`packages/editor/src/field-host/field-move.ts` owns the arithmetic and is pure:

- **The mapping is anchored, never incremental.** Every reading asks where the cursor is relative
  to the last anchor and applies the DIFFERENCE against what has already gone to the region, so
  rounding cannot compound over a drag and a cursor returned to the press point returns the region
  to where it started.
- **The first anchor is taken at the PRESS**, not at the event that crosses the threshold, so the
  travel that opened the move is not silently lost.
- A free ground drag promotes to the **vertical axis under ⇧** (the arrow pad's own rule — a
  ground-plane drag has no way to express height); a gizmo drag is axis-fixed and ignores it. The
  mapping returns `null` — meaning HOLD STILL — when the view cannot answer: edge-on to the plane,
  behind it, or within ~8° of the axis.
- **A camera change mid-move retires the anchor AND the press pixel.** Both go, because a world
  point read under the old view and the pixel that produced it both lie after the camera turns;
  the re-anchor carries the applied offset forward, so it moves the region by exactly zero.
- Steps are whole `LATTICE` units (`packages/editor/src/shared/field-brush.ts`), handed to the
  same nudge the arrow keys drive. There is deliberately **no travel clamp** — the field has no
  world bounds, and the d-pad has none either.
- **`sameRegion` is the zero-step rule.** The drop compares the live session's region against the
  entity's RECORDED one and ends the session without a history entry when they match, so a twitchy
  click never spends an undo entry on a re-splice that changed nothing.

  It replaced a predicate that asked the DRAG (had the cursor travelled?) and so only knew about
  the cursor: an arrow-nudged grab read as idle and ⏎ discarded the user's steps, while an
  out-and-back drag read as moved and spent an entry on a no-op. Both directions are pinned in
  `packages/editor/tests/field-host-move.test.ts`.

**`gizmo.ts` is the translate handles' pure math.** The span derives from the selected footprint
and the same span emits the line pair, so the drawn arms and the picked arms are one geometry. An
axis within `VIEW_PARALLEL_COS` (~8°) of the view ray is culled, where a hit-distance test is
meaningless. The arms narrow to the constrained one the moment a drag owns them; a free ground
drag keeps all three, because it has no single axis to name.

**Delete** splices out the span AND its entity op, rewinds the chunks the span wrote, and replays
the downstream ops reaching them on top — so the log reads as though the stamp had never been
committed, with every later edit preserved. **ONE undo entry.** Core is setup-loud on all three
refusals (unknown id, frozen, baked) and this is the editor, so each throw is caught and reported
verbatim on the tool-error seam. Its dirty set can be EMPTY without nothing having happened: a
placements-only entity writes no cells, so deleting a scatter dirties nothing while every prop it
placed leaves the log with it.

**Duplicate** is a fresh commit from the record's own provenance, not a second reference to it. It
offsets +X by the original's footprint extent snapped up to the lattice, takes a fresh seed when
core's `GeneratorDef.usesSeed` says the generator READS one (so a duplicated cave or scatter is
genuinely different, while a hall's copy is not left wearing a different number for an identical
shape), opens at merge policy `"replace"`, and the copy becomes the selected entity. **Frozen and
baked entities can both be duplicated** — the copy is a new commit from recorded provenance, so
duplicating is how a baked stamp's recipe becomes live again.

Reach: ⌫ / Delete, **⌘J** for duplicate — not ⌘D, which Safari owns as add-bookmark and does not
let a page intercept — and **G** for grab. All three refuse with no selected entity, and delete
and grab refuse during a session as well (deleting the entity under a reconfigure, or replacing
the session a `G` would open, both discard work the user is still doing).

## Three defects the machine's state now names

- **`setTool` takes a PATCH** (`Partial<FieldTool>`), and the widening is a fix rather than
  ergonomics. Hold ⇧ (momentary smooth), drag the strength slider, let go — and the brush was
  permanently smooth, because every strip control spread the whole tool, and under a held modifier
  that value is the DERIVED brush. The seam then read the echoed effect as a deliberate pick and
  adopted it as the base the release restores to. **The whole-tool seam could not tell the two
  apart, because a deliberate pick of the derived effect and a param echo are the same VALUE.** A
  patch separates them by construction: a control names only the field it owns.

  Spreading field-by-field host-side while keeping the host's own effect was checked and rejected
  on evidence — it provably breaks the deliberate-pick case the branch exists for. **The widening
  is source-compatible** (a whole tool still satisfies the partial), so no existing caller had to
  change to keep compiling; the change is visible only where a caller CHOSE to narrow.
- **A history step cancels ANY live session**, not only a moving one. A world reset and a material
  table swap already applied that blanket rule, on the reasoning that a session whose inputs moved
  must not be left offering an Apply that would build something the ghost never showed; a ⌘Z that
  rewrites the log under a plain reconfigure session is the same class of event.
- **The 2-D model, which the state now names and the facade type still does not.** What LMB does
  is really TWO independent facts: an **EFFECT** (dig / fill / smooth / paint — the tool cluster's)
  and a **GESTURE** (stroke / two-click box / two-click segment / pointer — the machine's slot).
  What runs is the product of the two, and `ViewportGesture` is a **1-D projection** of it:
  `segment` is a brush EFFECT wearing a gesture's costume, which is why arming it has to reach
  into the tool and why the suspension check needs a branch of its own.

  **`ViewportGesture` stays the 1-D CONTRACT**, and that half is presentational and filed: the
  rail still shows an exclusive list, the strip still compensates at render time, and the arm
  cycle still walks a one-dimensional ring over two-dimensional state. Changing the type is a
  chrome-visible decision with consequences for the keyboard ring, the flyout and the armed index.
  Filed at `docs/backlog/editor-and-tooling/segment-is-a-modifier-not-a-brush.md`, whose state half
  is closed and whose presentation half is not.
