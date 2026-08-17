---
summary: the loop is bake → run the game → walk; an in-editor walk needs the consumer's mover driven against the editor's live field, which the walkability advisor's stage 2 already precedents — what is missing is the mode itself
---

# In-editor walk mode

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

Today the loop is bake → run the game → walk. It works and it is the loop the F4.5 gate
passed on. An in-editor walk would need the consumer's mover driven against the editor's live
field — which the walkability advisor's **stage 2 already does** at one finding under a time
budget, through the project's own `/engine.js`. So the mechanism precedent exists; what is
missing is the mode (input capture, a camera the host does not own, an exit).

**Trigger to revisit:** the bake-and-launch round trip becoming the thing that slows a session down —
measure it before building, because the bake is fast today.

**Reference:** the walkability advisor's stage 2 (the mechanism precedent — the consumer's mover against the live field, through the project's own `/engine.js`); `docs/reference/editor-architecture.md` §16–§18 for everything the same sweep put in the adopt column.
