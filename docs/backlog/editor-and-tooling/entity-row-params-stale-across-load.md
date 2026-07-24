# An entity row's expanded params can show the PREVIOUS world's values after a load

**Context.** `sameEntities` in `packages/editor/src/frontend/components/FieldPanel.tsx` is
the refresh guard behind `subscribeEntities`: it returns the previous array when the new one
compares equal, so an entity tick that changed nothing does not re-render the panel. It
compares `entityId`, `generator`, `seed`, `opSpan`, the frozen/baked flags and (since F3b)
the `placed` counts — but NOT `params`, which the expanded row renders as a read-only `<dl>`.

The original argument for the omission was that a param change always moves `opSpan` with it,
because a reconfigure re-evaluates the span with ids taken from `log.nextId`. That holds
WITHIN a session and fails across a world switch: `loadWorld` recomputes
`log.nextId = max(op.id) + 1` from the loaded ops, so ids — and every `opSpan` — restart.
Two worlds can therefore hold entity records that agree on every compared field and differ
only in their params, and `FieldToolbar`'s Load button calls `loadWorld` from inside the same
`FieldPanel` mount (no remount, no state reset, just an entity tick). The guard returns
`prev`, and an expanded row keeps the previous world's param values.

Narrow in practice: it needs a row expanded across a load of a same-shaped world, and the
row's own summary line (which does not carry params) reads correctly. It is also
pre-existing — F3a shipped the `<dl>` and the guard together. F3b closed the sibling hole for
`placed` because that one puts a wrong NUMBER on the collapsed row, which is visible without
expanding anything.

The fix is not simply "compare params too": params are arbitrary `Record<string, unknown>`
values, so a comparator needs a decision about depth (shallow value-compare, JSON
stringify, structural walk) and about cost on every tick with a large param set. That is the
design question that keeps this out of an inline fix.

**Trigger to revisit:** when the params `<dl>` becomes editable (the row stops being a
read-only record), OR the first time a world switch is a routine part of the loop rather
than an occasional action — F4's cockpit pass, where switching worlds to compare generations
is the point.

**Reference:** `packages/editor/src/frontend/components/FieldPanel.tsx` (`sameEntities`,
`samePlaced`, `refreshEntities`); `packages/editor/src/viewport-host/field-host.ts`
(`loadWorld`'s `log.nextId` recomputation — the fact that breaks the id-monotonicity
premise); `packages/editor/src/frontend/components/field/EntitiesList.tsx` (the `<dl>`);
`packages/editor/src/frontend/components/field/FieldToolbar.tsx` (`onLoad`, the in-mount
reachability).
