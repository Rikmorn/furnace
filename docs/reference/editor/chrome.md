---
summary: The overlay cockpit — the layout contract that keeps the canvas still, the floating palette layer and its geometry, the notify store, the menu, and the seams the surfaces latch onto.
verified: 2026-08-18
---

# The chrome

One full-window canvas with everything else floating over it. The chrome is
`packages/editor/src/frontend/` — React 19, Tailwind-styled, prebuilt and served by the daemon
([bundling](bundling.md)). This file is the SURFACES; [design-system](design-system.md) is the
vocabulary they are written in, [tools](tools.md) the verbs they arm, and
[interaction](interaction.md) what the pointer and Esc do inside the canvas.

## The layout contract (D-1)

`packages/editor/src/frontend/components/shell/Shell.tsx` states the one rule the cockpit rests
on: **the canvas cell's insets are decided by the two fixed-height bars (`TopBar`, `StatusBar`)
and nothing else.** No palette opening, no selection changing, no surface resizing may move
them.

Every floating surface — the palette layer, the axis triad, the toast stack — therefore mounts
as an **absolute layer inside that cell**, over the canvas, never as a flex sibling of it. The
tool rail is the one exception and is not floating at all: it is a fixed column in the shell's
body row, part of the constant inset the way the bars are ([tools](tools.md)).

Shell is split out of `App.tsx` deliberately: App owns the engine bootstrap (the dynamic
`/engine.js` import plus a WebGPU probe), neither of which can reach "ready" outside a browser,
so a layout living inside App would be a layout no test can drive. Shell reads what it needs
from the editor context, which a test supplies.

The provider stack, in dependency order — workspace → palette stack → field-host state → view →
world → catalogs → the chrome. The order is not cosmetic: the world state derives its dirty bit
from the stats the host-state provider owns ([world](world.md)), and the global keybindings bind
⌘S to a world verb, so the listener has to sit *below* the provider it reads.

### The canvas host

`shell/CanvasHost.tsx` mounts the one canvas and inits the host on it.

- **Init is EAGER.** This canvas is an absolute fill of a cell whose height comes from two
  fixed-height bars, so it is sized by construction at the first effect. A **zero measure is
  therefore not "not laid out yet" — it is the layout contract broken**, and it logs then throws
  rather than waiting for a resize that will never come. The log precedes the throw on purpose:
  there is no error boundary above it, so the throw blanks the page.
- **`init` takes the canvas and nothing else.** The context is `sampleCount: 1`, full stop,
  which is what makes an offscreen capture of this viewport possible at all — core's
  `frame.renderToTexture` refuses every other count.
- **The re-init chain is insurance.** The host holds one context and throws on a second `init`,
  and its dispose is *deferred* (dispose only once `init` has SETTLED, because init awaits the
  GPU context and disposing mid-await pulls it out from under trailing creations). Any cleanup
  and effect landing in the same React commit therefore needs the next init to wait for the
  previous teardown, which a `teardown` ref carries forward. Nothing in the chrome performs a
  re-init on demand today — `App` builds one host and `main.tsx` renders without `StrictMode` —
  and the chaining is kept, labelled as insurance in its own comment, because either of those
  is a one-line change. `dispose()` + `init()` on one host stays in `FieldHost`'s contract and
  `packages/editor/tests/field-host-reinit.gpu.test.ts` still walks it on a real device.
- The canvas is `tabIndex={0}` with a visible focus ring: the host attaches its WASD/QE fly,
  `[`/`]` radius and arrow-nudge keydowns to the CANVAS, so the ring is the only signal those
  keys will land anywhere.

**The host owns the canvas's resize response and the chrome must not** — the invariant, and its
mechanism, are [bundling](bundling.md)'s.

## The palette layer, the workspace store, and geometry

`packages/editor/src/frontend/lib/palette-store.ts` is **pure data** — no DOM, no persistence,
no React. The cell's size is the one fact it cannot know, so it arrives as an argument; the
layer component measures it. That is what makes clamp, snap and what-survives-a-hide testable
without a browser.

