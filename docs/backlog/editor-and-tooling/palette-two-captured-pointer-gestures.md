---
summary: `Palette.tsx`'s header DRAG and corner RESIZE are one captured-pointer gesture written twice across five matching member pairs, two of them identical — held at the second occurrence, and the two are not symmetric in what they cache
---

# `Palette.tsx` holds two captured-pointer gestures and wants one hook

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

## Context

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

## Trigger to revisit

**A third captured pointer gesture appears in the chrome** — anything that calls
`setPointerCapture` and carries state between pointermoves. That is `clean-code.md`'s own
threshold, and it is the first point at which the shape is confirmed by three users rather
than guessed from two.

Also worth taking if `Palette.tsx` is being substantially rewritten for another reason: it is
past 500 lines, and roughly half of that is the two gestures.

## Reference

- `packages/editor/src/frontend/components/shell/Palette.tsx` — the five pairs above; `Drag`
  and `Resize` at the top, the handlers in the component body.
- `packages/editor/tests/chrome/shell.test.tsx` — the guard cases for both copies, which a
  hook would have to keep passing unchanged: the header's at "a drag that loses its pointer
  capture stops, instead of following the cursor", the handle's at "the resize handle refuses
  every gesture the header drag refuses".
- `.claude/rules/clean-code.md` § Cognitive Load — "tolerate duplication until the third
  occurrence".
