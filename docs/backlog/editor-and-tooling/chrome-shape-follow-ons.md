---
summary: editor chrome that works but whose shape is a bet — the action gate still inside `lib/actions.ts`, a counter riding the context, helpers awaiting a third occurrence
---

# Chrome shape — the extraction follow-on set

Four entries consolidated at the F4.5 seal (2026-08-03); **three remain.** None is a defect:
every one is a place where the code WORKS and its shape is a bet — a helper not yet
extracted, a value routed through the wrong channel. They are filed together because they
are decided the same way (is the third occurrence here yet?) and because reading them
together is how you notice that two of them want the same provider stack.

**Taken 2026-08-06 (foundations T3b1):** *Two layering back-edges: `ui/` reaching app chrome,
and `field-host/` reaching `frontend/lib/`.* (The entry's own title said `viewport-host/` — the
directory was renamed in T3b1's last task, and this line is quoted in the new spelling so it
matches the tree; `git show 22cea191^` has it as written.) Its trigger — "the next task whose scope is
already a move" — fired on the T3b1 cluster extractions. Eight modules left `frontend/lib/`
for `src/field-host/` (host-only) or a new `src/shared/` (chrome-shared), and
`components/tips.tsx` moved into `components/ui/`. The as-built direction chain
`frontend/ → field-host/ → shared/` is in `docs/reference/editor-architecture.md` §7.

**Two things that entry named are NOT resolved, and neither is hiding here.** (1) The `ui/`
half fixed the DIRECTION only: `ui/tips.tsx` still has four outward edges where every other
file under `ui/` has one, so the library's transitive closure is what it always was — §18 of
editor-architecture states it precisely, and the cycle trigger has not fired (the surviving
edges are `import type` or import nothing). (2) The entry's stated COST — `Segmented`'s
optional `hint` throwing outside a `TooltipProvider` — is untouched, because it is a Radix
runtime requirement that travels with `ActionTip` wherever the file sits. It is now its own
entry: `editor-chrome-authoring-gaps.md` §"`Segmented`'s optional `hint` throws when there is no `TooltipProvider` above it".

The house position they all sit against: `.claude/rules/clean-code.md` § Cognitive Load —
*tolerate duplication until the third occurrence* — and the F4.5 chrome's own pattern, which
is that a value produced by a hook and read by more than one surface becomes a provider
rather than a wider context.

Each section keeps its own trigger. Delete a section when it is taken.

## The action GATE could leave `lib/actions.ts`

`frontend/lib/actions.ts` is 1,586 lines (re-measured at head 2026-08-09; it was 1,299 when
this entry was written and 1,304 at the T4a branch point — Tasks 1 and 2 added the second
funnel and the two gate envs, so the tranche that grew it is the one re-measuring) and holds
two things that only meet at the bottom
of the file: the **action TABLE** (39 actions — since T3b2 their DATA rows live in
`src/action-registry/descriptors.ts` and this file holds the four closures `label`,
`enabled`, `checked` and `run`, joined by id) and the **GATE** (the rules deciding whether a
matched action may proceed at all).

The gate is `GateEnv`, `GateVerdict`, `gateAction`, `clickGate`, `sessionRefusal`,
`controlVerdict` and `matchAction` — pure, and acyclic with respect to the table: it takes an
`ActionDef` and answers about it, and imports nothing the table does not already import. A
`lib/action-gate.ts` beside `lib/actions.ts` would take it whole.

> **Re-measured 2026-08-07 (foundations T3b2).** Three facts moved and the entry is
> re-stated against head rather than left as written: the file grew 1,225 → **1,299** lines
> (T3b2 added `runAction`, `runNamed`, `sayResult` and the `BEHAVIORS` join), the table is
> **39** actions not ~36 (the "~36" was never right — it was 39 at the time too), and
> **`ActionGate` has already left**: it is a type, so it moved down to
> `action-registry/descriptors.ts` with the rows — and `actions.ts` does NOT re-export it
> (no consumer outside the registry), so it is not even a name this file still holds. The
> remaining cluster is the seven names above. **Still open** — T3b2 declined the move for
> the entry's own stated reason (it carried a behavioural change), and `GateEnv` becoming a
> discriminated union on `caller` makes the seam sharper, not weaker.