**`PALETTE_IDS` is a closed union of
<!-- derive: bun -e 'const m=await import("./packages/editor/src/frontend/lib/palette-store.ts");console.log(m.PALETTE_IDS.length)' -->5<!-- /derive -->**
— `entities`, `session`, `flags`, `history`, `log`. A persisted record for an id not in it is
**dropped rather than restored**, so a retired palette cannot come back as dead geometry.
Nothing migrates the stored shape, which is the whole reason the union is closed here rather
than inferred from whatever the blob happens to contain.

### The default arrangement is arithmetic, not taste

`DESIGN_FLOOR_CELL` is the 1280×800 design floor less the rail and the two bars, and at that
size **three palette columns fit side by side**: `entities` at x=24 (360 wide), `session` at
x=420 (280) and `history` at x=720 (240). Exactly ONE column stacks — `entities` over `flags`,
on the left — and that stack is what `entities`' declared `maxHeight` extent pays for.

`PALETTES` carries a `width` and an optional `maxHeight` per palette so the arrangement is
**PROVABLE rather than eyeballed**: `packages/editor/tests/palette-store.test.ts` checks every
pair and passes each only on a declared corner-share, disjoint columns, or an extent that clears
the palette below. A default that deliberately shares a corner declares it
(`sharesCornerWith`), beside the default it excuses, so a palette added later inherits nothing.

**The extent has ONE home**, `PALETTES[id].maxHeight`. A palette body that capped its own list
with a utility class would be a second ceiling the box builder cannot see and a resize cannot
drop — which is what made dragging a palette taller add empty space under a short list. The
same suite scans the palette-body directories for one.

**Nothing docks by default and no default claims the RIGHT edge.** Past `history`'s right edge
the cell is clear, which leaves the top-right corner to the axis triad and the strip a
right-handed user orbits in unclaimed. `Toasts` takes the bottom-right (its own absolute
layer), so the **bottom-left** is the one strip nothing defaults into, and that is where the
collapsed-chip rail lives.

`log` and `history` start **closed** because they are summoned (the status bar's ⚠ and `undo N`
chips, the View and Edit menus). `session` starts closed for a different reason — its open
state is DRIVEN by whether there is a session or a selected entity to be about (D-13), which is
what `drivenOpen` records: not persisted, not restored, and still reachable by the burger's
checkbox so the card's × is not a latch with no exit ([inspector](inspector.md)).

`SNAP_PX` is 24 — roughly a coarse pointer's slop. The ⌘\ hide-all is a **latch**: `hidden`
does not touch the per-palette records, so restoring returns the exact prior arrangement.

### Both figures are DEFAULTS, not limits

Each palette carries a corner resize handle — a real `button`, so the arrow keys size it too
(Right/Down = bigger, ⇧ = the long step) — and the size it sets joins the workspace blob beside
the position: persisted, restored, cleared by Reset Workspace. It is stored as an **OPTIONAL**
`width`/`height` on `PaletteState`, absent until the user drags, so "has this been sized?" needs
no flag, an old blob migrates by having no field, and a later change to a declared default still
reaches everyone who never dragged.

`paletteBox(id, geom)` is the ONE place the declared and the dragged are reconciled, and both
the layer's inline style and the projection read it — which is what keeps the rendered width and
the projected width the same number. **A user-set height REPLACES the declared extent** rather
than being capped by it, while the cell's own `calc(100% - y)` cap survives it.

A gesture writes only the axes it actually moved — the arrow map gives every key a zero on one
axis and the drag latches a moved-x / moved-y per gesture — so a width-only press cannot pin a
height and stop a content-sized palette from growing. The clamps are the scope guard's and no
more: a floor that keeps the header (and therefore the move grip) reachable, and a ceiling at
the cell so the handle itself cannot leave it.

The pairwise proof keeps reading the DECLARED figures only: **a user's own arrangement is theirs
to overlap** (D-3).

### A palette moves by keyboard, and a window resize PROJECTS

A palette's title is its grip — a real `button` INSIDE its `h2`, because a `role="button"`
header would make the collapse and close verbs presentational while dropping the heading would
cost heading navigation. The arrows step it 8 px and ⇧-arrows 32 px through `nudgePalette`,
which is `movePalette` with the origin resolved first, so the keyboard inherits the drag's clamp
and edge snap rather than restating them. The ONE deliberate divergence is leaving a dock: a
step smaller than `SNAP_PX` would re-snap forever, so a departure is enlarged past it while
arrival is unchanged. Esc is deliberately NOT claimed — the move is modeless, so there is
nothing to leave, and Esc stays the cancel ladder's ([interaction](interaction.md)).

