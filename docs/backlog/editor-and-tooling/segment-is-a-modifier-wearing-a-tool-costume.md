# Segment reads as a fifth brush, but it is a modifier on the other four

**Context.** The brush family's rail list is EXCLUSIVE — `Dig | Fill | Paint | Smooth |
Segment`, pick one (`packages/editor/src/frontend/lib/actions.ts`, `armMember`'s docblock
says so in as many words). But `segment` is not a fifth sibling of the other four. It is a
GESTURE that composes with whichever brush effect is armed: a segment click builds a brush
op from the live effect and material and commits it down the same `commitToolOp` path a
stroke uses, which is also why its params are the effect's own rather than a fixed segment
set (`ToolStrip.tsx`). The state is two-dimensional — effect × gesture — and the rail
presents it as one dimension.

Reported from a smoke-test of the T3a slice (2026-08-06): *"we select one brush, then
select segment, and it applies that brush over a segment. But that is very unclear as the
UI moves to only have the segment selected. Segment seems like a concept applied on top of
a brush."* The user understood the model and still found the UI said something else — which
is the definition of the affordance being wrong rather than the concept being hard.

**The code already shows the strain.** Three places pay for the collapse:

- `ToolStrip` compensates at render time: under `segment` the strip's NAME becomes
  "SEGMENT" and the armed effect is demoted to a muted suffix. So the strip knows there are
  two facts to show; the rail — which is what the eye reads first, and which owns the
  exclusive selected state — shows one.
- `armMember` carries a fix for a LIVE bug caused by the same category error: because
  `brushArming` deliberately does not disarm `segment` when an effect is picked ("Fill
  under Segment means sweep a rampart, not stop segmenting") while `armedIndex` resolves
  by GESTURE first, the ⇧B cycle could not leave Segment at all — every press armed dig
  and landed back on index 4. The trailing `setGesture(null)` makes the ring escapable.
  That is a one-dimensional cursor being walked over two-dimensional state.
- The two arming rules now openly contradict each other by design and both are correct:
  picking from the rail list is exclusive, while `X`'s dig↔fill swap goes through
  `armBrush` alone and deliberately KEEPS a live segment. Two spellings of "arm a brush"
  that must disagree is the smell.

**Shapes worth weighing when this is picked up** (none chosen — this needs a real design
pass, not a patch): segment as a toggle/modifier chip beside the effect row rather than a
member of it; a persistent "DIG · via SEGMENT" compound readout on the rail itself, not
just the strip; or keeping the flat list but making the rail's selected state show both
facts. The first is the one the model actually implies, and it is also the most disruptive
to the keyboard ring, the flyout, and `armedIndex` — which is why it wants its own slice
rather than an inline fix.

**Trigger to revisit:** T3c's gesture machine — it takes pointer capture and the gesture
lifecycle, so it is the slice that will already be holding the effect × gesture state in
one place and is the cheapest moment to fix the presentation over it. Also fires early if a
SECOND compositional gesture arrives (anything else that means "apply the armed brush
along a shape"), because a second one makes the flat list untenable rather than merely
misleading.

**Reference:** `armMember` + `brushArming` + the family-ring docblocks in
`packages/editor/src/frontend/lib/actions.ts`; the name/suffix compensation in
`packages/editor/src/frontend/components/shell/ToolStrip.tsx`; the segment brush itself in
`packages/editor/src/viewport-host/field-segment.ts` (its `commitToolOp` path is what makes
the composition real rather than cosmetic); `docs/reference/editor-architecture.md` for the
rail/strip split.
