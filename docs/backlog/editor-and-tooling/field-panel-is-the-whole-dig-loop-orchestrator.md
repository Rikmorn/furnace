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

Measured rather than estimated, and pinned to commits so the figures cannot quietly go
stale — the point of the entry is the SLOPE, not the value:

| commit | lines | `useState` slots | `host.subscribe*` |
| --- | --- | --- | --- |
| `1ad745c9` (master, pre-F4-tranche-B) | 711 | 15 | 7 |
| `47fdd3e5` (F4 Task 11's review-fix) | 793 | 17 | 8 |
| `c9460be2` (F4 tranche B tip) | 817 | 18 | 8 |

The subscription count held across Tasks 12–13 because the verify's in-flight key is PANEL
state riding two existing seams (`subscribeFlags` and `subscribeToolError`), not a ninth
subscription — which is itself the entry's point from the other side: the file absorbed a new
host verb by growing its own state instead.

The mechanism is that every new host seam costs this file a state slot, an effect and a prop
thread, and no section can own its own mirror without a second subscription. F4 added four
(the flags summary, the filter set, the in-flight verify key, and the analyzer status segment
in the footer meter) across Tasks 11 and 12. Nothing here is wrong; it is one file carrying
the whole chrome↔host protocol.

The shape worth considering is a `useFieldHost()` hook (or one hook per concern —
`useFieldFlags`, `useFieldEntities`) owning the subscribe/mirror/compare triple, leaving the
component as layout plus handlers. That is a design decision, not a tidy-up: it changes where
the echo guards live and how a remount re-seeds host state, both of which have subtle
committed behaviour (see the layers/slice/filters engine-ready comment).

**Trigger to revisit:** the next task that adds a host subscription to this panel, or the
first time two sections need the same mirrored state.

**Reference:** `docs/reference/editor-architecture.md` (panel/host seam);
`.claude/rules/clean-code.md` §Cognitive Load.