**A window resize projects, it does not move.** `clampToCell` for the origin and
`clampBoxToCell` for the size run AT RENDER against the measured cell, leaving the record alone
— so a window that shrinks brings a stranded palette back into reach and one that grows again
returns it to where the user put it. Clamping the state would instead have lost the position
permanently, marked the arrangement touched, persisted it, and vetoed a restore that had not yet
arrived.

The SIZE needs that projection for a reason the origin does not have: the resize handle rides
the box's far corner, so a palette sized in a wider window puts its only shrink control outside
a shell that nothing scrolls. The cell measurement takes **the ⌘\ latch as a dependency**,
because a `display:none` layer measures zero and no resize event fires when the latch lifts.
`edgeAt` carries the matching guard — a cell with no room has no edge to dock to, because every
x resolves to 0 and there is no direction the gesture could have expressed; without it a
too-narrow cell inverted the tie-break and silently, permanently docked a free palette right on
its next drag.

### The store, the stack, and the disk

`packages/editor/src/frontend/hooks/useWorkspace.tsx` adds the two things the store refuses to
know: React state and the disk (a debounced write, so a drag writes once at the end of the
gesture rather than at pointer rate). It is split into **state and actions contexts**, and the
load-bearing beneficiary is the component that actually builds the palette CONTENT elements —
it reads ACTIONS ONLY, which is what keeps those elements referentially stable across a drag and
therefore keeps the palette bodies off the pointer-rate path.

**Front-to-back order is session-local** (`hooks/usePaletteStack.tsx`) and deliberately NOT
persisted: geometry, collapse and open are decisions the user made; which palette they touched
last is an accident of the final minute. It sits above the whole chrome rather than inside the
layer, because the two surfaces that *open* a palette — the status bar's ⚠ chip and the burger's
View group — are the layer's siblings, not its children. **Every summon raises
unconditionally**, not merely on the open transition: the log is very often already open and
merely buried.

**Persistence is versioned and namespaced per project** (`lib/persist.ts`). The live keys are
`workspace`, `view`, `flagFilters` and `lastWorld`, each with exactly one writer, and the setter
rebuilds the blob from a fresh load so the keys stay independent. A blob at an older version is
**orphaned, never migrated**. A corrupt blob reads as empty; a quota failure is swallowed.
Persistence is best-effort and must never break the editor.

## What the editor SAYS — the notify store

`packages/editor/src/frontend/lib/notify-store.ts` (D-19) is a **capped toast stack over a
durable message log**, framework-free: `subscribe`/`getSnapshot` and nothing more, so every rule
lives in one place a bare test can drive without a DOM, a clock or a React tree. The clock and
the timer are **injected** — a store that called `Date.now`/`setTimeout` itself could only be
tested by waiting.

- `TOAST_CAP` is 3, `LOG_CAP` 200, `TOAST_TTL_MS` 4000.
- `NotifySeverity` is `info | success | warn | error`. **Errors never auto-fade** — they hold
  their slot until dismissed. Everything else, `warn` included, is a report on something that
  already finished, and reports should leave.
- **The cap does NOT evict.** A message arriving against a full stack becomes log-only rather
  than pushing the oldest toast off, because the thing a flood of infos would push off is
  exactly the undismissed error D-19 exists to protect.
- `overflow` (how many logged messages never got a slot) is **derived from the surviving
  entries**, not accumulated — a running counter would eventually read "200 messages · 997 not
  shown", two numbers about the same list that cannot both be true.
- `unreadErrors` drives the status bar's ⚠ chip and counts **`error` only** — a warning that lit
  it would demand attention exactly the way that severity exists not to. The log palette calls
  `markSeen` **only while it is topmost** (its `VisibilityProbe`), so a log buried under another
  palette keeps the chip lit rather than silently swallowing the errors behind it. `markSeen`
  does not notify when the newest id has not moved, or a palette that marks on render would
  loop.

The toast stack and the log palette render the SAME records by id. Live regions are
**persistent** — mounted whether or not there is anything to announce, because a region that
appears with its text is a region screen readers may not announce. **No surface in the editor
has a status line**, and that is deliberate: this store replaced the one that existed.

## Seeing — the view provider and the axis triad

