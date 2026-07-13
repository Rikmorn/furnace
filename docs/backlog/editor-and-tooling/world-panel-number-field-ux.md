# World-panel number fields: clearing a knob snaps it to 0

Every numeric knob in the World panel (hall `w/h/d`, maze `cells x/z` + `braid`, cave
`mouths`, portal `offset`/`mouth`, corridor `length`/`rise` — eight call sites) parses its
input through `num()` in
`packages/editor/src/frontend/components/world-panel/fields.tsx`. `<input type="number">`
reports `""` for anything it cannot parse (including a lone `-` mid-typing), and
`Number("") === 0` — which is finite — so **clearing a field sets the knob to 0** rather
than restoring the previous value, and `num`'s `fallback` argument is very nearly dead
code. A 0-cell axis fails loud at stamp time, so this is a UX wart, not a correctness hole,
but it makes editing a knob by select-all-and-retype feel hostile.

The real fix is a shared `NumberField` that buffers the raw string in local state and
commits only on a valid parse (or on blur), keeping the draft numeric while the input is
mid-edit. That is a new shared abstraction — a design decision, not a mechanical fix — and
it would also collapse the eight duplicated numeric-input blocks and the repeated label
scaffolding the panel currently spells out by hand.

**Trigger to revisit:** the next World-panel UX pass (3.4 seeing / 3.5 curating), or the
first time someone reports a knob snapping to 0.

**Reference:** `packages/editor/src/frontend/components/world-panel/fields.tsx` (`num`'s
TSDoc states the actual behaviour).
