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

What defers this is SCOPE, not difficulty — it is pre-existing and outside the task that
surfaced it. Whoever picks it up should not re-derive a blocker that is not there:

- **Depth is already decided.** `formatParam` in `EntitiesList.tsx` fixes what the row
  actually displays — `typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)`.
  "Compare what the row renders" answers the depth question with no new design decision,
  which is exactly the principle the `placed` fix used.
- **Cost is not a real objection.** Param sets are schema-driven and small (a generator's
  `paramSchema` properties), and the guard already does per-entity work on every tick.

So the likely shape is a `sameParams` helper beside `samePlaced`, comparing the rendered
projection rather than the raw values.

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