### Context

The tell that the seam is real is that the TEST suite already splits along it: the gate's
cases and the table's cases are separate concerns in separate places, and reviewers have
described the file by these two halves more than once.

Not done when it was noticed because every task that noticed it was carrying a behavioural
change at the same time, and a whole-file move under a behavioural diff is the shape that
makes a review round unreadable. It is a pure move — no behaviour, no new API — so it wants
a commit of its own where the diff being a rename is the entire claim.

### Trigger to revisit

`actions.ts` crossing ~1400 lines, or the first change to the gate's RULES rather than to
the table — the `session.confirm` ⏎ decision
(`session-confirm-claims-enter-for-every-plain-button.md`) is exactly that change, and doing
it inside the current file means editing gate logic in the middle of the action table.

### Reference

- `packages/editor/src/frontend/lib/actions.ts` — the gate lives at `:139-157` (the types)
  and `:1143-1225` (the functions); everything between is the table.
- `packages/editor/src/frontend/hooks/useGlobalKeybindings.ts` — the one caller of
  `matchAction` + `gateAction`, which is what makes the seam observable.

---

## `setBoxAnchor(null); segment.setAnchor(null);` is four sites and wants a name

The box brush and the segment brush each hold a pending first click — `boxAnchor` and
`segmentAnchor` — and the two are mutually exclusive by construction: arming one clears the
other. Every path that drops a half-drawn gesture therefore has to clear BOTH, and four
places do (the line numbers below were re-checked 2026-08-06, after T3b1's five extractions
shifted every one of them by ~+13 from the 2026-08-05 pass — and have since rotted outright:
T3c+T3d moved the sites themselves out of `field-host.ts` into `field-machine.ts` and
`field-world.ts`, so grep by symbol, not by line):

| site | what it is |
| --- | --- |
| `:6389` / `:6392` | the world-swap rebuild — an anchor in the OLD field |
| `:6720` / `:6721` | `setGesture` — a carried-over point would read as a start the user never clicked |
| `:6834` / `:6841` | `startStamp`, the arm-first branch |
| `:6858` / `:6859` | `startStamp`, the selection-first branch |

**It was five, and the fifth was the Esc ladder's first rung.** Foundations T3a deleted
`escapeLadder` for a capture stack, and the box anchor and segment anchor now hold **one
entry each** rather than being cleared together by one rung — because the arming rules make
the pair unreachable (`setGesture` drops both on any switch, a stamp arm drops both), so the
dual clear there was guarding a state that cannot happen. The remaining four are the paths
that really do have to drop both. At head the second call travels as a dep — the machine
sites spell `deps.setSegmentAnchor(null)` and the world-reset site `deps.clearSegmentAnchor()`
(the segment cluster itself lives in `field-segment.ts`; T3d re-checked this sentence, which
had been one extraction behind).

Four is still past `clean-code.md`'s third-occurrence threshold, and the last two only became
sites at F4.5c Task 14 — where the second one was MISSING and shipped as a defect: on the
ordinary path (select a region, arm a gesture, click once, pick a generator) a stale segment
anchor survived into the stamp session and ate the next Esc. Two of them were written in
the round that fixed it.

### Context

The candidate is a private `clearGestureAnchors()` beside the two setters — pure, no new
public surface, and it makes "both, always" a thing the code says once instead of a rule four
call sites have to remember. The shape of the failure it prevents is already on record:
the pattern is exactly `setPendingStamp`'s (now in `field-machine.ts` — grep the setter),
where the clear
lives INSIDE the setter so every path that disarms drops the corner whether or not its
author thought about anchors — the same argument, applied one level up.

Not done at Task 14 because that round was already carrying a behavioural fix and adding two
lines was strictly the smaller change under the scope set for it. Surfaced rather than
silently absorbed.

