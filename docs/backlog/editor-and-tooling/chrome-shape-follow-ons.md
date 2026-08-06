# Chrome shape — the extraction follow-on set

Four entries consolidated at the F4.5 seal (2026-08-03); **three remain.** None is a defect:
every one is a place where the code WORKS and its shape is a bet — a helper not yet
extracted, a value routed through the wrong channel. They are filed together because they
are decided the same way (is the third occurrence here yet?) and because reading them
together is how you notice that two of them want the same provider stack.

**Taken 2026-08-06 (foundations T3b1):** *Two layering back-edges: `ui/` reaching app chrome,
and `field-host/` reaching `frontend/lib/`.* Its trigger — "the next task whose scope is
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
entry: `segmented-hint-throws-outside-a-tooltip-provider.md`.

The house position they all sit against: `.claude/rules/clean-code.md` § Cognitive Load —
*tolerate duplication until the third occurrence* — and the F4.5 chrome's own pattern, which
is that a value produced by a hook and read by more than one surface becomes a provider
rather than a wider context.

Each section keeps its own trigger. Delete a section when it is taken.

## The action GATE could leave `lib/actions.ts`

`frontend/lib/actions.ts` is ~1225 lines and holds two things that only meet at the bottom
of the file: the **action TABLE** (the ~36 declared actions, their labels, hints, keys and
`run`s — the part everyone edits) and the **GATE** (the rules deciding whether a matched
action may proceed at all).

The gate is `ActionGate`, `GateEnv`, `GateVerdict`, `gateAction`, `clickGate`,
`sessionRefusal`, `controlVerdict` and `matchAction` — roughly 90 lines, pure, and acyclic
with respect to the table: it takes an `ActionDef` and answers about it, and imports nothing
the table does not already import. A `lib/action-gate.ts` beside `lib/actions.ts` would take
it whole.

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
places in `field-host/field-host.ts` do (line numbers re-checked 2026-08-05):

| site | what it is |
| --- | --- |
| `:6525` / `:6528` | the world-swap rebuild — an anchor in the OLD field |
| `:6855` / `:6856` | `setGesture` — a carried-over point would read as a start the user never clicked |
| `:6982` / `:6989` | `startStamp`, the arm-first branch |
| `:7006` / `:7007` | `startStamp`, the selection-first branch |

**It was five, and the fifth was the Esc ladder's first rung.** Foundations T3a deleted
`escapeLadder` for a capture stack, and the box anchor and segment anchor now hold **one
entry each** rather than being cleared together by one rung — because the arming rules make
the pair unreachable (`setGesture` drops both on any switch, a stamp arm drops both), so the
dual clear there was guarding a state that cannot happen. The remaining four are the paths
that really do have to drop both. The second call is `segment.setAnchor(null)` rather than
`setSegmentAnchor(null)` since the segment cluster was extracted to `field-segment.ts`.

Four is still past `clean-code.md`'s third-occurrence threshold, and the last two only became
sites at F4.5c Task 14 — where the second one was MISSING and shipped as a defect: on the
ordinary path (select a region, arm a gesture, click once, pick a generator) a stale segment
anchor survived into the stamp session and ate the next Esc. Two of them were written in
the round that fixed it.

### Context

The candidate is a private `clearGestureAnchors()` beside the two setters — pure, no new
public surface, and it makes "both, always" a thing the code says once instead of a rule four
call sites have to remember. The shape of the failure it prevents is already on record:
the pattern is exactly `setPendingStamp`'s (`field-host.ts:3062-3070`), where the clear
lives INSIDE the setter so every path that disarms drops the corner whether or not its
author thought about anchors — the same argument, applied one level up.

Not done at Task 14 because that round was already carrying a behavioural fix and adding two
lines was strictly the smaller change under the scope set for it. Surfaced rather than
silently absorbed.

One nuance a helper has to preserve: two of the four sites carry a per-site COMMENT between
the two calls (`:6526-6527` explains that the segment anchor points into the old field;
`:6983-6988` explains that `cursorAffordance` answers `null` for any anchored gesture). Those
reasons are site-specific and would have to move to the call site of the helper, not into it —
a helper whose adoption deletes them makes the file worse, not better.

### Trigger to revisit

A FIFTH site, or the next substantial edit to `field-host.ts`'s gesture/session region —
`clean-code.md`'s "drive-by changes don't trigger restructuring" is why this waits for a
commit already in that neighbourhood.

### Reference

- `packages/editor/src/field-host/field-host.ts` — the four sites above, and
  `setPendingStamp` at `:3062-3070` for the precedent.
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

**Trigger to revisit:** the next edit to `EditorContextValue` for any reason, or the mirror pin
biting during an unrelated refactor. Cheap to take then — the provider stack already exists and
`WorldProvider` is the natural home.

**Reference:** `packages/editor/src/frontend/hooks/useDaemonFeed.ts`,
`packages/editor/src/frontend/components/editor-context.ts` (`worldsVersion`'s docblock, and
`ViewportFocus` beside it as the contrast case),
`packages/editor/src/frontend/components/shell/WorldDrawer.tsx`,
`packages/editor/src/frontend/hooks/useActionContext.tsx` (the provider the registry took);
`docs/reference/editor-architecture.md` §16.8.

---
