---
summary: a placement record is not an independently editable object — a prop click selects the entity that PLACED it, and hand-moving one would break reproducibility from the recipe unless the op log gains a per-record override concept
---

# Per-prop editing

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

A placement record is not an independently editable object: a prop click selects the entity
that PLACED it, and the scatter's params are what a user changes. That is a deliberate model
(props are the output of a recipe, not hand-placed objects), and per-prop editing would break
it — a hand-moved prop is no longer reproducible from the recipe, so the op log would need a
per-record override concept.

**Trigger to revisit:** wanting one prop somewhere the scatter will not put it. Consider first whether a
second, tiny scatter answers it, which is the in-model solution.

---

**Reference:** the F4.5 charter's §7 capability sweep (the adjudication this file is the
backlog column of), `docs/reference/editor/chrome.md`, `design-system.md` and `tools.md` for everything in the
adopt column, and `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md` for the
stage that produced both.

**Reference:** the placement records the scatter emits and the op log that would have to carry a per-record override; `docs/reference/editor/chrome.md`, `design-system.md` and `tools.md` for everything the same sweep put in the adopt column.