One nuance a helper has to preserve: two of the four sites carry a per-site COMMENT between
the two calls (`:6390-6391` explains that the segment anchor points into the old field;
`:6835-6840` explains that `cursorAffordance` answers `null` for any anchored gesture). Those
reasons are site-specific and would have to move to the call site of the helper, not into it —
a helper whose adoption deletes them makes the file worse, not better.

### Trigger to revisit

A FIFTH site, or the next substantial edit to the gesture/session code — now
`field-machine.ts` / `field-tool.ts` — `clean-code.md`'s "drive-by changes don't trigger
restructuring" is why this waits for a
commit already in that neighbourhood.

### Reference

- `packages/editor/src/field-host/field-machine.ts` — three of the four sites (`setGesture`
  and both `startStamp` branches), and `setPendingStamp` for the precedent;
  `packages/editor/src/field-host/field-world.ts` — the world-swap site (its reset calls
  the `clearBoxAnchor` / `clearSegmentAnchor` deps).
- `packages/editor/tests/field-host-stamp-entry.gpu.test.ts` — the `ARM_EXITS` table,
  which walks the disarm paths and is where a fifth site would want a row.
- `.claude/rules/clean-code.md` § Cognitive Load — "tolerate duplication until the third
  occurrence".

---

## `worldsVersion` rides `EditorContextValue` as a counter the drawer must mirror

`hooks/useDaemonFeed.ts` reduces the daemon's SSE feed to a number: a counter bumped on
every `worlds-changed` / `generation-baked` event. App puts that number on
`EditorContextValue.worldsVersion`, and `shell/WorldDrawer.tsx` reads it out of the editor
context and refetches `world.list` whenever it changes.

That works, and the counter-not-payload choice is right (the events are notification-only
dirty bits). The awkward part is the **route**: a value produced by a hook and consumed by
exactly one component travels through the editor context, which is otherwise the
App-owned-things channel — the host ref, the confirm seam, the persistence store. Two
costs follow:

1. **The wiring is mirror-pinned.** Nothing about `worldsVersion` is observable from the
   drawer's own module, so the "counter reaches the context reaches the drawer" chain is
   held together by a test that asserts the shape of the mirror rather than the behaviour.
   A refactor that renames or re-routes it passes typecheck and fails the pin for reasons
   that read as test churn.
2. **It widens the context for one consumer.** `EditorContextValue` is read by every part
   of the chrome; a field only the drawer wants is surface everyone carries.

The shape that removes both: make the daemon feed a **provider** (`WorldsFeedProvider` or
fold it into the existing `WorldProvider`, which already owns everything else about
worlds), have the drawer read it directly, and **delete `worldsVersion` from
`EditorContextValue`**. The provider stack the shell already builds is the natural home —
this is the same move Task 8 made for the world verbs and Task 9 for the view state.

Not done at F4.5a because the counter works and the slice's provider budget went to the
seams that were actively wrong. Filed rather than fixed so the next context edit does not
re-derive the argument.

**Adjudicated at the F4.5 seal (2026-08-03) — the entry STANDS, and the trigger is sharpened.**
The stated conditional resolved NEGATIVE in the way that matters: F4.5b's action registry did
NOT land on `EditorContextValue`. It got a provider of its own
(`hooks/useActionContext.tsx`), for a render-cost reason — assembling the action context reads
values that move on every drag frame, so it has to sit above the components that build palette
bodies. That is the same argument this entry makes, made independently and acted on, which
strengthens rather than weakens the case here.

`EditorContextValue` WAS widened this stage, once, by F4.5c Task 10's `ViewportFocus` — and
that one belongs there on the entry's own test: it is App/CanvasHost-owned, installed and
cleared by the component that owns the canvas element, and read by four unrelated surfaces.
`worldsVersion` still fails that test on both counts (produced by a hook, consumed by exactly
one component).

