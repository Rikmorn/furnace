# FieldPanel.tsx is the dig loop's single orchestrator (~800 lines)

`packages/editor/src/frontend/components/FieldPanel.tsx` has grown past every cognitive-load
signal in `.claude/rules/clean-code.md` (~400 lines/file). Its presentation was extracted
long ago — `FieldToolbar`, `ToolPalette`, `MaterialSwatches`, `BrushInspector`,
`StampInspector`, `LayersRow`, `EntitiesList`, `DriftReport`, `FlagsSection` are all their
own files — so what is left is not markup but ORCHESTRATION: the `host.subscribe*` effects,
the engine-ready default pushes (layers, slice, flag filters), four value-equality
comparators with their compiler backstops (`toolsEqual`, `sameEntities`, `samePlaced`,
`statsEqual`), a state slot per mirrored host fact, and the footer meter that reads several
of them.

Measured rather than estimated, and dated so the figures cannot quietly go stale: **793
lines, 17 `useState` slots, 8 subscriptions at `47fdd3e5`** (F4 Task 11's review-fix commit).
They only ever go up — the point of the entry is the slope, not the value.

The mechanism is that every new host seam costs this file a state slot, an effect and a prop
thread, and no section can own its own mirror without a second subscription. F4 Task 11 added
three more (summary, filters, the analyzer status segment) and F4 Task 12 will add the verify
in flight. Nothing here is wrong; it is one file carrying the whole chrome↔host protocol.

The shape worth considering is a `useFieldHost()` hook (or one hook per concern —
`useFieldFlags`, `useFieldEntities`) owning the subscribe/mirror/compare triple, leaving the
component as layout plus handlers. That is a design decision, not a tidy-up: it changes where
the echo guards live and how a remount re-seeds host state, both of which have subtle
committed behaviour (see the layers/slice/filters engine-ready comment).

**Trigger to revisit:** the next task that adds a host subscription to this panel, or the
first time two sections need the same mirrored state.

**Reference:** `docs/reference/editor-architecture.md` (panel/host seam);
`.claude/rules/clean-code.md` §Cognitive Load.
