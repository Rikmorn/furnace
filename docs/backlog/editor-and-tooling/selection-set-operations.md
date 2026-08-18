---
summary: cell-selection set operations — invert and grow-by-one are both well-defined over chunk-keyed bitsets and both bounded by `SELECTION_UI_BUDGET`; the open questions are where they live and whether they earn the surface
---

# Select all / invert selection, and grow / shrink selection

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

Cell-selection set operations. The store holds a selection as chunk-keyed bitsets and
`SELECTION_UI_BUDGET` (200 000 cells) already bounds a flood, so "invert" and "grow by one
cell" are both well-defined and both budget-bounded — the question is where they live (the
selection chip's popover holds Clear and Reselect today) and whether they are worth the
surface.

**Trigger to revisit:** a masking workflow that a flood plus a box cannot express. Wants taking together
with `box-selection-is-two-clicks.md` — all of it is one conversation about what
selection is for.

**Reference:** `SELECTION_UI_BUDGET` (the flood bound that makes these well-defined) and the selection chip's popover, which holds Clear and Reselect today; `box-selection-is-two-clicks.md`, which this wants taking with; `docs/reference/editor/chrome.md`, `design-system.md` and `tools.md` for everything the same sweep put in the adopt column.