**A second reason to touch the same hook, added 2026-08-09 (foundations T4b).** The signature
is now **four positional parameters** — `useDaemonFeed(ready, bakeBusyRef, session, onRequest)`
— having taken `session: SessionFeed` for the claim and `onRequest` for the backchannel's
answerer in the same tranche. That is `clean-code.md`'s stated smell line (*"more than ~4
positional parameters is a smell"*) reached exactly, and the four are not cohesive: a boolean
gate, a ref, a handler record and a callback. It was left as-is deliberately — both tranche
commits were carrying behavioural change, and a signature churn under a behavioural diff is
what makes a review round unreadable (this entry's own standing argument).

**The agreed disposition is not a separate entry**: convert to a single options object
**whenever that signature is next touched, for any reason**. It is a mechanical change with one
call site (`App.tsx`), so it costs nothing then and is not worth a commit of its own now. A
FIFTH parameter is the hard trigger — take it in that commit rather than adding to the list.

**Trigger to revisit:** the next edit to `EditorContextValue` for any reason, the next edit to
`useDaemonFeed`'s signature, or the mirror pin biting during an unrelated refactor. Cheap to
take then — the provider stack already exists and `WorldProvider` is the natural home.

**Reference:** `packages/editor/src/frontend/hooks/useDaemonFeed.ts`,
`packages/editor/src/frontend/components/editor-context.ts` (`worldsVersion`'s docblock, and
`ViewportFocus` beside it as the contrast case),
`packages/editor/src/frontend/components/shell/WorldDrawer.tsx`,
`packages/editor/src/frontend/hooks/useActionContext.tsx` (the provider the registry took);
`docs/reference/editor-architecture.md` §16.8.

---

## Absorbed at T5 (2026-08-11)

Four more of the same kind, filed between the F4.5 seal and T5: a provider the design
promised to collapse and which grew instead, and three things written twice. They keep
their Context, *Trigger to revisit* and *Reference* as written.


## The chrome provider the design promised to collapse grew instead

Recorded as a MISS by user ruling at the T3 objectives audit (2026-08-08) — not
scheduled work. The foundations design said the view-model layer "collapses … the
chrome's 870-line 11-context provider"; the as-built went the other way:
`useFieldHostState.tsx` was 878 lines before T3b1, 1,075 after it (ten contexts became
per-consumer latches, but five values were FORCED into provider-held cells), and
1,093 at T3d's head — **25% larger than when the programme started**, while every other
number in the editor shrank.

### Context

The growth is not waste — §21.3 documents the shape honestly (latches + the forced
cells + two shell-held seams), and T3b2 retired two cells when the tool seam converted.
But the design's stated payoff inverted and no exit clause ever measured it. The honest
framing: the LATCH conversion was the real goal (cadence isolation, achieved); the line
count was a proxy that failed. Whether a real collapse is worth doing is an open
question, not an obligation.

### Trigger to revisit

- A third forced cell appears (the current five were each individually justified; six
  starts to look like the mechanism fighting the architecture).
- Chrome performance work that touches render cadence — the latch layer is where it
  lives.

### Reference

- `packages/editor/src/frontend/hooks/useFieldHostState.tsx`;
  `docs/reference/editor-architecture.md` §21.3.

## `Palette.tsx` holds two captured-pointer gestures and wants one hook

The palette's header DRAG and its corner RESIZE are the same gesture written twice. Every
member of the first has a twin in the second, and two of them are byte-identical modulo the
ref name:

| move | resize | how close |
| --- | --- | --- |
| `type Drag` | `type Resize` | same head (`pointerId`, `fromX`, `fromY`), different payload |
| `onPointerDown` | `onHandleDown` | same `e.button !== 0` guard, same capture, same "measure once" |
| `endDrag` | `endResize` | **identical** apart from `drag`/`resize` |
| `onPointerMove` | `onHandleMove` | same `pointerId` match, same `e.buttons === 0` brace |
| `onGripKeyDown` | `onHandleKeyDown` | same meta/ctrl/alt guard, same ⇧ step, same `preventDefault` |
| `NUDGE_KEYS` | `RESIZE_KEYS` | same four keys, different vector names |

The candidate is a `useCapturedGesture<T>(ref)` owning the ref, the pointerdown capture, the
`pointerId` match, the `buttons === 0` brace and the four release paths — leaving each
gesture only what differs: what it measures at pointerdown, and what it does with a delta.

### Context

Raised in the F4.5c fix round's quality review and deferred there on purpose, for two
reasons stated rather than assumed.

**It is the SECOND occurrence, not the third.** `.claude/rules/clean-code.md` § Cognitive
Load tolerates duplication until the third, and says explicitly that "if you find yourself
reaching for an abstraction with only two call sites, prefer waiting for a third to confirm
the shape". Five call-site pairs is a lot of surface to move on a guess about what the third
gesture will need.

**The timing was wrong.** The extraction would have landed in the same commit as three
behavioural fixes to those exact handlers (per-axis writes, a render-time size projection, a
dock guard), immediately before a seal. Mechanism risk on top of a behaviour change, in the
one file whose gestures nothing else can substitute for.

The named cost of NOT extracting — that the second copy shipped without the first copy's
tests — is closed. That round added the handle's four missing guard cases
(`shell.test.tsx`, "the resize handle refuses every gesture the header drag refuses" and
"…claims the bare arrows and NOTHING else"), each written after the guard was verified
deletable with the suite still green. So the duplication now costs reading, not coverage.

One nuance a hook has to preserve: the two gestures are NOT symmetric in what they cache.
The move measures bounds once and the palette cannot change size under it; the resize
deliberately caches its START SIZE because the palette really is changing size under the
pointer, and re-reading per event would compound rounding into a drift. A hook that owned
"measure at pointerdown" generically would have to keep that distinction at the call site.

### Trigger to revisit

**A third captured pointer gesture appears in the chrome** — anything that calls
`setPointerCapture` and carries state between pointermoves. That is `clean-code.md`'s own
threshold, and it is the first point at which the shape is confirmed by three users rather
than guessed from two.

Also worth taking if `Palette.tsx` is being substantially rewritten for another reason: it is
past 500 lines, and roughly half of that is the two gestures.

### Reference

- `packages/editor/src/frontend/components/shell/Palette.tsx` — the five pairs above; `Drag`
  and `Resize` at the top, the handlers in the component body.
- `packages/editor/tests/chrome/shell.test.tsx` — the guard cases for both copies, which a
  hook would have to keep passing unchanged: the header's at "a drag that loses its pointer
  capture stops, instead of following the cursor", the handle's at "the resize handle refuses
  every gesture the header drag refuses".
- `.claude/rules/clean-code.md` § Cognitive Load — "tolerate duplication until the third
  occurrence".

## The status line spells ten keycaps the action registry already derives

`src/shared/action-table.ts` carries each row's status line as literal clauses — `"⌫ delete"`,
`"R rotate ¼"`, `"Esc clears"`, the `"⏎ "` lead-in. Ten of them lead with a cap that
`src/action-registry/keys.ts`' `keycap()` derives independently from the binding row. Edit a
binding and the menu, the tooltip and the shortcuts overlay all follow; the status bar does
not.

### Context

Foundations T3b2 Task 5 was asked to adjudicate this and reached verdict **(ii): a real
duplication of an owned fact**, not prose legitimately spelling its own keys. The verdict is
written into `action-table.ts` beside the `text()` helper; this entry is the deferred half.

**Measured at T3b2 Task 5 head** by walking `EFFECT_ROWS` (plus `deriveModifierParts`) +
`GESTURE_ROWS` (both `statusLine` and `readoutLine`) + both `TRANSIENT_STATUS` entries, and
matching each clause's lead token against every `keycap(d.keys)` in `ACTION_DESCRIPTORS`.
Re-run it rather than trusting these numbers.

**THE COUNTING RULE, because "distinct clause" is ambiguous and a first pass got it wrong:** one
entry per clause **as the table writes it** — a text fragment is its text, and a slot is its
lead-in plus the slot NAME, so a slot counts once however many values it can take. **38
occurrences, 27 distinct.** (Expanding `sessionSteer` to the two values `SESSION_STEER` can give
it would read 28; the first pass published 26, which is wrong under either rule — it collapsed
`sessionSteer` and `segmentMeasure` into one entry because both are slots with no lead-in.)

| lead cap | distinct clauses | the action that also derives it |
| --- | --- | --- |
| `Esc` | 4 — `Esc clears` · `Esc drops the point` · `Esc cancels` · the `Esc ` lead-in | `session.escape` |
| `⏎` | 1 — the `⏎ ` lead-in | `session.confirm` |
| `⌫` | 1 — `⌫ delete` | `edit.delete` |
| `G` | 1 — `G grab` | `edit.grab` |
| `F` | 1 — `F frame` | `view.frame` |
| `R` | 1 — `R rotate ¼` | `session.rotate` |
| `X` | 1 — `X swap` | `tool.swapEffect` |

(`Esc clears` is ONE distinct clause carried by three gesture rows — box, material and void —
which is why the occurrence count is higher than the distinct one.)

Ten of 27 distinct clauses. The other seventeen are NOT duplications and must not be swept in
with them: `LMB …` and `click ×2 …` name a mouse gesture rather than a key, and `[ ] radius`,
`⇧ smooth`, `⌃ dig` / `⌃ fill`, `← → ↑ ↓ nudge` and `drag ghost move` are canvas-owned keys
the registry does not carry at all. That split is exactly what the retired non-derivation
decision got half right (editor-architecture §22.2): it claimed the whole line was
canvas-owned vocabulary, and half of it is.

**Why T3b2 did not close it.** `keycap()` lives in `src/action-registry/`, which sits ABOVE
`src/shared/`. A value import from the floor into the registry reverses the editor's one-way
import arrow and `tests/no-chrome-leakage.test.ts` refuses it. Inverting a layer to
deduplicate ten single characters is the wrong trade.

### The shape that would close it, and what it costs

Give `StatusFragment` a third kind that names an ACTION ID and lets the CHROME resolve the
cap — `{ kind: "keycap", action: ToolActionId, gives: "delete" }`, rendered by the adapter as
`${capOf(byId(action))} ${gives}`. The arrow stays correct: the table already holds action
ids it cannot resolve (`FamilyRow.arm` / `.cycle`), and `tests/shared/action-table.test.ts`
already pins that they resolve in the registry.

The cost is the reason it is filed rather than done. `StatusFragment`'s own TSDoc makes the
two-kind count its whole claim — *"TWO kinds, and the count is the model's whole claim … There
is no third shape — no conditionals, no nesting, no formatting directives — which is what
makes a row's line readable as prose in the source."* A third kind is a deliberate retreat
from that, and it wants its own deletion pass: `ToolActionId` would have to widen past the
seven tool verbs to reach `edit.delete` / `view.frame` / `session.*`, which is most of the
registry arriving in the floor's type vocabulary. There may be a better answer (moving the
BINDING rows to `shared/` and leaving only the schemas above, for instance) and this entry
should not prejudge it.