`hooks/useView.tsx` owns what the field LOOKS like — shading, layer visibility, the slice plane
— and nothing about what is in it. It is shell state for the world state's reason: the View
popover drives it and the burger's View group drives the same values.

It is the **chrome→host direction**, which is why it is not part of the host-state module
(host→chrome). The host has no shading/layers/slice subscription to mirror, so this provider is
the source of truth and **pushes: one effect per seam, each keyed on its own value**, so a
shading change never re-sends the layer flags and a slider drag never re-sends the shading mode.
Every member is a push to a host seam, which is what makes it a view state rather than a
settings bag. Defaults are all-layers-true except `voidCast`, which is **opt-in** because
ticking it runs a whole-world cast ([tools](tools.md)); the layer set is restated here rather
than imported because the chrome cannot value-import the host
([bundling](bundling.md)), and it is pushed at engine-ready so the two agree from the first
frame.

**`FieldHostShading` is `"studio" | "normals"` and `studio` is the default** (D-F4.5-17): per-class
lit materials under a camera-following key light plus a hemisphere fill. `normals` is a *debug
flag*, not a peer. The advisor's flag markers stay unlit for exactly this reason — a marker that
dims when the key light looks away stops doing its job in the mode meant for mood
([advisor](advisor.md)).

**The camera-pose seam** pushes `{ yaw, pitch }` in radians and `shell/AxisTriadMount.tsx`
renders the corner triad off it. A **poll beside it**, `FieldHost.cameraPose()`, exists on the
split between drawing and answering: the pose moves between renders (pointer rate through a look
drag, per frame through a fly), so a surface that DRAWS it takes the subscription and a caller
that answers a question asked at an arbitrary moment takes the poll. Its one caller is the
agent-facing session read ([agent-door](agent-door.md)); both mirror-shaped alternatives cost
renders nobody asked for.

**The triad is also a CONTROL.** Its six axis ends are real `<button>`s over the SVG (an `<svg>`
cannot contain one, and `role="button"` on a shape would mean hand-rolling focus and
Enter/Space), each calling `FieldHost.snapView(axis, sign)` where `sign: 1` puts the eye on the
POSITIVE side. The mount box stays `pointer-events-none` so the overlay never eats an orbit
drag; the six tips re-enable it for their own caps, and each **suppresses the default on a left
pointerdown** — a tip is a momentary command, and letting a click move focus off the canvas
would kill every viewport key and cancel a live grab. They also suppress their own
`contextmenu`, which the canvas's handler cannot reach because they are canvas SIBLINGS, not
descendants. Buttons are emitted in fixed axis order (that is the tab order) and resolve overlap
with `zIndex`; the SVG behind them paints far-to-near. The triad mounts **above the palette
layer in DOM order**: the corner is unclaimed by DEFAULT, not unclaimable, and a user may drag
any palette onto it. `Toasts` sits there for the same reason. Both are their own absolute box
inside the SAME cell: they take nothing from the canvas.

## The menu, and who owns a key

The menu is a **single burger dropdown** (`shell/BurgerMenu.tsx`) whose groups render in the
order **World / Edit / View / Help** — not a menubar.

**The three registry groups are SUBMENUS.** The top level is the three submenu triggers, the two
doors ("View options…", "Keyboard shortcuts") and one checkbox per palette. What stays at top
level is what the menu is SHOWING STATE for — the palette ticks, where the tick IS the
information and a submenu would hide it — plus the doors; what moved behind a chevron is the
registry's own verbs, whose other route is ⌘K by name ([design-system](design-system.md)).
`help` is the fourth group and is deliberately NOT a submenu: it carries one action, and a
one-row submenu is a chevron guarding one row.

The fold arithmetic that justifies the depth — row heights, separator heights, and the ~906 px
the menu actually has under a 40 px top bar rather than the window's ~950 — lives in **one
place**, the "the TREE" section of `packages/editor/tests/chrome/shell.test.tsx`, beside the
cases that assert the shape. happy-dom runs no layout, so no case there can see a pixel; the
arithmetic is what stands in for one.

**Who owns a key.** There are two keydown listeners:

- the **canvas** (`packages/editor/src/field-host/field-host.ts`) keeps the keys that steer the
  viewport under the pointer — the fly set, `[`/`]`, the arrow nudges, momentary ⇧/⌃ — plus
  first refusal on ⌘Z, ⏎, Esc, R and F.
