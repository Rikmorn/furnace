---
summary: What the user arms and what it writes — the brush chassis, the selection gestures, stamp and reconfigure sessions, the void cast, and the one table every tool surface derives its words from.
verified: 2026-08-18
---

# The tools

The editor's editing verbs: the brush that writes cells, the gestures that select them, the
generator sessions that stamp recipes, and the surfaces that show which of them is armed.
[interaction](interaction.md) owns how the pointer and Esc arbitrate between them;
[action-registry](action-registry.md) owns the keys and the refusals; this file owns the tools
themselves and the table their words come from.

## The brush chassis

`FieldTool` is `{ effect, materialId, mask, smooth, hollow }`, where `effect` is one of
**dig · fill · paint · smooth**. Masks map to core's `BrushMask`; the selection choice embeds
the host's current selection spec, and with no selection the mask is dropped and reported.

Shortcuts, all bound on the CANVAS ([chrome](chrome.md) has the two-listener split):

- `[` / `]` and the wheel set the radius.
- **⌥-click is the eyedropper** — it samples the aimed cell's class.
- **⇧ held is momentary Smooth, ⌃ held is momentary Dig.** `deriveMomentary` is a pure function
  of (saved base, ⇧ held, ⌃ held), so any path can re-derive rather than remember; it swaps
  dig↔fill symmetrically and passes ⌃ through under paint and smooth.

`clampTool` and `clampRadius` are the enforcement: the radius bounds and the hollow floor are
enforced here and stated to the user as a control's own `min`/`max`, which is why they live on
the neutral floor rather than beside the clamp (below).

### `subscribeTool` is a STATE seam

Every set that changes something publishes, and subscribing pushes the current pair. **Both
halves were needed and neither is sufficient:**

- The **publish** answers who owns the value. Three surfaces read the tool simultaneously (the
  strip, the status keymap, the action registry). With no announcement a copy each diverges the
  first time anyone picks a brush and nothing ever reconciles them.
- The **snapshot** answers the late mount. The top bar swaps the tool strip out for a session
  strip for the whole of every stamp session, so the surface that displays the brush remounts
  once per session; without a catch-up push it would come back on the default tool.

**The value guard is not an optimisation.** Every strip control rebuilds the whole `FieldTool`,
so a publish without a compare would push on every no-op set into a path that previously ran
only on momentary taps. `sameTool` is the radius guard's `if (clamped === digRadius) return` one
type up.

**Its PLACEMENT is a second property with its own pin.** `sameTool` sits BELOW the momentary
branch: while a modifier is held the live tool is the DERIVED brush, so a set equal to it can
still be a real change to the base the release lands on. Hoisting it above the branch makes
letting go of ⇧ restore the wrong brush — and leaves the entire chrome suite green, because
nothing there drives the host's own key listeners.
`packages/editor/tests/field-host-momentary.gpu.test.ts` does; it needs a device only because
`init` is what attaches those listeners.

**Two comparators, and the shared floor is the option not taken rather than the option not
seen.** `sameTool` (host) and `toolsEqual` (`packages/editor/src/frontend/lib/field-host-mirrors.ts`,
chrome) are the same predicate on opposite sides of a boundary the chrome may not cross with a
value import ([bundling](bundling.md)). It stays duplicated on tolerate-until-three, and because
this duplication is the safe kind: both carry the destructure `satisfies Record<string, never>`
backstop, so a new `FieldTool` field fails to compile in both places at once. What the backstop
cannot catch — a comparison someone DELETES from one copy — is covered per-field on both sides.
Filed: `docs/backlog/editor-and-tooling/sametool-and-toolsequal-written-twice.md`.

**A control that displays anything the tool does not literally say owes its own
normalisation.** A value-guarded seam is entitled to withhold an echo — a corrective set to a
value the host already holds publishes nothing — so a control holding a local text buffer must
re-seed it beside the corrective set rather than waiting. The hollow-thickness field is the only
such control, and structurally so: it holds the only local buffer among the strip's param
renderers. Every other one is a range input, a `<select>` over exactly the legal option set, or
a swatch grid, so none can hand the host something to clamp.