### Trigger to revisit

Any of:

- **A binding in the table above changes its keycap** — the seven actions listed are the
  exposure, and `session.escape` is the one with four clauses riding on it.
- **A new status clause is written naming a key that HAS a binding.** Adding an eleventh is
  the moment the cost of not deciding lands on someone.
- **`action-registry/`'s layer is revisited** for any other reason — the MCP projection
  (T4/T5 of the foundations program) is the likely one, and moving the binding rows is only
  cheap while there is one consumer.

### Reference

- `packages/editor/src/shared/action-table.ts` — the verdict, beside `text()`; `EFFECT_ROWS`,
  `GESTURE_ROWS`, `TRANSIENT_STATUS` are the clauses.
- `packages/editor/src/action-registry/keys.ts` — `keycap()` and `NAMED_CAPS`.
- `packages/editor/src/action-registry/descriptors.ts` — the seven bindings.
- `packages/editor/tests/no-chrome-leakage.test.ts` — the arrow that forbids the direct fix.
- `docs/reference/editor-architecture.md` §22.2 — the full-derivation decision this is the
  residue of.

## `sameTool` and `toolsEqual` are one predicate written twice, and `shared/` can hold it

`field-host/field-tool.ts`'s `sameTool` (`field-host.ts`'s until T3d) and
`frontend/lib/field-host-mirrors.ts`'s
`toolsEqual` are the same function. As of foundations T3b2 Task 6 their `sameMask`/
`masksEqual` halves are byte-identical including the comment, and the two outer functions
differ only in style. Nothing pins that they agree.