- everything else is the **registry's, on `window`**, which is the only listener that carries
  the gates and the only one that still works after a palette click takes the canvas's focus.

Where both bind one key the canvas branch that ACTS calls `stopPropagation`, and that call is
the whole licence for the second owner.

**The gate** has two classes plus two per-action flags. `chord` (⌘-chords) is live even inside a
text input, because the browser default it replaces is worse; `typed` (every bare letter, plus
⌫, Esc and ⏎) is refused when the focus is in one. "Text input" means TYPED TEXT ENTRY, not
"focusable form control" — `lib/keybindings.ts` matches textarea, select and the textual
`<input>` types, and deliberately NOT `range`/`checkbox`. Both directions of that line cost
something real: a matched slider makes the tool letters dead on the control users drag while
looking at the field, and an unmatched `<select>` lets the Esc that dismisses its popup run the
cancel ladder and discard a live session.

The two flags: `flyLetter` stands an action down while the host is looking — declared per action
rather than per class, because the collision is with the fly keys and a blanket rule killed `R`
and `F` mid-orbit for no collision at all. `armsTool` refuses while a session is live, *with a
toast*, because a key that looks dead teaches the user it is dead. A modal confirm suppresses
everything.

The shortcut overlay (`shell/ShortcutsDialog.tsx`) and the burger both render the same binding
rows, so a binding cannot be live and undocumented, or documented and dead
([action-registry](action-registry.md)). The overlay's one remaining hand-maintained group is
the canvas-owned keys.

## The seams the chrome reads

`hooks/useFieldHostState.tsx` is the **one MODULE** the host's seams are read through — one hook
per seam, so there is still exactly one place a comparator decides whether a push re-renders
anything, and one place to look when a surface stops updating.

Each `useField*` hook subscribes **in the component that reads it**, through `useSeam`, a
`useSyncExternalStore` latch. That inverts two things an earlier fan-out claimed:

- **Cadence isolation is FINER, not coarser.** A per-consumer latch isolates cadence by
  construction and one step further: a surface that does not call the hook does not subscribe at
  all, so a closed palette costs nothing.
- **A duplicate subscription is no longer a bug.** Two mirrors of one seam is the normal
  arrangement — the status bar and the action registry both read the tool, and the world hook
  holds its own latch on stats beside the status bar's ([world](world.md)). What still IS a bug
  is a mirror that never releases, and it has **no symptom at all**.

**THE ONE CONTEXT.** `FieldShellContext` carries `{ host, engineReady, chrome }` and changes
twice a session. That stability is load-bearing: every hook reads it, so a value that moved with
the brush radius would re-render the entities palette on every slider frame.

**The split, as it stands.** There are
<!-- derive: grep -coE '^  subscribe[A-Z][A-Za-z]*\(' packages/editor/src/field-host/field-host.ts -->13<!-- /derive -->
host seams. **Two are the SHELL's** — `toolError` and `flags` — and every other is claimed by
its reader and released with it. Both shell seams are forced: `toolError` posts a toast that
belongs to no one surface, and `flags` releases an in-flight verify that has to keep being
released while the flags palette is CLOSED.

**Four chrome-owned values live in provider-held CELLS** rather than in per-consumer state —
still latched by the same `useSeam`, so the arrangement is "shared truth, per-consumer
subscription" rather than a context by another name. Three are forced and one is a judgement
call, and the distinction matters more than the round number:

- **`gesture`** has no seam in either direction, so there is nothing to reconcile copies against.
- **`filters` + `verifying`** must outlive the surface that shows them: the layer unmounts a
  closed palette's body, and per-consumer state would lose the user's bands to a debounce its own
  unmount cancelled, and drop a verify the host is still running.
- **`flags`** is the CHOSEN one. Its channel carries a snapshot, so a latch would work; it is a
  cell because its push and the `verifying` release are one coupling and one effect.

`packages/editor/tests/chrome/host-seams-and-catalogs.test.tsx` pins the SET rather than any one
surface: which seams are the shell's, that every other is claimed by a reader, and that every one
is RELEASED when its reader unmounts. A leak has no other detector.