**Two observable consequences are accepted rather than fixed.** A set the host CLAMPS corrects
the control, which is the point. And **before the engine is up the brush controls do nothing
visible** — the host reference is assigned in the same tick as the engine-ready dispatch and the
latch is gated on it besides. In the no-WebGPU and engine-error states that window never closes:
the shell renders unconditionally, so the rail and strip are fully interactive and permanently
inert. Judged the RIGHT outcome — there is no host, so there is nothing a brush could arm — but
not the right PRESENTATION, filed at
`docs/backlog/editor-and-tooling/brush-controls-inert-with-no-engine.md`.

## The armed gesture — one slot

`setGesture` arms LMB, and there is **one slot**: arming any member disarms the rest. Its
members are `pointer`, `box`, `material`, `void` and `segment`, and **`pointer` is what a host
opens armed with**, so the first click on a world selects rather than digs.

- **box** — two clicks, with an anchor cross and a LIVE snapped-region preview following the
  cursor.
- **material / void** — one-click floods seeded from the raycast hit, or from its last-air
  neighbour. Bounded by `SELECTION_UI_BUDGET` (200 000) under core's own ceiling, with
  truncation surfaced rather than silent.
- **segment** — a brush gesture, not a selection (below).

Selections are a tool CLASS, not an op: while one is armed the brush apply is bypassed. The
amber selection overlay does not occlude, restoring the last selection is a one-slot verb, and
what the selection actually DRAWS — surface-first cells for a flood, an honest AABB for a
region — is [chrome](chrome.md)'s.

## The segment brush — a two-click swept capsule

The first click sets an anchor; the second builds ONE `{ kind: "capsule", a, b, radius }` op and
commits it through the ordinary log path — so it is one ⌘Z, exactly like a stroke, and needs no
undo machinery of its own. Both endpoints are the RAW surface hits rather than bitten-past
centres: a tunnel must start and end where the user clicked.

