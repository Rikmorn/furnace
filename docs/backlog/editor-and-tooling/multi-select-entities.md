---
summary: `FieldHost.selectEntity` takes one id or `null` and that is load-bearing — one selection is why the palette row, viewport box, session card and status readout cannot disagree; a selection SET needs rules for delete, duplicate and move over a heterogeneous set
---

# Multi-select entities

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

`FieldHost.selectEntity` takes one id or `null`, and `subscribeEntitySelection` publishes one.
That is deliberate and load-bearing at this size: one selection means the palette row, the
viewport box, the session card's REST subject and the status strip's readout cannot disagree.
Multi-select would need a selection SET, a rule for what the session card shows over a
heterogeneous set (the inspector module already handles N targets and `isMixed` — that half
exists), and a decision about what delete/duplicate/move do to a set.

**Trigger to revisit:** a workflow that repeats the same edit across several stamps — most likely the
first time a world has enough entities that one-at-a-time is the bottleneck.

**Reference:** `FieldHost.selectEntity` and `subscribeEntitySelection` (the one-id contract); the inspector module's N-target and `isMixed` handling (the half that already exists); `docs/reference/editor-architecture.md` §16–§18 for everything the same sweep put in the adopt column.