**The one cost this arrangement adds**, named because nothing else about it regressed: the
entities latch is the only one whose subscribe callback does WORK rather than adopting a pushed
payload — it calls `host.listEntities()`, which walks the whole op log to attribute placements.
That runs **once per reader**, and four surfaces call it. Accepted rather than fixed: the tick is
COMMIT-paced — a stamp, a bake, a ⌘Z — not frame- or pointer-paced, and the fix (hoisting the
read, or having the host push the list) is a design change. **Revisit if the entity list gets
long or the tick gets chattier.**

The stats push is guarded by a value-equality comparator with a `satisfies Record<string, never>`
backstop — a new `FieldStats` field fails the never-check and forces the comparator to learn it,
because a missed field would silently *weaken* the guard.

## What the bars say

**Three status-bar chips open a detail layer** (`ChipPopover`) where two run a verb
(`ChipButton`); one is inert text. The split is on BEHAVIOUR, not looks, and
`INTERACTIVE_CHIP_CLASS` is the one place that decides what an interactive chip looks like — a
shared component would have had to answer "these are all chips" and "one of these does nothing"
at once. A popover mounts its content only while open, so a closed chip costs nothing.

- the **selection** chip carries what is limiting the selection plus Clear / Reselect, straight
  off the registry by id (the Edit menu renders the same two).
- the **ops** chip is the op-cost meter — the readout that answers "why has this world got
  slow".
- the **analyzer** chip is ABSENT while the advisor is idle, because a chip that is always there
  for a state with nothing to say is one people stop seeing. It can reach 0 WHILE the user is
  reading the popover it opened, so it outlives its own reason to exist for exactly as long as
  that popover is open.
- the **`undo N`** chip summons the history palette and is present even at 0
  ([history](history.md)).
- the **job** chip is the inert one ([world](world.md)).

**The selection chip is the chrome's only WORLD-SPACE readout.** It puts the selection box's
centre on the bar to one decimal (and in the chip's accessible name, since a name replaces the
content it labels), with the per-axis extents in its popover, in the phrasing an agent's own
answer uses. Same axes and metres the agent-facing spatial read reports — for a selection it is
literally the same box off the same builder — so a number read off the bar and a number in an
agent's answer are comparable without conversion.

**It is the SELECTION's box and not the camera's pivot, and that is a stated limit rather than
an oversight**: `CameraPose` is `{yaw, pitch}`, `CameraRig.orbit()` is deliberately not a
`FieldHost` member and its docblock refuses widening the pose because that shape is published to
agents, and the chrome's pose latch guards on orientation precisely so a target-only move does
not re-render at frame rate. The argument, and what the bar therefore cannot say, lives once at
`centreOf` in `shell/StatusBar.tsx`.

**A go-to affordance is not taken**, decided at the code: the command palette is a VIEW, so a row
parsing free-text coordinates would be the violation that file exists to expose; and no host verb
moves the camera to a world POINT (`frameChunks` takes chunk keys, and the neutral floor exposes
no chunk size, so the chrome cannot even derive one). Either blocker alone is sufficient.

**The segment HUD** is its own seam, publishing `{ lenM, capM }` — how long the pending capsule
is against the cap it is measured by ([tools](tools.md)). It rides the status bar's keymap line,
which is its own component precisely so only IT re-renders: the HUD and the session context are
the two pointer-rate contexts in that bar, and the chips beside them have nothing to do with
either. The line grows and shrinks with the number and **cannot move the canvas for a structural
reason** rather than a character budget — the canvas cell is a sibling of this footer inside a
`fixed inset-0 flex flex-col` root, a fixed height class fixes the line's height, and
`whitespace-nowrap` refuses the wrap that is the only way text could ask for a second row.

## The palettes

### Entities

The entities palette is the committed-entity list plus the drift report. Rows carry the
lifecycle verbs (freeze / bake / delete) and are half of a bidirectional selection sync with the
viewport ([interaction](interaction.md)).

**The list sorts newest first — descending `entityId` — and states that order in the section
header's tooltip**, so it is a contract rather than an accident of how the host walks its log.
Decided in the LIST rather than in the hook: that hook has four readers and the other three do
lookups which must not silently acquire a promise about order. The collapsible section carries
an optional title hint for it — a real tooltip on the focusable TRIGGER, because an authored
`title` is banned ([design-system](design-system.md)) and a span nested inside the button takes
no focus. The wording refuses the reading a monotonic id invites: **the counter is SHARED with
the ops**, so "newest first" is true while "entity #3 is the third stamp" is false. The sort is
on a copy — `Array.prototype.sort` mutates its receiver, and the array has three other readers.