### Context

The standing justification is that the chrome may not take a VALUE edge to `field-host.ts`
(the barrel carries core, and a second core in the chrome bundle is what
`tests/frontend-no-engine-leakage.test.ts` exists to prevent). That is true and it is why
the comparator cannot live in `field-host/` — but it answers a narrower question than it
appears to, because it says nothing about the third option.

**`shared/` can hold it.** `FieldTool` is a plain structural type whose only non-inline
member, `BrushEffect`, already lives in `shared/field-brush.ts`. `shared/` is exactly where
Task 5 of this same slice put `HOLLOW_MIN_M`, `RADIUS_MIN` and `RADIUS_MAX`, for exactly
this reason, and the layer arrow (`frontend/ → field-host/ → shared/`) makes it importable
by both sides by construction.

### Why it was not done at T3b2

Second occurrence, so tolerate-until-three applies, and the duplication is the SAFE kind:
both copies carry the destructure `satisfies Record<string, never>` backstop, so a new
`FieldTool` field fails to compile in both places at once. What the backstop does NOT cover
is a comparison someone DELETES from one copy — that is now pinned per-field on the host
side (`tests/field-host-headless.test.ts`, "the value guard lets a change to any ONE
compared field through") and per-field on the chrome side
(`tests/field-host-mirrors.test.ts`), which is the cheaper half of the same protection.

The stakes did rise at T3b2: `sameTool` now gates a PUBLISH, so a weakened host-side compare
means the chrome is never told the brush changed, where before a weakened chrome-side
compare only cost a re-render.

### What moving it would mean

`FieldTool` itself would want to move to `shared/` with it, or the shared module would
type-import it from `field-host/` — which reverses nothing (a type import is erased) but is
worth deciding deliberately rather than by accident. Deleting one copy is the point; keeping
two behind a shared third would be worse than today.

### Trigger to revisit

A third copy appearing, `FieldTool` gaining a field (which is when both backstops fire and
somebody edits both files anyway), or any tranche already moving type surface into `shared/`.

#### The third clause FIRED at foundations T3c Task 5 (2026-08-07), and was still declined

The tool registry landed as a NEW floor module (`src/shared/tool-registry.ts`), so a tranche
really did move type surface into `shared/`. Two things kept the comparator where it is:

- **The type surface that moved was not `FieldTool`'s.** The new module declares its own
  four types and type-imports `MaterialTable` and `ParamId`; it neither carries `FieldTool`
  nor makes carrying it any cheaper. The trigger clause was written to catch "someone is
  already in `shared/` deciding where `FieldTool` lives" — nobody was.
- Both backstops still hold and the per-field pins on both sides still hold, so the
  duplication is still the SAFE kind this entry describes.

**A first draft of this note claimed the move needs a test edit. It does not**, and the
correction matters because the false claim would have made the work look more expensive than
it is: `tests/field-host-mirrors.test.ts` imports `toolsEqual` BY NAME from
`frontend/lib/field-host-mirrors.ts`, so `export { toolsEqual } from "../../shared/…"` there
satisfies it with zero test edits and ONE implementation. That is also not what this entry
calls *"worse than today"* — that phrase is about keeping TWO implementations behind a shared
third, and a re-export is one implementation plus an alias. Cost is not the blocker; the
blocker is that nobody was making the `FieldTool` placement decision.

**Sharpened trigger, replacing the third clause:** a tranche that moves `FieldTool` itself
into `shared/`. A new floor module on its own is no longer enough — T3c proved that clause
fires without buying anything.

### Reference

- `packages/editor/src/field-host/field-tool.ts` — `sameMask` / `sameTool` (now there)
- `packages/editor/src/frontend/lib/field-host-mirrors.ts` — `masksEqual` / `toolsEqual`
- `packages/editor/src/shared/field-limits.ts` — the Task 5 precedent
- `docs/reference/editor-architecture.md` §22.8, "Two comparators, deliberately"
