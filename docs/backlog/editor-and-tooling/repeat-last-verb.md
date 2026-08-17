---
summary: "do that again" has no verb; the action registry knows what ran and is the natural home, but "the last action" is ambiguous in an editor whose ops are strokes — repeating a dig stroke means nothing without a position
---

# Repeat last

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

No "do that again" verb. The action registry (`lib/actions.ts`) is the natural home — it knows
what ran — but "the last action" is ambiguous in an editor whose ops are strokes: repeating a
dig stroke means nothing without a position.

**Trigger to revisit:** a repeated PARAMETERISED verb worth repeating — a stamp with the same params at a
new region is the plausible one, and that is really "duplicate, then move", which exists.

**Reference:** `packages/editor/src/frontend/lib/actions.ts` (the action registry — it knows what ran, which is why it is the natural home); `docs/reference/editor-architecture.md` §16–§18 for everything the same sweep put in the adopt column.