### Flags

`shell/FlagsPalette.tsx` renders the advisor's findings ([advisor](advisor.md)) with three
things a section inside a panel could not have (D-F4.5-15):

1. **The header is a hint, not an indictment.** It leads with the candidate count and demotes
   the raw total to a secondary line. Same data; the difference is whether opening the palette
   feels like being told off. The count is read off the summary's kind/severity breakdown, which
   describes everything FOUND, so unticking a chip can never make it read "nothing wrong here".
2. **The viewport is the primary selection surface.** Clicking a marker selects it and the list
   follows; clicking a row selects it and the CAMERA follows. Neither direction is wired to the
   other — both read the selection off the one seam.
3. **The filters persist**, through the host-state provider's store at the `flagFilters` key with
   a debounce. They live in the provider rather than in the palette because the host outlives
   every palette and a surface that re-pushed its defaults on each remount would silently untick
   the user's bands.

Rows are clustered by band (kind / severity / demotion) and then greedily agglomerated at
`CLUSTER_RADIUS_M = 2` single-linkage, so a run of pinches along a corridor chains into one row;
candidates float to the top with a stable sort. The radius is bracketed from BOTH sides in
`packages/editor/tests/chrome/flags-palette.test.tsx`.

`FlagFilters` has four chips, of which only two are severity bands: `unreachable` and `pits` are
one-sided VETOES — un-ticking the first hides the findings the reachability pass DEMOTED,
un-ticking the second subtracts traps from the candidate band. `pits` therefore **defaults ON**
while `info` and `unreachable` default off, because a pit carries candidate severity and the
candidates chip beside it already claims to be showing it.

**Selection publishes on the flags seam itself** rather than on a seam of its own — a highlight
and the rows it highlights have to arrive together, or a palette paints a selection against a
list from a different analyzer response. The store **retains** the key verbatim and the summary
**resolves** it against the visible set at publish time, which is what gives the two ways a key
stops resolving their opposite treatments for free: a filter that HID the row publishes null and
ticking the band back brings the selection back, while a re-analysis that RETIRED the finding
publishes null and nothing resurrects it. The published invariant is checkable — a non-null
selection implies exactly one visible row carries it.

Emphasis is **size and outline, never colour**: the marker keeps the row's own tint in both
branches and scales by `FLAG_SELECTED_SCALE = 1.6`, with the accent riding the anchor CELL's
outline. Re-tinting would delete the trapped/clear/candidate signal from the one row the user is
looking at. Selecting a row frames the finding's own cell — one cell on a side — where framing
its whole chunk left the user hunting inside the box; the viewport's own marker click
deliberately does **not** frame, since the user is already looking at what they pressed.
Refusals are one-way and synchronous: a key naming no VISIBLE finding reports on the tool-error
seam and changes nothing.

### Cell-level selection display

`packages/editor/src/field-host/field-selection-cells.ts` draws a flood selection's actual cells
instead of one AABB outline, because a 200 000-cell flood in an open world encloses the camera
and the only thing telling the user what they had selected was a box they were standing inside.

Drawing every cell is not the fix either. `SELECTION_DISPLAY_CAP = 65_536` is the budget and
**surface-first** is what makes spending it well possible: a cell with all six face neighbours
selected is buried and contributes nothing but blend cost, so it is the first thing the cap
discards. The shell is emitted first, so a truncated draw is a partial shell rather than an
arbitrary subset.

The membership reader keeps a one-entry chunk cache and decodes the bit layout itself, because
core's `selectionHas` builds a chunk-key string per call, and the six-neighbour test makes six
calls per selected cell — 1.2 M string allocations over a full flood budget, the arithmetic
stated at the reader itself. Chunk boundaries need no special case — the probe
looks up the neighbour's own bitset and a missing chunk reads unselected, which is correct.

**Region selections keep their honest AABB box**: a region IS its box. When the cap bites, the
selection payload says so rather than the display silently under-reporting, and the status bar's
chip carries the sentence along with Clear / Reselect.