It is a BRUSH gesture. It makes no selection, and the active tool's effect / material / mask /
radius stay live under it — dig carves a tunnel, fill raises a rampart. That is why picking a
brush effect disarms a SELECTION gesture but deliberately leaves `segment` armed ("sweep a
rampart instead of a tunnel", not "stop segmenting").

**`MAX_SEGMENT_M = 2 · DIG_RANGE_M` = 60 m**, checked before the anchor is cleared, so a refusal
leaves the pending start armed and the fix is one nearer click. It is the one gesture whose op
extent is not bounded by construction — a stroke's sphere by its radius, a kit fill by the
snapped box, a flood by its budget — because the fly camera stays live between the two clicks
and the sweep length is whatever the user walks. The constant's own TSDoc owns why twice the dig
range is the geometry and not a round number; it lives on the neutral floor so the rail's hint
and the host's check read the same number ([bundling](bundling.md)).

**The preview is the WHOLE preview**: a hologram-blue anchor cross plus the wireframe capsule the
second click would commit, under the ghost layer, since a pending capsule is a preview of a brush
op rather than a selection. No worker ghost and no scratch mesh — a brush op is cheap and
reversible, and the generator preview protocol exists for recipes whose output cannot be guessed
from their inputs. A swept capsule can.

`commitToolOp(shape)` is the shared build→apply→report path the stroke and the segment both
take, so both carry ONE failure contract: every setup-loud throw the apply raises — a kit fill
off the lattice, a kit class under a non-box shape (reachable ONLY through this gesture), an
unknown material class — is caught, reported on the tool-error seam, and the op DROPPED. That
posture is right for a pointer drag, where a human is watching and a throw out of `pointerdown`
would strand the gesture mid-capture; it is deliberately the OPPOSITE of the agent door's
([agent-door](agent-door.md)).

The box cross-section variant is explicitly not shipped
(`docs/backlog/editor-and-tooling/segment-brush-box-cross-section.md`).

## Layers and the slice plane

`FieldLayers` is `{ field, kit, props, ghost, selection, grid, flags, voidCast }`. The state —
the flags, the plane, and both facade seams — lives in `packages/editor/src/field-host/field-view.ts`.

The first seven gate the render lists per frame and are display-only: a hidden selection keeps
masking ops. The rendered set is a `Record` keyed by the visible layers, so the group is
**EXHAUSTIVE rather than merely closed** — an extra key already failed to compile, a MISSING one
did not, which is exactly how the advisor's layer first shipped with no toggle at all. The ghost
checkbox is DISABLED with a hint while a selection tool is armed and no stamp session runs
(suppression honesty — the brush ghost is mode-suppressed but the stamp hologram is not).

**`voidCast` is NOT a plain gate** — it is the X-ray view mode, and it has an EDGE effect
(below). It renders under a separate "view" group and the split is machine-checked by
`type VisibilityLayer = Exclude<keyof FieldLayers, "voidCast">`.

**Slice is a remesh clip**: the worker clamps aprons at or above the slice Y (density→air,
material→rock) before mesh and skin, yielding capped cuts for free. Every gesture raycast and
the buried-eye probe take the same ceiling, so what you see is what you target.

## The void cast — an X-ray view mode

Enabling it copies every allocated chunk's density into ONE worker job — a copy, because the
client TRANSFERS the buffers and sending the store's own would detach the field. The worker
installs the snapshot into a scratch store and, per chunk, **extracts the apron FIRST, then
inverts that window**, then meshes it with the ordinary mesher. Inverting AFTER extraction is
load-bearing: the apron's outer ring reads unallocated space as SOLID, which is what the real
field holds there, so the cast caps against the rock outside instead of running open past every
allocated boundary.

Host side it is one mesh per non-empty bucket at chunk origins, under a dim-cyan premultiplied
material at `depth: { write: false, compare: "always" }`. **Depth-always is the load-bearing
half** — under the default compare, any nearer front-facing opaque surface buries the cast, which
is exactly the case the tool exists for. It is NOT a z-fighting fix: the cast's triangles ARE the
field's, wound backwards, so back-face culling already keeps exactly one of any coincident pair.
It is submitted FIRST of the three translucents: submitted last, a depth-ignoring cast would wash
cyan over every ghost in the frame; submitted first, the two hologram ghosts read on top of it.
A ghost is the action the user is steering; the cast is the room around it.

**Four refusals**, in the order a user meets them, all on the tool-error seam: a cast already in
flight (the client is one worker with a synchronous per-message handler, so a second sweep would
delay every remesh behind it); an empty world; a world over `VOID_CAST_CHUNK_BUDGET` = 512
chunks; and a torn-down context, which is silent by design. The budget's justification is at the
constant — 512 chunks is 2.1 MB of density on the wire and, packed, a 32 m cube of field at the
default cell, a region-scale tool by design — together with its measurement (**~1.3 s of worker
time at the ceiling, bun/JSC, one cast**) and the instruction to re-measure on V8 before moving
it.

**It is a snapshot, not a live view.** The invalidation sits at the single density-mutation
choke point (strokes, stamp commits, ⌘Z/⇧⌘Z, reconfigure apply) and DROPS the cast, saying so —
a silently vanishing X-ray beside a still-ticked box would read as a bug — and it is
self-limiting, since the second mutation finds nothing live and returns. Re-toggle to refresh; a
`setLayers` call that merely leaves the flag true rebuilds nothing, which is also why the cast
stays gone across a dispose/re-init or a world load while the flag rides through. Two pieces of
state keep it honest: a generation counter strands in-flight results after a discard (nothing
can call the worker off, only agree to ignore it), and the single-flight latch is cleared in
BOTH the resolve and the reject paths BEFORE the staleness guard, since a stranded job that left
it set would refuse every later cast forever.

**Two gaps are filed, not settled**: it refuses where COALESCING belongs and has no cancel
(`docs/backlog/editor-and-tooling/void-cast-monopolises-the-worker.md`), and it ignores the slice
plane (`docs/backlog/editor-and-tooling/props-ignore-the-slice-plane.md`). Its pixels are also
the one field overlay nothing has ever visually checked; the advisor's marker layer took the
other route and left a re-runnable recipe for whoever does
(`packages/editor/scripts/analyzer-pixel-check.md`, [advisor](advisor.md)).

## Stamp sessions and reconfigure

`packages/editor/src/field-host/field-stamp.ts` holds the pure session transitions (a run
counter supersedes stale previews); the host owns the verbs.

- **`startStamp`** takes the region from the current selection, snapped outward — or, with NO
  selection, arms a `PendingStamp` for region-draw rather than refusing. The arm is published on
  its own seam because the host owns both halves of the question (whether picking a stamp opened
  a session or asked for a region, and every path that ends the arm); four surfaces read it, and
  inferring it in the chrome is how they would disagree. **The arm SHADOWS the armed gesture**:
  while one stands, LMB is drawing a region whatever the gesture slot still says.
- **`updateStamp` / `rerollStamp` / `nudgeStamp` / `commitStamp` / `cancelStamp`** are the rest.
  Rerolls mint crypto seeds; nudges move in lattice steps on world axes. A commit runs core's
  `commitGenerator` — ONE undo entry, with the entity op recorded.
- **A reconfigure session** is the same machinery seeded from recorded provenance: params, seed
  and region. Merge policy is NOT recorded, so it opens at core's fallback and the card surfaces
  it. Applying runs core's `reconfigureGenerator` — an in-place span splice with
  affected-set-culled downstream replay — remeshes the dirty set, and is ONE undo entry.
- **A move IS a reconfigure session**, flagged. The session card's three states and the
  promotion that opens one from a committed record are [inspector](inspector.md)'s.

**The preview is a scratch-store evaluation in the worker.** The region plus a halo chunk
snapshot goes over with density buffers COPIED then transferred; it is meshed by the same path
and rendered as a hologram-blue translucent ghost — surface buckets only, no kit pieces. For any
`contextFree: false` generator the request carries an evaluate context naming the scratch store,
which is what lets a scatter's ghost read the field at all; placements come back as a count for
the session and as ONE merged wireframe batch of oriented proxy boxes for the ghost.

**A session SUSPENDS the brush.** A live session swallows an LMB stroke and the segment click
alike (the segment brush reaches the store through its own branch and needs its own guard),
saying so once per session, and the registry's `armsTool` gate refuses the family keys.

**The empty-result policy is settled.** Core rejects an evaluate with no ops AND no placements
and KEEPS that stance — right for a carver, wrong-feeling for a reader driven to zero props — so
the **EDITOR refuses first, for PROP generators only**, gating both commit and apply on core's
own `emits` declaration and reporting a sentence about props. A carver still goes to core and
surfaces core's own wording, because "raise density, lower spacing" is nonsense advice for a
hall. Core never sees the empty commit for the case it reads wrong.

### Freeze, bake, delete, and drift

Freeze / bake / delete are the entity ROW's verbs, not the session card's (D-14): they change
what an entity IS rather than what it holds. Frozen entities refuse Open at the row with a badge
and a reason, and freezing cancels a live session on that entity. Bake confirms through the
App-owned prompt, which stays inside the no-clobber and keybinding-suppression guards. An
entity-record change that dirties no chunk still ticks the entities seam, so the palette follows
a freeze, a bake, or an undo of either.

**The drift report** carries core's drifted/orphaned findings plus the committed entities whose
FOOTPRINT box those findings' chunks fall in — the palette's Δ badge rows. The entity-id half is
derived host-side at push time, because only the host holds both inputs: the findings speak
chunk keys, the rows speak entity ids, and relating them needs the chunk dimension times the
cell size, which the chrome cannot value-import core to reach. The report clears on ANY history
step and on world load, and is never recomputed.

### The catalogs seed, they never gate

Three project→editor catalog files are fetched in ONE pass so they cannot race —
`/catalog/materials.json`, `/catalog/entities.json` and `/catalog/agent.json` ([daemon](daemon.md)
serves them, [advisor](advisor.md) owns the third). All three are DATA only, parsed setup-loud by
`packages/editor/src/shared/catalog.ts` with one error type and the path named.

Only MATERIALS gates loading a world; props render from the op log whether or not the entity
catalog resolves. The entity parser normalises the catalog's authoring vocabulary into the
scatter generator's param spelling and deliberately drops the mesh paths — editor props are
collision proxies (`docs/backlog/editor-and-tooling/props-render-as-collision-proxies.md`).
**Absent file → the generator still runs on schema defaults and every prop draws at a nominal
box.**

**Archetype-driven params.** The generator listing fills any generator's `archetypeId` property
with an `enum` of the catalog ids, so the inspector's kind resolver renders a picker instead of
free text ([inspector](inspector.md)); opening a stamp overlays the chosen archetype's authored
block on the schema defaults. **Seeding is ONCE-at-open** — switching archetype mid-session keeps
the current numbers
(`docs/backlog/editor-and-tooling/archetype-switch-keeps-stale-hints.md`).

The generator listing is a **SNAPSHOT, and the catalog necessarily lands after the first possible
read** (engine-ready fires before an async fetch can settle), so the catalog owner signals once
the catalog is installed and consumers re-read the registry. **The signal carries NOTHING** — the
host is the source of truth, and a payload would invite reading it instead. Reading once left the
archetype field free text forever. Both halves are pinned in the two files they belong to, which
host-level tests structurally cannot do because they install the catalog first: the INSTALL half
in `packages/editor/tests/chrome/host-seams-and-catalogs.test.tsx`, the RE-READ half in
`packages/editor/tests/chrome/session-card.test.tsx`, which opens the session BEFORE the fetch
settles so the card's mount-time read is the pre-catalog one.

## One table states a tool fact

`packages/editor/src/shared/action-table.ts` is the single source for what a tool is CALLED, what
it OFFERS and what it SAYS. It holds
<!-- derive: bun -e 'const t=await import("./packages/editor/src/shared/action-table.ts");console.log(Object.keys(t.EFFECT_ROWS).length)' -->4<!-- /derive -->
effect rows,
<!-- derive: bun -e 'const t=await import("./packages/editor/src/shared/action-table.ts");console.log(Object.keys(t.GESTURE_ROWS).length)' -->5<!-- /derive -->
gesture rows and
<!-- derive: bun -e 'const t=await import("./packages/editor/src/shared/action-table.ts");console.log(t.FAMILY_ROWS.length)' -->4<!-- /derive -->
family rows, plus the two transient states that belong to no row.

**The canvas-owned key vocabulary is IN the table**, and that is what makes the status line
derivable. The action registry really does not know which four of two dozen bindings matter in a
given mode — but a *tool* table does, because a row states its own status line, so the line stops
being a projection of the bindings and becomes a fact carried beside the label. The two files
that once argued the opposite each keep a header block quoting the paragraph they used to carry
and stating the supersession.

A status line is a `" · "`-joined list of **two** fragment kinds — constant text, or one runtime
value with a constant lead-in — and there is deliberately no third shape. Five slots name every
value no table can hold. The `session ▸ pendingStamp ▸ gesture ▸ effect` precedence is a
table-level constant that the derivation **walks**, so the written order is the order that runs.

Six consumers COMPUTE their table from the rows at module scope, and no literal survives beside
them: the strip's tool options, its container-query breakpoints, its select modes and flood-budget
label, the rail's families, the status keymap's armed line, and that line's modifier clause.

`shell/status-keymap.ts` is an **ADAPTER and nothing else**. What is left in it is the one thing
the floor cannot do: reach the host's session / pending-stamp / segment-HUD objects and flatten
them into the plain input a module below `field-host/` may take, resolving the two session verbs
on the way.

**The family model is a join keyed on the RULE FIELDS, not on the family id.** The rail's module
maps the derived families and adds the three things a row cannot hold — `label`, `members`,
`armed` — each implemented ONCE per rule rather than once per column: a label rule picks the
action's own label or the running session's, and a member source picks the table's rows or the
host's generator registry. The third follows the second, because that is what the two answers
actually differ by: a rows-backed column is armed when one of its own refs matches what LMB is
on, and a generators-backed column has no ref to match. A derived member therefore carries its
REF and no id, and the one surface that needs a per-member key makes that choice in the one place
the two cases meet.

**Registration order is not rail order.** Presentation — which member a family lists, in what
order, under what label, with which params — is this table's, and nothing may read the tool
registry's order as one.

**Two residues are adjudicated rather than closed**, and both are filed: the status line respells
keycaps the binding rows also derive (`keycap()` lives ABOVE the floor, and the fix that keeps
the layer arrow costs the fragment model —
`docs/backlog/editor-and-tooling/status-line-respells-derived-keycaps.md`), and the three
restated radius/hollow constants below are pinned by nothing
(`docs/backlog/editor-and-tooling/radius-constants-pinned-by-nothing.md`).

### The restated host constants

`packages/editor/src/shared/field-limits.ts` holds the numbers BOTH layers value-import instead
of agreeing by review: `MAX_SEGMENT_M` (with `DIG_RANGE_M`, which it is twice by construction),
`SELECTION_UI_BUDGET`, `RADIUS_MIN`, `RADIUS_MAX` and `HOLLOW_MIN_M`. `LATTICE` is on the floor
too, in `field-brush.ts`, because the module that computes with it owns it. `field-host/` imports
them back — arrow-legal ([bundling](bundling.md)).

**The bar for that file: a number belongs there only if it is BOTH enforced by the host AND
stated to a user.** A host-private clamp with no affordance stays beside its enforcement. The
radius bounds and the hollow floor meet it in the strongest form — each is a native control's own
`min`/`max`, so a drifted copy would not merely misdescribe the clamp but make the control refuse
a value the host accepts.

**Measured, not assumed:** Tailwind's automatic source detection **does** scan the shared
directory, which is why the strip's breakpoints are carried as literal class strings rather than
as rem numbers. A templated at-rule is not class-shaped text and would emit no rule at all.

### The tool registry

`packages/editor/src/shared/tool-registry.ts` answers **two questions and no others**:
`toolEntries()` says which tools EXIST, in registration order — the enumeration the agent door's
surface needs — and `toolCanActivateControl(id, ctx)` says whether one of a tool's controls may
render LIVE against the current material classes. Two tools are registered, `brush` and
`segment`. `define` is **setup-loud** on a duplicate id; both query paths are **runtime-quiet**,
because every caller is inside a React render where a throw over one knob takes the whole strip
down.

**It absorbs exactly one rule, and moving it is the point.** The strip's param filter used to
spell "a swatch strip with nothing to choose between is dead" inline, and was therefore the only
place in the editor that knew a control could be dead for a reason the effect table cannot see.
It asks the registry now, so a second surface asking the same question gets the same answer by
construction. The filter still runs BEFORE the strip's ≤ 4 cap, so a material param a one-class
catalog cannot fill never eats a slot and strands a real control behind the ⋯.

**`segment` registers with no capability answer**, and that is a fact about the tool rather than
an omission: a segment click commits a brush op built from the live effect and material, so the
controls under it are the BRUSH's and the brush's answer governs them.

**There is no `build` on a row, and the builder half is deferred whole rather than half-built.**
The only builder that has an implementation is in `field-host/` and immovable — it value-imports
the ghost module, which value-imports core — so a row carrying it could only be WRITTEN there,
where the chrome can never read the capability answer sitting beside it. The structural fact
underneath is that **the chrome and the host are two BUNDLES, not two directories in one
bundle**: each graph gets its own module instance and its own table, so a registration written
host-side never runs in the chrome's graph. The strip would query an EMPTY table, take the
default, and put a dead control back on screen with every test green — because tests run
UN-BUNDLED in one process where the host's registration HAS run. Splitting the registration so
the host attaches only the builder fails the same way with a type that says otherwise; a separate
host-side registry keyed by the same ids converts a bundle-visibility problem into a drift class.

The capability verb is named `canActivateControl` rather than the bare `canActivate` because the
semantics are per-CONTROL: a one-class catalog kills the swatches and leaves radius, mask and
hollow alone, where a tool-wide boolean could only kill all four or none. The per-TOOL question
is a different one, and the obvious name is reserved for it.

## The surfaces

**`shell/ToolRail.tsx` (D-8) is a fixed 44 px column** down the left of the canvas cell. It is a
COLUMN, not a palette: it cannot be closed, moved, collapsed or resized, so it is part of the
cell's constant inset the way the two bars are, and it lives in the shell's body ROW as a sibling
of the cell rather than in the palette layer above it. Everything a palette can do to the canvas,
this must not do.

Every button renders from the family rows and dispatches that family's registry action, so the
rail and the family keys are two views of one table:

- **A click arms the family's CURRENT member and never cycles.** The rail is a mode selector;
  pressing the mode you are already in is idempotent, and cycling has its own affordance (⇧ + the
  letter, and the flyout).
- **A multi-member family carries a member flyout**, and it is the most load-bearing affordance
  in the file: without it the members past each family's first would have no route at all. It is
  a 24 px target directly below the family button rather than a corner tick, because a 44 px
  column has no room for both a compliant target and the family button's own hit area.
- **The pressed family carries the inverted fill**, and keeps full strength when it is also
  REFUSED — a refused family that is armed is the live session's own family, and dimming it would
  make the strongest element in the rail a 40 %-opacity claim.
- Refusals come from the registry's own gate, so the button and the key refuse in the same words,
  and they carry `aria-disabled` rather than `disabled` — a `disabled` button leaves the tab
  order, and the refusal sentence rides the accessible NAME precisely so a keyboard user gets it.
- The whole column is ONE tab stop with a roving tabindex ([design-system](design-system.md)).

The rail is the one always-mounted action-context consumer, and its model is memoized on exactly
the ctx FACTS its rows read — never on the ctx itself, and for the session never on the session
OBJECT, which the stamp seam re-clones at pointer rate during a grab.

**`shell/ToolStrip.tsx` (D-6/D-7) is the top bar's middle**: what is armed, and the knobs that
steer it, in three shapes. The brush family gets params; the cell-select family gets its mode name
and the one static fact that bounds it; the pointer gets a READOUT of what is selected, because
direct manipulation's parameter is the selection itself — named through the registry's own entity
namer, so the strip, the rows and the menu labels cannot call one object three things.

**The capacity rule (D-6)** is what keeps the strip from moving the canvas: it is ONE flex row
that never wraps and never changes height, held by `overflow-hidden` plus a per-effect container
query that hides the whole param group at once and degrades the strip to `name + ⋯`. That
degradation is only safe because `shell/StripOverflow.tsx` holds the effect's WHOLE option list,
of which the strip renders a prefix — ONE list, two renderings, so "the ⋯ holds everything the
strip shows plus the rest" is structural rather than a promise. The two non-brush branches have no
threshold, deliberately: their content is one short span that cannot overflow, and content that
never hides is never unreachable.

**`shell/SessionStrip.tsx` replaces the tool strip while a session stands** and answers the three
questions the tool strip cannot: WHAT is being edited, WHICH of the three states it is in, and HOW
it ends. `lib/field-session.ts` owns the session's name and state tag so the strip and the card
cannot disagree about either. The verbs here are READOUTS, not buttons — the clickable pair lives
on the session card, which auto-opens on the very session this strip describes. Rotation is shown
only where it can act: a MOVE is decidable from here (it is a region translation) while a
generator's rotation is not, so the key hides where it is CERTAINLY dead and stays where it is
merely possibly dead.

**`packages/editor/src/field-host/viewport-cursor.ts`** is the third arming channel, and its two
decisions live together because they have to agree: the CSS keyword under the pointer
(`grabbing` / `grab` for a live move, `cell` for the two-click gestures, `crosshair` for the
one-click commits, `default` for the pointer and for anything a session has suspended) and the
world-space mark drawn before the first click (a ring for the segment brush, whose sweep really
is the brush thick; a cross for a box corner and a pending stamp's region corner, neither of
which has a radius).

The status bar's keymap line is the fourth channel and is **derived from the tool table** (above).
Its modifier clause is derived rather than static, because the momentary derivation swaps dig↔fill
symmetrically and passes ⌃ through under paint and smooth — a static clause named three keys the
host does not bind.
